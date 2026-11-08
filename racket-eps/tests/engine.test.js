'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../engine.js');

// Données fictives uniquement.
function makeClass(n, courts) {
  const c = { id: 'c1', name: 'Classe test', sport: 'Badminton', courts: courts || 4, k: 32, students: [], sessions: [] };
  R.addStudents(c, Array.from({ length: n }, (_, i) => 'Élève ' + String(i + 1).padStart(2, '0')));
  return c;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function checkCourts(c, s) {
  const active = s.matches.filter(m => m.court && !m.done);
  const courts = active.map(m => m.court);
  assert.equal(new Set(courts).size, courts.length, 'terrain utilisé deux fois');
  const avail = R.availableCourts(c, s);
  assert.ok(courts.every(t => avail.includes(t)), 'terrain retiré ou fermé encore utilisé');
  const players = active.flatMap(m => [m.a, m.b]);
  assert.equal(new Set(players).size, players.length, 'élève sur deux terrains');
}

/** Joue uniquement les matchs placés sur un terrain, dans un ordre aléatoire, jusqu'au bout. */
function playSession(c, s, r, opts) {
  opts = opts || {};
  for (let guard = 0; guard < 5000; guard++) {
    checkCourts(c, s);
    const active = s.matches.filter(m => m.court && !m.done);
    if (active.length) {
      const m = active[Math.floor(r() * active.length)];
      const lo = Math.floor(r() * 10);
      const res = R.recordResult(c, s, m.id, r() < 0.5 ? { sa: 11, sb: lo } : { sa: lo, sb: 11 });
      assert.ok(res.ok, res.error);
      continue;
    }
    assert.equal(s.matches.filter(m => !m.done && m.a && m.b).length, 0, 'match prêt jamais placé sur un terrain');
    if (R.canNextRound(s).ok) { assert.ok(R.nextRound(c, s).ok); continue; }
    if (s.mode === 'reclass' && R.canBuildClassement(s).ok) {
      const sizes = opts.sizes || R.proposePartitions(s.positions.length)[0].sizes;
      assert.ok(R.buildClassement(c, s, sizes).ok);
      continue;
    }
    if (s.mode === 'challenge' && (opts.challenges || 0) > 0) {
      opts.challenges--;
      const order = R.challengeOrder(s);
      const i = 1 + Math.floor(r() * (order.length - 1));
      const j = Math.max(0, i - 1 - Math.floor(r() * Math.min(s.gap, i)));
      const res = R.addChallenge(c, s, order[i], order[j]);
      assert.ok(res.ok, res.error);
      continue;
    }
    break;
  }
}

function newSession(c, opts) {
  const r = R.createSession(c, opts);
  assert.ok(r.ok, r.error);
  return r.session;
}

/* ---------------- Elo ---------------- */

test('Formule Elo et symétrie', () => {
  assert.equal(R.expected(1000, 1000), 0.5);
  assert.ok(Math.abs(R.expected(1200, 1000) - 1 / (1 + Math.pow(10, -200 / 400))) < 1e-12);
  const d = R.sessionDeltas([{ a: 'A', b: 'B', sa: 11, sb: 5, done: true }], { A: 1000, B: 1000 }, 32);
  assert.equal(d.A, 16); assert.equal(d.B, -16);
});

test('Elo figé pendant la séance, invariance à l\'ordre, conservation de la somme', () => {
  const start = { A: 1100, B: 1000, C: 950, D: 1020 };
  const ms = [
    { a: 'A', b: 'B', sa: 5, sb: 11, done: true }, { a: 'C', b: 'D', sa: 11, sb: 9, done: true },
    { a: 'A', b: 'C', sa: 11, sb: 3, done: true }, { a: 'B', b: 'D', sa: 2, sb: 11, done: true },
    { a: 'A', b: 'D', sa: 11, sb: 7, done: true }
  ];
  const d1 = R.sessionDeltas(ms, start, 32);
  const d2 = R.sessionDeltas(ms.slice().reverse(), start, 32);
  for (const k of Object.keys(start)) assert.ok(Math.abs(d1[k] - d2[k]) < 1e-9);
  const sum = Object.values(d1).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) < 1e-9);
  // Avec un Elo « mis à jour au fil de l'eau », A aurait un autre résultat : on vérifie qu'on utilise bien le début.
  const ea = R.expected(1100, 950);
  const contribAC = 32 * (1 - ea);
  assert.ok(Math.abs(R.sessionDeltas([ms[2]], start, 32).A - contribAC) < 1e-12);
});

test('Pas d\'Elo pour : forfait, match non terminé, séance non clôturée, exemption ; absents inchangés', () => {
  const c = makeClass(5, 2);
  const s = newSession(c, { mode: 'swiss', rounds: 1 });
  const absent = c.students[4].id;
  R.setAbsent(c, s, absent, true);
  assert.ok(R.startSession(c, s).ok);
  assert.equal(s.matches.length, 2);
  R.recordResult(c, s, s.matches[0].id, { forfeit: s.matches[0].a });
  // séance non clôturée : aucun Elo
  assert.ok(Object.values(R.computeStats(c)).every(p => p.elo === 1000));
  R.recordResult(c, s, s.matches[1].id, { sa: 11, sb: 4 });
  assert.ok(R.closeSession(c, s).ok);
  const st = R.computeStats(c);
  assert.equal(st[s.matches[0].a].elo, 1000, 'forfait : pas d\'Elo');
  assert.equal(st[s.matches[0].b].elo, 1000);
  assert.equal(st[s.matches[1].a].elo, 1016);
  assert.equal(st[absent].elo, 1000);
  assert.equal(st[absent].absences, 1);
  assert.equal(st[s.matches[0].b].forfeitWins, 1);
  assert.equal(st[s.matches[0].b].for, 0, 'forfait : pas de points marqués');
});

test('Correction d\'une séance passée : recalcul chronologique sans double comptage', () => {
  const c = makeClass(4, 2);
  const r = rng(1);
  const s1 = newSession(c, { mode: 'pools', groupSize: 4 });
  R.startSession(c, s1); playSession(c, s1, r); R.closeSession(c, s1);
  const s2 = newSession(c, { mode: 'pools', groupSize: 4 });
  R.startSession(c, s2); playSession(c, s2, r); R.closeSession(c, s2);
  const before = R.computeStats(c);
  // Rouvrir la séance 1, inverser un résultat, reclôturer
  assert.ok(R.reopenSession(c, s1.id).ok);
  const m = s1.matches[0];
  assert.ok(R.recordResult(c, s1, m.id, { sa: m.sb, sb: m.sa }).ok);
  assert.ok(R.closeSession(c, s1).ok);
  const after = R.computeStats(c);
  // Recalcul complet indépendant
  const fresh = JSON.parse(JSON.stringify(c));
  const again = R.computeStats(fresh);
  for (const id of Object.keys(after)) assert.ok(Math.abs(after[id].elo - again[id].elo) < 1e-9);
  assert.ok(Object.keys(after).some(id => Math.abs(after[id].elo - before[id].elo) > 1e-6));
  const total = Object.values(after).reduce((a, p) => a + p.elo, 0);
  assert.ok(Math.abs(total - 4000) < 1e-9, 'somme des Elo conservée');
  assert.equal(after[c.students[0].id].history.length, 2);
  assert.equal(after[c.students[0].id].played, 6);
});

test('Bug V1 corrigé : annuler une séance rouverte la restaure au lieu de la supprimer', () => {
  const c = makeClass(4, 2);
  const s = newSession(c, { mode: 'pools', groupSize: 4 });
  R.startSession(c, s); playSession(c, s, rng(2)); R.closeSession(c, s);
  const elo = R.computeStats(c);
  R.reopenSession(c, s.id);
  R.recordResult(c, s, s.matches[0].id, { sa: s.matches[0].sb, sb: s.matches[0].sa });
  const res = R.cancelSession(c, s);
  assert.ok(res.ok && res.restored);
  assert.equal(c.sessions.length, 1);
  assert.equal(c.sessions[0].status, 'closed');
  const elo2 = R.computeStats(c);
  for (const id of Object.keys(elo)) assert.equal(elo2[id].elo, elo[id].elo);
  // Une séance jamais clôturée est bien supprimée
  const s2 = newSession(c, { mode: 'swiss' });
  assert.equal(R.cancelSession(c, s2).restored, false);
  assert.equal(c.sessions.length, 1);
});

test('Une seule séance active ; validation des scores', () => {
  const c = makeClass(4);
  newSession(c, { mode: 'pools' });
  assert.equal(R.createSession(c, { mode: 'pools' }).ok, false);
  assert.match(R.validateScore(5, 5), /nul/);
  assert.match(R.validateScore(-1, 5), /négatifs/);
  assert.match(R.validateScore('', 5), /deux scores/);
  assert.match(R.validateScore(2.5, 5), /entiers/);
  assert.equal(R.validateScore('11', '3'), null);
});

/* ---------------- Groupes et terrains ---------------- */

test('Bug V1 corrigé : groupes équilibrés, jamais d\'entassement dans le dernier groupe', () => {
  const c = makeClass(24, 4);
  const s = newSession(c, { mode: 'pools', groupSize: 4 });
  assert.deepEqual(s.groups.map(g => g.length), [4, 4, 4, 4, 4, 4]);
  for (const n of [5, 6, 7, 12, 25]) {
    const ids = Array.from({ length: n }, (_, i) => 'x' + i);
    const sizes = R.makeGroups({ mode: 'pools', groupSize: 4 }, ids).map(g => g.length);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, n + ' : ' + sizes);
    assert.ok(sizes.every(x => x >= 3 && x <= 6), n + ' : ' + sizes);
  }
  const single = R.makeGroups({ mode: 'ladder', ladderType: 'single' }, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(single.map(g => g.length), [2, 3]);
});

test('Le placement validé par l\'enseignant est exactement celui utilisé pour les matchs', () => {
  const c = makeClass(8, 2);
  const s = newSession(c, { mode: 'pools', groupSize: 4 });
  const moved = s.groups[0][0];
  assert.ok(R.moveToGroup(s, moved, 1).ok);
  assert.deepEqual(s.groups.map(g => g.length), [3, 5]);
  R.startSession(c, s);
  const inGroup1 = s.matches.filter(m => m.group === 1).flatMap(m => [m.a, m.b]);
  assert.ok(inGroup1.includes(moved));
  assert.equal(s.matches.filter(m => m.group === 0).length, 3);
  assert.equal(s.matches.filter(m => m.group === 1).length, 10);
  // Ordre (formats sans groupes)
  const s2 = { positions: ['a', 'b', 'c'] };
  R.shiftPosition(s2, 'c', -1);
  assert.deepEqual(s2.positions, ['a', 'c', 'b']);
});

const SIZES = [5, 6, 7, 12, 24, 25];
const COURTS = [1, 2, 3, 6];
const FORMATS = [
  { mode: 'pools', groupSize: 4 }, { mode: 'pools', groupSize: 3, legs: 2 },
  { mode: 'swiss', rounds: 4 }, { mode: 'ladder', ladderType: 'single', rounds: 4 },
  { mode: 'ladder', ladderType: 'group', groupSize: 4, move: 2, rounds: 3 },
  { mode: 'challenge', gap: 3 }, { mode: 'reclass', groupSize: 4 }
];

for (const f of FORMATS) {
  test(`Format ${f.mode}${f.ladderType ? ' ' + f.ladderType : ''} : ${SIZES.join('/')} élèves × ${COURTS.join('/')} terrains, jamais de match simultané`, () => {
    for (const n of SIZES) {
      for (const courts of COURTS) {
        const c = makeClass(n, courts);
        const s = newSession(c, f);
        assert.ok(R.startSession(c, s).ok);
        playSession(c, s, rng(n * 10 + courts), { challenges: 2 * n });
        assert.ok(s.matches.length > 0);
        assert.ok(s.matches.every(m => m.done), `${n}/${courts} : matchs non terminés`);
        if (f.mode === 'swiss' || f.mode === 'ladder') assert.equal(s.round, f.rounds);
        if (f.mode === 'reclass') {
          const places = R.reclassPlaces(s);
          const vals = Array.from(places.values()).sort((a, b) => a - b);
          assert.deepEqual(vals, Array.from({ length: n }, (_, i) => i + 1), `${n}/${courts} : places`);
        }
        assert.ok(R.closeSession(c, s).ok);
        const st = R.computeStats(c);
        const total = Object.values(st).reduce((a, p) => a + p.elo, 0);
        assert.ok(Math.abs(total - 1000 * n) < 1e-6);
      }
    }
  });
}

test('Ronde suisse : aucune revanche évitable, exemptions équitables et sans Elo', () => {
  for (const n of [6, 7, 8, 9]) {
    const c = makeClass(n, 3);
    const s = newSession(c, { mode: 'swiss', rounds: Math.ceil(n / 2) });
    R.startSession(c, s);
    playSession(c, s, rng(n));
    const keys = s.matches.map(m => [m.a, m.b].sort().join());
    assert.equal(new Set(keys).size, keys.length, n + ' : revanche');
    if (n % 2) {
      const byes = s.byes.map(b => b.id);
      assert.equal(new Set(byes).size, byes.length, 'deux exemptions pour un même élève');
    }
    R.closeSession(c, s);
    const st = R.computeStats(c);
    assert.ok(Math.abs(Object.values(st).reduce((a, p) => a + p.elo, 0) - 1000 * n) < 1e-6);
  }
});

test('Montante-descendante individuelle : le gagnant monte, le perdant descend, terrains extrêmes gérés', () => {
  const c = makeClass(6, 3);
  const s = newSession(c, { mode: 'ladder', ladderType: 'single', rounds: 2 });
  R.startSession(c, s);
  const g = s.groups.map(x => x.slice());
  // Sur chaque terrain, le second joueur (position basse) gagne
  s.matches.forEach(m => R.recordResult(c, s, m.id, m.a === g.find(x => x.includes(m.a))[0] ? { sa: 3, sb: 11 } : { sa: 11, sb: 3 }));
  assert.ok(R.nextRound(c, s).ok);
  const winner = id => { const m = s.matches.find(x => x.round === 1 && (x.a === id || x.b === id)); return R.winnerOf(m) === id; };
  const w1 = g[0].find(winner), l1 = g[0].find(id => !winner(id));
  const w2 = g[1].find(winner), l3 = g[2].find(id => !winner(id));
  assert.ok(s.groups[0].includes(w1), 'gagnant du terrain 1 reste au terrain 1');
  assert.ok(s.groups[0].includes(w2), 'gagnant du terrain 2 monte');
  assert.ok(s.groups[1].includes(l1), 'perdant du terrain 1 descend');
  assert.ok(s.groups[2].includes(l3), 'perdant du dernier terrain y reste');
  assert.ok(s.moves.some(mv => mv.id === w2 && mv.from === 2 && mv.to === 1));
  // Elo inchangé par les déplacements (séance non clôturée)
  assert.ok(Object.values(R.computeStats(c)).every(p => p.elo === 1000));
});

test('Montante-descendante par groupes : mini-poule complète et 2 montées/descentes', () => {
  const c = makeClass(12, 3);
  const s = newSession(c, { mode: 'ladder', ladderType: 'group', groupSize: 4, move: 2, rounds: 2 });
  R.startSession(c, s);
  assert.equal(s.matches.length, 18, '3 groupes de 4 → 6 matchs chacun');
  const before = s.groups.map(x => x.slice());
  s.matches.forEach(m => { const g = before.find(x => x.includes(m.a)); R.recordResult(c, s, m.id, g.indexOf(m.a) < g.indexOf(m.b) ? { sa: 11, sb: 2 } : { sa: 2, sb: 11 }); });
  R.nextRound(c, s);
  assert.deepEqual(s.groups[0], [before[0][0], before[0][1], before[1][0], before[1][1]]);
  assert.deepEqual(s.groups[2], [before[1][2], before[1][3], before[2][2], before[2][3]]);
});

test('Jeu du défi : écart maximal, élève occupé, permutation', () => {
  const c = makeClass(6, 2);
  const s = newSession(c, { mode: 'challenge', gap: 2, permutation: 'swap' });
  R.startSession(c, s);
  const o = R.challengeOrder(s);
  assert.equal(R.addChallenge(c, s, o[5], o[0]).ok, false);
  assert.ok(R.addChallenge(c, s, o[2], o[0]).ok);
  assert.equal(R.addChallenge(c, s, o[1], o[0]).ok, false, 'défié déjà occupé');
  const m = s.matches[0];
  R.recordResult(c, s, m.id, m.a === o[2] ? { sa: 11, sb: 5 } : { sa: 5, sb: 11 });
  assert.deepEqual(R.challengeOrder(s).slice(0, 3), [o[2], o[0], o[1]]);
  // Correction du résultat : rang local rejoué, sans permutation
  R.recordResult(c, s, m.id, m.a === o[2] ? { sa: 5, sb: 11 } : { sa: 11, sb: 5 });
  assert.deepEqual(R.challengeOrder(s).slice(0, 3), [o[0], o[1], o[2]]);
});

test('Reclassement : 24 élèves en 3 tableaux de 8, places 1 à 24, invalidation aval sur correction', () => {
  const c = makeClass(24, 6);
  const s = newSession(c, { mode: 'reclass', groupSize: 4 });
  R.startSession(c, s);
  playSession(c, s, rng(5), { sizes: [8, 8, 8] });
  assert.equal(s.matches.filter(m => m.phase === 'classement').length, 36);
  const q1 = s.matches.find(m => m.phase === 'classement' && m.division === 'A' && m.number === 1);
  const res = R.recordResult(c, s, q1.id, { sa: q1.sb, sb: q1.sa });
  assert.ok(res.needsConfirm && res.invalidated.length >= 2);
  const ok = R.recordResult(c, s, q1.id, { sa: q1.sb, sb: q1.sa }, { confirm: true });
  assert.ok(ok.ok);
  assert.ok(s.matches.some(m => m.invalidated && !m.done));
  assert.ok(R.reclassPlaces(s).size < 24);
  playSession(c, s, rng(6));
  assert.equal(R.reclassPlaces(s).size, 24);
});

/* ---------------- Persistance ---------------- */

test('Migration d\'une sauvegarde V1 (terrains attribués d\'avance) sans conflit ni perte', () => {
  const v1 = {
    classes: [{
      id: 'c', name: '3e B', sport: 'Badminton', courts: 2, k: 32,
      students: ['a', 'b', 'c', 'd', 'e', 'f'].map(x => ({ id: x, name: 'Élève ' + x })),
      sessions: [
        { id: 's1', seq: 1, date: '2026-01-01', mode: 'pools', status: 'closed', absent: [], positions: ['a', 'b', 'c', 'd', 'e', 'f'], matches: [{ id: 'm1', a: 'a', b: 'b', sa: 11, sb: 4, done: true, round: 1, court: 1 }], round: 1, rounds: 3, groupSize: 3, k: 32 },
        { id: 's2', seq: 2, date: '2026-01-08', mode: 'pools', status: 'playing', absent: [], positions: ['a', 'b', 'c', 'd', 'e', 'f'], round: 1, rounds: 3, groupSize: 3, k: 32,
          matches: [['a', 'b', 1], ['a', 'c', 1], ['b', 'c', 1], ['d', 'e', 2], ['d', 'f', 2], ['e', 'f', 2]].map(([a, b, ct], i) => ({ id: 'n' + i, a, b, sa: null, sb: null, done: false, round: 1, court: ct })) }
      ]
    }],
    active: 'c'
  };
  const before = R.computeStats(JSON.parse(JSON.stringify(v1.classes[0])));
  const db = R.parseDB(JSON.stringify(v1));
  assert.equal(db.schemaVersion, 2);
  const c = db.classes[0], s = c.sessions[1];
  checkCourts(c, s);
  assert.equal(s.matches.filter(m => m.court).length, 2);
  assert.deepEqual(s.groups.map(g => g.length), [3, 3]);
  const after = R.computeStats(c);
  for (const id of Object.keys(before)) assert.equal(after[id].elo, before[id].elo);
  playSession(c, s, rng(9));
  assert.ok(R.closeSession(c, s).ok);
});

test('Import : refus des structures invalides', () => {
  assert.throws(() => R.parseDB('{"foo":1}'), /classes/);
  assert.throws(() => R.parseDB(JSON.stringify({ schemaVersion: 99, classes: [] })), /récente/);
  const bad = { schemaVersion: 2, classes: [{ id: 'c', name: 'X', students: [{ id: 'a', name: 'A' }], sessions: [{ id: 's', seq: 1, status: 'closed', matches: [{ a: 'a', b: 'zz' }] }] }] };
  assert.throws(() => R.parseDB(JSON.stringify(bad)), /inconnu/);
  const db = R.emptyDB();
  db.classes.push(makeClass(4));
  const back = R.parseDB(JSON.stringify(db));
  assert.equal(back.classes[0].students.length, 4);
});

test('Élèves : doublons (casse/accents), renommage sans changer l\'identifiant', () => {
  const c = makeClass(2);
  const r = R.addStudents(c, ['Léa', 'lea', '  ', 'Tom']);
  assert.equal(r.added.length, 2);
  assert.deepEqual(r.skipped, ['lea']);
  const id = c.students[2].id;
  assert.ok(R.renameStudent(c, id, 'Léa B.').ok);
  assert.equal(c.students[2].id, id);
  assert.equal(R.renameStudent(c, id, 'tom').ok, false);
});

test('Départage par confrontation directe (configurable) dans une poule', () => {
  const mk = tiebreak => {
    const c = makeClass(4, 2);
    const s = newSession(c, { mode: 'pools', groupSize: 4, tiebreak });
    R.startSession(c, s);
    const [A, B, C, D] = s.groups[0];
    const res = { [A + B]: [11, 9], [A + C]: [2, 11], [A + D]: [11, 0], [B + C]: [11, 0], [B + D]: [11, 0], [C + D]: [0, 11] };
    s.matches.forEach(m => {
      const k = res[m.a + m.b] ? m.a + m.b : m.b + m.a, r = res[k];
      const flip = !res[m.a + m.b];
      R.recordResult(c, s, m.id, flip ? { sa: r[1], sb: r[0] } : { sa: r[0], sb: r[1] });
    });
    return { rk: R.rankGroup(s, s.groups[0]), A, B };
  };
  // A et B : 2 victoires ; B a la meilleure différence (+31 contre +1), mais A a battu B.
  const h = mk('h2h-diff-pf');
  assert.deepEqual(h.rk.slice(0, 2).map(x => x.id), [h.A, h.B]);
  assert.equal(h.rk[1].decidedBy, 'h2h');
  const d = mk('diff-pf');
  assert.deepEqual(d.rk.slice(0, 2).map(x => x.id), [d.B, d.A]);
  assert.equal(d.rk[1].decidedBy, 'diff');
});

test('Confrontation directe circulaire (3 ex aequo) : critère suivant appliqué', () => {
  const c = makeClass(3, 1);
  const s = newSession(c, { mode: 'pools', groupSize: 3, tiebreak: 'h2h-diff-pf' });
  R.startSession(c, s);
  const [A, B, C] = s.groups[0];
  const score = { [A + B]: [11, 1], [B + C]: [11, 9], [C + A]: [11, 9] };
  s.matches.forEach(m => {
    const r = score[m.a + m.b] || score[m.b + m.a].slice().reverse();
    R.recordResult(c, s, m.id, { sa: r[0], sb: r[1] });
  });
  const rk = R.rankGroup(s, s.groups[0]);
  // 1 victoire chacun, confrontation directe 1-1-1 → différence : A +8, C 0, B −8
  assert.deepEqual(rk.map(x => x.id), [A, C, B]);
  assert.equal(rk[1].decidedBy, 'diff');
});

test('Classe exemple : élèves fictifs, séances simulées valides, reproductible', () => {
  const c = R.createDemoClass({ students: 24, sessions: 6, seed: 'graine', today: '2026-11-08' });
  assert.equal(c.demo, true);
  assert.equal(c.students.length, 24);
  assert.ok(c.students.every(p => R.DEMO_NAMES.includes(p.name)), 'pseudonymes fictifs uniquement');
  assert.equal(c.sessions.length, 6);
  assert.deepEqual(c.sessions.map(s => s.mode), ['pools', 'swiss', 'ladder', 'reclass', 'ladder', 'challenge']);
  assert.ok(c.sessions.every(s => s.status === 'closed' && s.matches.length && s.matches.every(m => m.done)));
  assert.ok(c.sessions.every((s, i) => i === 0 || s.date > c.sessions[i - 1].date), 'dates chronologiques');
  const total = R.ranks(c).reduce((a, p) => a + p.elo, 0);
  assert.ok(Math.abs(total - 24000) < 1e-6);
  const db = R.emptyDB(); db.classes.push(c);
  assert.ok(R.validateDB(JSON.parse(JSON.stringify(db))).ok);
  // Même graine → mêmes résultats ; classe vierge possible
  const c2 = R.createDemoClass({ students: 24, sessions: 6, seed: 'graine', today: '2026-11-08' });
  assert.deepEqual(R.ranks(c2).map(p => [p.name, p.elo]), R.ranks(c).map(p => [p.name, p.elo]));
  const empty = R.createDemoClass({ students: 5, sessions: 0 });
  assert.equal(empty.sessions.length, 0);
  assert.equal(empty.students.length, 5);
});

test('Terrains modifiables en cours de séance : ajout, retrait avec confirmation, fermeture d\'un terrain précis', () => {
  const c = makeClass(16, 4);
  const s = newSession(c, { mode: 'pools', groupSize: 4 });
  R.startSession(c, s);
  assert.equal(s.matches.filter(m => m.court).length, 4);
  // Ajout : les nouveaux terrains sont occupés immédiatement si des matchs attendent
  assert.ok(R.setSessionCourts(c, s, 6).ok);
  checkCourts(c, s);
  assert.equal(s.matches.filter(m => m.court && !m.done).length, 6);
  assert.equal(c.courts, 4, 'le réglage de la classe n\'est pas modifié');
  // Retrait : confirmation exigée car des matchs sont en cours sur les terrains 4 à 6
  const r = R.setSessionCourts(c, s, 3);
  assert.ok(!r.ok && r.needsConfirm && r.displaced.length === 3);
  assert.equal(s.courts, 6, 'rien ne change sans confirmation');
  const displaced = r.displaced;
  assert.ok(R.setSessionCourts(c, s, 3, { confirm: true }).ok);
  checkCourts(c, s);
  assert.equal(s.matches.filter(m => m.court && !m.done).length, 3);
  displaced.forEach(id => { const m = s.matches.find(x => x.id === id); assert.ok(!m.done && !m.court, 'match renvoyé en file d\'attente'); });
  // Fermer le terrain 2 (pas forcément le dernier)
  const on2 = s.matches.find(m => m.court === 2 && !m.done);
  assert.ok(R.setCourtClosed(c, s, 2, true).needsConfirm);
  assert.ok(R.setCourtClosed(c, s, 2, true, { confirm: true }).ok);
  checkCourts(c, s);
  assert.ok(!s.matches.some(m => m.court === 2 && !m.done));
  assert.ok(!on2.court);
  assert.deepEqual(R.availableCourts(c, s), [1, 3]);
  // On ne peut pas tout fermer
  R.setCourtClosed(c, s, 1, true, { confirm: true });
  assert.equal(R.setCourtClosed(c, s, 3, true, { confirm: true }).ok, false);
  // Rouvrir
  assert.ok(R.setCourtClosed(c, s, 2, false).ok);
  assert.ok(R.setCourtClosed(c, s, 1, false).ok);
  assert.equal(s.matches.filter(m => m.court && !m.done).length, 3);
  // Terrain libre (sans match) : pas de confirmation
  playSession(c, s, rng(3));
  assert.ok(s.matches.every(m => m.done));
});

test('Changements de terrains aléatoires pendant toute une séance : jamais de conflit, tout se termine', () => {
  for (const f of FORMATS) {
    const c = makeClass(13, 3);
    const s = newSession(c, f);
    R.startSession(c, s);
    const r = rng(77);
    for (let guard = 0; guard < 3000; guard++) {
      checkCourts(c, s);
      if (r() < 0.15) {
        const op = r() < 0.6 ? R.setSessionCourts(c, s, 1 + Math.floor(r() * 6), { confirm: true }) : R.setCourtClosed(c, s, 1 + Math.floor(r() * R.totalCourts(c, s)), r() < 0.5, { confirm: true });
        if (!op.ok) assert.match(op.error, /au moins un terrain/);
        continue;
      }
      const active = s.matches.filter(m => m.court && !m.done);
      if (active.length) {
        const m = active[Math.floor(r() * active.length)];
        assert.ok(R.recordResult(c, s, m.id, r() < 0.5 ? { sa: 11, sb: 3 } : { sa: 3, sb: 11 }).ok);
        continue;
      }
      if (s.matches.some(m => !m.done && m.a && m.b)) { assert.ok(R.availableCourts(c, s).length > 0); continue; }
      if (R.canNextRound(s).ok) { R.nextRound(c, s); continue; }
      if (s.mode === 'reclass' && R.canBuildClassement(s).ok) { R.buildClassement(c, s, R.proposePartitions(s.positions.length)[0].sizes); continue; }
      if (s.mode === 'challenge' && s.matches.length < 10) {
        const o = R.challengeOrder(s);
        const i = 1 + Math.floor(r() * (o.length - 1));
        R.addChallenge(c, s, o[i], o[i - 1]);
        continue;
      }
      break;
    }
    assert.ok(s.matches.every(m => m.done), f.mode + ' : séance non terminée');
    assert.ok(R.closeSession(c, s).ok);
  }
});

test('QR : feuille de match encodée/décodée, code de résultat vérifié puis enregistré', () => {
  const c = makeClass(8, 2);
  const s = newSession(c, { mode: 'pools', groupSize: 4 });
  R.startSession(c, s);
  const m = s.matches.find(x => x.court);
  const d = R.decodeSheet(R.encodeSheet(R.sheetData(c, s, m)));
  assert.equal(d.a, c.students.find(p => p.id === m.a).name);
  assert.equal(d.t, m.court);
  // Côté tablette : code de résultat
  const code = R.resultCode(d, { sa: 11, sb: 7 });
  assert.match(code, /^RE1\.[0-9A-HJKMNP-TV-Z]{6}\.[0-9A-HJKMNP-TV-Z]{6}\.11\.7\.[0-9A-HJKMNP-TV-Z]{7}$/);
  assert.ok(R.parseResultCode(code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l')).ok, 'saisie tolérante (minuscules, O/0, L/1)');
  assert.throws(() => R.resultCode(d, { sa: 5, sb: 5 }), /nul/);
  // Côté enseignant
  const r = R.applyResultCode(c, s, code.toLowerCase());
  assert.ok(r.ok, r.error);
  assert.ok(m.done && m.sa === 11 && m.sb === 7);
  assert.ok(R.applyResultCode(c, s, code).already, 'second scan : déjà enregistré, rien ne change');
  // Résultat différent : confirmation
  const other = R.resultCode(d, { sa: 3, sb: 11 });
  const r2 = R.applyResultCode(c, s, other);
  assert.ok(!r2.ok && r2.needsConfirm);
  assert.ok(R.applyResultCode(c, s, other, { confirm: true }).ok);
  assert.equal(m.sb, 11);
  // Forfait
  const m2 = s.matches.find(x => x.court && !x.done);
  const d2 = R.decodeSheet(R.encodeSheet(R.sheetData(c, s, m2)));
  assert.ok(R.applyResultCode(c, s, R.resultCode(d2, { forfeit: 'b' })).ok);
  assert.equal(m2.forfeit, m2.b);
});

test('QR : codes refusés (faute de frappe, autre séance, inconnu, illisible)', () => {
  const c = makeClass(8, 2);
  const s = newSession(c, { mode: 'pools', groupSize: 4 });
  R.startSession(c, s);
  const m = s.matches.find(x => x.court);
  const d = R.sheetData(c, s, m);
  const code = R.resultCode(d, { sa: 11, sb: 7 });
  assert.match(R.applyResultCode(c, s, code.replace('.11.7.', '.11.8.')).error, /contrôle/);
  assert.match(R.applyResultCode(c, s, 'bonjour').error, /pas un code/);
  assert.match(R.applyResultCode(c, s, code.replace(d.s, 'ZZZZZZ')).error, /autre séance/);
  assert.match(R.applyResultCode(c, s, code.replace(d.m, 'ZZZZZZ')).error, /introuvable/);
  assert.throws(() => R.decodeSheet('!!!'));
  assert.ok(!m.done, 'aucun code refusé n\'a modifié le match');
  // Le jeton est propre à la séance : un faux code avec un autre jeton est refusé
  const forged = R.resultCode(Object.assign({}, d, { k: 'aaaaaa' }), { sa: 11, sb: 0 });
  assert.match(R.applyResultCode(c, s, forged).error, /contrôle/);
});

test('Groupes de travail : serpentin équilibré, par niveau, absents exclus, effectifs à ±1', () => {
  const ids = Array.from({ length: 10 }, (_, i) => 'r' + (i + 1));
  // Serpentin : T1 T2 T3 | T3 T2 T1 | T1 T2 T3 | T3
  assert.deepEqual(R.makeWorkGroups(ids, 3, 'balanced'), [['r1', 'r6', 'r7'], ['r2', 'r5', 'r8'], ['r3', 'r4', 'r9', 'r10']]);
  assert.deepEqual(R.makeWorkGroups(ids, 3, 'level'), [['r1', 'r2', 'r3', 'r4'], ['r5', 'r6', 'r7'], ['r8', 'r9', 'r10']]);
  assert.equal(R.makeWorkGroups(['a', 'b'], 6, 'balanced').length, 2, 'pas plus de groupes que d\'élèves');
  for (const n of [5, 7, 12, 24, 25]) for (const k of [1, 2, 3, 6]) for (const mode of ['balanced', 'level']) {
    const g = R.makeWorkGroups(Array.from({ length: n }, (_, i) => 'x' + i), k, mode);
    const sizes = g.map(x => x.length);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n);
    assert.equal(new Set(g.flat()).size, n);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${n}/${k}/${mode}`);
  }
  // Sur une vraie classe : moyennes plus proches en serpentin qu'en groupes de niveau
  const c = R.createDemoClass({ students: 24, sessions: 3, seed: 'groupes' });
  const absent = [c.students[0].id];
  assert.ok(R.buildWorkGroups(c, { courts: 4, mode: 'balanced', absent }).ok);
  assert.ok(!c.workGroups.groups.flat().includes(absent[0]));
  assert.equal(c.workGroups.groups.flat().length, 23);
  const bal = R.workGroupStats(c).spread;
  R.buildWorkGroups(c, { mode: 'level' });
  const lvl = R.workGroupStats(c).spread;
  assert.ok(bal < lvl / 3, `serpentin ${bal.toFixed(1)} vs niveau ${lvl.toFixed(1)}`);
  assert.equal(c.workGroups.courts, 4, 'réglages conservés');
  // Déplacement manuel, Elo inchangé
  const before = R.ranks(c).map(p => p.elo);
  const id = c.workGroups.groups[0][0];
  assert.ok(R.moveWorkGroup(c, id, 3).ok);
  assert.ok(c.workGroups.groups[3].includes(id));
  assert.deepEqual(R.ranks(c).map(p => p.elo), before);
});

test('Feuille de poule : tous les matchs de la poule, un code pour toute la poule', () => {
  const c = makeClass(10, 2);
  const s = newSession(c, { mode: 'pools', groupSize: 5 });
  R.startSession(c, s);
  const gi = 1, g = s.groups[gi], ms = R.groupMatches(s, gi);
  assert.equal(ms.length, 10, 'poule de 5 : 10 matchs');
  const d = R.decodePoolSheet(R.encodeSheet(R.poolSheetData(c, s, gi)));
  assert.equal(d.p.length, 5);
  assert.equal(d.pairs.length, 10);
  d.pairs.forEach(([a, b], i) => { assert.equal(g[a], ms[i].a); assert.equal(g[b], ms[i].b); });
  // URL compacte : le QR reste petit
  assert.ok(R.encodeSheet(R.poolSheetData(c, s, gi)).length < 400);
  // Les élèves jouent tous leurs matchs (dont un forfait), un match reste non joué
  const results = d.pairs.map((_, i) => (i === 9 ? null : i === 3 ? { forfeit: 'b' } : (i % 2 ? { sa: 11, sb: i } : { sa: i, sb: 11 })));
  const code = R.poolResultCode(d, results);
  assert.match(code, /^RP1\.[0-9A-Z]{6}\.1\..+\.[0-9A-Z]{7}$/);
  assert.throws(() => R.poolResultCode(d, d.pairs.map(() => ({ sa: 5, sb: 5 }))), /nul/);
  assert.throws(() => R.poolResultCode(d, d.pairs.map(() => null)), /Aucun match/);
  const r = R.applyAnyCode(c, s, code);
  assert.ok(r.ok, r.error);
  assert.equal(r.kind, 'pool');
  assert.deepEqual([r.recorded, r.unchanged, r.skipped], [9, 0, 1]);
  assert.ok(ms.slice(0, 9).every(m => m.done) && !ms[9].done);
  assert.equal(ms[3].forfeit, ms[3].b);
  assert.equal(ms[1].sa, 11);
  // Second scan : rien ne change
  const again = R.applyPoolResultCode(c, s, code);
  assert.deepEqual([again.recorded, again.unchanged], [0, 9]);
  // Correction sur la tablette puis nouveau code : confirmation des résultats différents
  results[0] = { sa: 11, sb: 0 }; results[9] = { sa: 11, sb: 8 };
  const code2 = R.poolResultCode(d, results);
  const r2 = R.applyPoolResultCode(c, s, code2);
  assert.ok(r2.needsConfirm && r2.conflicts === 1);
  const r3 = R.applyPoolResultCode(c, s, code2, { confirm: true });
  assert.deepEqual([r3.recorded, r3.unchanged, r3.skipped], [2, 8, 0]);
  assert.ok(ms.every(m => m.done));
  // Codes refusés
  assert.match(R.applyPoolResultCode(c, s, code2.replace(',11:8.', ',11:9.')).error, /contrôle/);
  assert.match(R.applyPoolResultCode(c, s, code2.replace('RP1.' + d.s, 'RP1.ZZZZZZ')).error, /autre séance/);
  assert.match(R.applyPoolResultCode(c, s, 'RP1.' + d.s + '.7.11:2.ABCDEFG').error, /introuvable/);
  // La séance peut être clôturée, les résultats comptent pour l'Elo
  playSession(c, s, rng(4));
  assert.ok(R.closeSession(c, s).ok);
});

test('Sauvegardes : export d\'une classe, import par fusion sans écraser les autres classes, rappel', () => {
  const db = R.emptyDB();
  const a = R.createDemoClass({ students: 8, sessions: 2, seed: 'A', name: 'Classe A' });
  const b = R.createDemoClass({ students: 6, sessions: 1, seed: 'B', name: 'Classe B' });
  db.classes.push(a, b); db.active = a.id;
  // Rappel : 3 séances clôturées jamais exportées
  assert.equal(R.unsavedSessions(db), 3);
  R.markExported(db, Date.now() + 1000);
  assert.equal(R.unsavedSessions(db), 0);
  // Export de la seule classe A, relu comme une sauvegarde valide
  const exp = R.parseDB(JSON.stringify(R.exportClass(db, a.id)));
  assert.equal(exp.classes.length, 1);
  assert.equal(exp.classes[0].name, 'Classe A');
  // Sur un autre appareil vide : la classe est ajoutée
  const other = R.emptyDB();
  const r1 = R.applyImport(other, exp);
  assert.equal(r1.report.added, 1);
  assert.equal(r1.db.active, a.id);
  // Sur l'appareil d'origine : classe déjà présente → ignorée par défaut, B jamais touchée
  const plan = R.planImport(db, exp);
  assert.ok(plan[0].exists);
  const skip = R.applyImport(db, exp);
  assert.deepEqual(skip.report, { added: 0, replaced: 0, copied: 0, skipped: 1 });
  // Remplacer, ou garder les deux
  const changed = JSON.parse(JSON.stringify(exp));
  changed.classes[0].students[0].name = 'Renommé';
  const rep = R.applyImport(db, changed, { [a.id]: 'replace' });
  assert.equal(rep.db.classes.find(c => c.id === a.id).students[0].name, 'Renommé');
  assert.equal(rep.db.classes.length, 2);
  assert.equal(rep.db.classes.find(c => c.id === b.id).students.length, 6, 'classe B intacte');
  const cp = R.applyImport(db, changed, { [a.id]: 'copy' });
  assert.equal(cp.db.classes.length, 3);
  assert.ok(cp.db.classes.some(c => /copie importée/.test(c.name)));
  assert.equal(db.classes.length, 2, 'les données d\'origine ne sont pas modifiées par la simulation');
});
