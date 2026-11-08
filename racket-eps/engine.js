/*
 * Racket EPS — moteur (logique pure, sans DOM, sans dépendance).
 * Navigateur : <script src="engine.js"> expose window.RacketEngine (fonctionne en file://).
 * Node (tests) : require('./engine.js').
 *
 * Règles métier implémentées (voir CLAUDE.md et README.md) :
 *  - Elo FIXE pendant la séance : chaque match validé contribue avec les Elo de DÉBUT de séance ;
 *    les variations sont sommées puis appliquées simultanément à la clôture (invariance à l'ordre).
 *  - Pas d'Elo pour : match non terminé, nul, forfait, exemption, séance non clôturée.
 *  - Le classement Elo du cycle est recalculé chronologiquement à partir des séances clôturées :
 *    une correction d'une séance passée se répercute sans double comptage.
 *  - Planification dynamique des terrains : un terrain n'accueille qu'un match à la fois et un
 *    élève ne joue jamais deux matchs en même temps.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RacketEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;
  const MODES = {
    pools: 'Poules classiques',
    challenge: 'Jeu du défi',
    ladder: 'Montante-descendante',
    swiss: 'Ronde suisse',
    reclass: 'Tournoi avec reclassement'
  };
  const GROUP_MODES = ['pools', 'ladder', 'reclass'];

  let idCounter = 0;
  function uid() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* ignore */ }
    idCounter++;
    return Date.now().toString(36) + '_' + idCounter + '_' + Math.random().toString(36).slice(2, 8);
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const nameKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  /* ------------------------------------------------------------------ *
   * Résultats d'un match
   * ------------------------------------------------------------------ */
  // Un match est « joué sportivement » s'il est validé, sans forfait, avec un vainqueur.
  function isSporting(m) {
    return !!(m.done && m.a && m.b && !m.forfeit && Number.isFinite(m.sa) && Number.isFinite(m.sb) && m.sa !== m.sb);
  }
  function winnerOf(m) {
    if (!m.done) return null;
    if (m.forfeit) return m.forfeit === m.a ? m.b : m.a;
    return m.sa > m.sb ? m.a : (m.sb > m.sa ? m.b : null);
  }
  function loserOf(m) {
    if (!m.done) return null;
    if (m.forfeit) return m.forfeit;
    return m.sa > m.sb ? m.b : (m.sb > m.sa ? m.a : null);
  }

  function validateScore(sa, sb) {
    if (sa === '' || sb === '' || sa == null || sb == null) return 'Saisissez les deux scores.';
    const a = Number(sa), b = Number(sb);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return 'Les scores doivent être des nombres entiers.';
    if (a < 0 || b < 0) return 'Les scores ne peuvent pas être négatifs.';
    if (a > 999 || b > 999) return 'Score trop élevé.';
    if (a === b) return 'Match nul impossible : jouez un point décisif.';
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Elo et statistiques du cycle
   * ------------------------------------------------------------------ */
  function expected(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  /** Variations Elo d'une séance : somme des contributions, calculées avec les Elo de début. */
  function sessionDeltas(matches, startElo, k) {
    const delta = {};
    matches.forEach(m => {
      if (!isSporting(m) || startElo[m.a] == null || startElo[m.b] == null) return;
      const ea = expected(startElo[m.a], startElo[m.b]);
      const sA = m.sa > m.sb ? 1 : 0;
      const d = k * (sA - ea);
      delta[m.a] = (delta[m.a] || 0) + d;
      delta[m.b] = (delta[m.b] || 0) - d;
    });
    return delta;
  }

  function initialElo(c, p) {
    if (p && Number.isFinite(p.initialElo)) return p.initialElo;
    return Number.isFinite(c.initialElo) ? c.initialElo : 1000;
  }

  /**
   * Recalcule tout le cycle à partir des séances clôturées, dans l'ordre chronologique (seq).
   * Les absents conservent leur Elo. Les valeurs ne sont jamais arrondies en mémoire.
   */
  function computeStats(c) {
    const map = {};
    c.students.forEach(p => {
      map[p.id] = {
        id: p.id, name: p.name, elo: initialElo(c, p), played: 0, wins: 0, losses: 0,
        forfeitWins: 0, forfeitLosses: 0, for: 0, against: 0, opponents: new Set(),
        sessions: 0, absences: 0, history: [], lastDelta: 0
      };
    });
    const closed = c.sessions.filter(s => s.status === 'closed').sort((a, b) => a.seq - b.seq);
    closed.forEach(s => {
      const start = {};
      Object.keys(map).forEach(id => { start[id] = map[id].elo; });
      const delta = sessionDeltas(s.matches, start, s.k != null ? s.k : (c.k != null ? c.k : 32));
      const playedIds = new Set();
      s.matches.forEach(m => {
        if (!m.done || !map[m.a] || !map[m.b]) return;
        const A = map[m.a], B = map[m.b];
        const w = winnerOf(m);
        if (!w) return;
        A.played++; B.played++;
        playedIds.add(m.a); playedIds.add(m.b);
        if (m.forfeit) {
          map[w].wins++; map[w].forfeitWins++;
          map[m.forfeit].losses++; map[m.forfeit].forfeitLosses++;
        } else {
          (w === m.a ? A : B).wins++;
          (w === m.a ? B : A).losses++;
          A.for += m.sa; A.against += m.sb; B.for += m.sb; B.against += m.sa;
        }
        A.opponents.add(m.b); B.opponents.add(m.a);
      });
      Object.keys(map).forEach(id => {
        const d = delta[id] || 0;
        map[id].elo += d;
        map[id].lastDelta = d;
        if (playedIds.has(id)) map[id].sessions++;
        if ((s.absent || []).includes(id)) map[id].absences++;
      });
      // Rang après la séance (départage stable : Elo, puis nom, puis identifiant).
      const order = Object.values(map).sort(cmpRank);
      order.forEach((p, i) => {
        p.history.push({ seq: s.seq, sessionId: s.id, date: s.date, elo: p.elo, delta: delta[p.id] || 0, rank: i + 1, absent: (s.absent || []).includes(p.id) });
      });
    });
    return map;
  }

  function cmpRank(a, b) {
    return (b.elo - a.elo) || a.name.localeCompare(b.name, 'fr') || (a.id < b.id ? -1 : 1);
  }

  function ranks(c) {
    const st = computeStats(c);
    return c.students.map(p => st[p.id]).sort(cmpRank);
  }

  /* ------------------------------------------------------------------ *
   * Séances : création, appel, placement
   * ------------------------------------------------------------------ */
  function activeSession(c) {
    return c.sessions.find(s => s.status !== 'closed') || null;
  }

  function createSession(c, opts) {
    if (activeSession(c)) return fail('Une séance est déjà en cours : terminez-la ou annulez-la.');
    if (c.students.length < 2) return fail('Ajoutez au moins 2 élèves.');
    const mode = MODES[opts.mode] ? opts.mode : 'pools';
    const s = {
      id: uid(), seq: Math.max(0, ...c.sessions.map(x => x.seq)) + 1, date: opts.date || new Date().toISOString().slice(0, 10),
      mode, status: 'setup', absent: [], positions: [], groups: null, matches: [], round: 0,
      rounds: clampInt(opts.rounds, 1, 30, mode === 'swiss' || mode === 'ladder' ? 4 : 3),
      target: clampInt(opts.target, 1, 99, 11),
      groupSize: clampInt(opts.groupSize, 2, 6, 4),
      ladderType: opts.ladderType === 'single' ? 'single' : 'group',
      move: opts.move === 2 || opts.move === '2' ? 2 : 1,
      gap: clampInt(opts.gap, 1, 50, 3),
      legs: opts.legs === 2 || opts.legs === '2' ? 2 : 1,
      permutation: opts.permutation === 'none' ? 'none' : 'swap',
      k: c.k != null ? c.k : 32,
      byes: [], moves: [], phase: mode === 'reclass' ? 'brassage' : null, divisions: []
    };
    c.sessions.push(s);
    proposePlacement(c, s);
    return { ok: true, session: s };
  }

  function clampInt(v, min, max, def) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  }

  function fail(error, extra) { return Object.assign({ ok: false, error }, extra || {}); }

  function presentIds(c, s) {
    return ranks(c).filter(p => !s.absent.includes(p.id)).map(p => p.id);
  }

  function isGroupMode(s) { return GROUP_MODES.includes(s.mode); }

  // Répartit n éléments en g groupes de tailles équilibrées (écart ≤ 1), dans l'ordre.
  function balancedGroups(ids, g) {
    g = Math.max(1, Math.min(g, ids.length || 1));
    const base = Math.floor(ids.length / g), extra = ids.length % g;
    const out = [];
    let k = 0;
    for (let i = 0; i < g; i++) {
      const size = base + (i < extra ? 1 : 0);
      out.push(ids.slice(k, k + size));
      k += size;
    }
    return out.filter(x => x.length);
  }

  /**
   * Nombre de groupes pour une taille souhaitée : on cherche des groupes de 3 à 6 joueurs
   * aussi proches que possible de la taille demandée (le surplus n'est jamais entassé dans le
   * dernier groupe — bug du prototype V1). Les groupes peuvent dépasser le nombre de terrains :
   * ils partagent alors les terrains successivement.
   */
  function groupCount(n, size) {
    if (n <= 0) return 1;
    if (size <= 2) return Math.max(1, Math.floor(n / 2));
    let best = Math.max(1, Math.ceil(n / size)), bestScore = Infinity;
    for (let g = 1; g <= n; g++) {
      const lo = Math.floor(n / g), hi = Math.ceil(n / g);
      if (lo < 2) break;
      const valid = lo >= 3 && hi <= 6;
      const score = (valid ? 0 : 100) + Math.abs(n / g - size);
      if (score < bestScore - 1e-9) { bestScore = score; best = g; }
    }
    return best;
  }

  function makeGroups(s, ids) {
    if (s.mode === 'ladder' && s.ladderType === 'single') {
      // Montante-descendante individuelle : 2 par terrain ; si effectif impair, le dernier terrain en a 3.
      const groups = [];
      for (let i = 0; i + 1 < ids.length; i += 2) groups.push(ids.slice(i, i + 2));
      if (ids.length % 2 === 1) {
        if (groups.length) groups[groups.length - 1].push(ids[ids.length - 1]);
        else groups.push([ids[0]]);
      }
      return groups;
    }
    return balancedGroups(ids, groupCount(ids.length, s.groupSize));
  }

  /** Proposition automatique : ordre Elo des présents ; groupes par terrain pour les formats de groupes. */
  function proposePlacement(c, s) {
    s.positions = presentIds(c, s);
    s.groups = isGroupMode(s) ? makeGroups(s, s.positions) : null;
    return s;
  }

  function setAbsent(c, s, id, absent) {
    if (s.status !== 'setup') return fail('L\'appel se fait avant de valider les terrains.');
    s.absent = s.absent.filter(x => x !== id);
    if (absent) s.absent.push(id);
    proposePlacement(c, s);
    return { ok: true };
  }

  /** Déplace un élève dans un autre groupe (formats de groupes). N'affecte jamais l'Elo. */
  function moveToGroup(s, id, groupIndex) {
    if (!s.groups) return fail('Ce format n\'utilise pas de groupes.');
    const from = s.groups.findIndex(g => g.includes(id));
    if (from < 0 || groupIndex < 0 || groupIndex >= s.groups.length + 1) return fail('Déplacement impossible.');
    if (from === groupIndex) return { ok: true };
    s.groups[from] = s.groups[from].filter(x => x !== id);
    if (groupIndex === s.groups.length) s.groups.push([]);
    s.groups[groupIndex].push(id);
    s.groups = s.groups.filter(g => g.length);
    s.positions = s.groups.flat();
    return { ok: true };
  }

  /** Échange la position d'un élève avec son voisin (formats sans groupes). */
  function shiftPosition(s, id, dir) {
    const i = s.positions.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= s.positions.length) return fail('Déplacement impossible.');
    [s.positions[i], s.positions[j]] = [s.positions[j], s.positions[i]];
    return { ok: true };
  }

  function placementWarnings(s) {
    const w = [];
    if (s.groups) {
      s.groups.forEach((g, i) => {
        if (g.length < 2) w.push('Groupe ' + (i + 1) + ' : un seul élève, il ne pourra pas jouer.');
        if (g.length > 6) w.push('Groupe ' + (i + 1) + ' : ' + g.length + ' élèves, beaucoup de matchs (' + g.length * (g.length - 1) / 2 + ').');
      });
    }
    return w;
  }

  /** Validation des terrains par l'enseignant : génère les premiers matchs. */
  function startSession(c, s) {
    if (s.status !== 'setup') return fail('Séance déjà démarrée.');
    if (s.positions.length < 2) return fail('Il faut au moins 2 élèves présents.');
    if (s.groups && s.groups.some(g => g.length < 2)) return fail('Chaque groupe doit compter au moins 2 élèves.');
    s.status = 'playing';
    s.round = 1;
    s.order = s.positions.slice(); // rang local de départ (jeu du défi, départages)
    if (s.mode === 'pools' || s.mode === 'reclass') {
      s.groups.forEach((g, gi) => {
        roundRobin(g, s.mode === 'pools' ? s.legs : 1).forEach(([a, b, r]) => {
          s.matches.push(newMatch(a, b, r + 1, { group: gi, pref: gi + 1, phase: s.mode === 'reclass' ? 'brassage' : null }));
        });
      });
    } else if (s.mode === 'swiss') {
      generateSwissRound(s);
    } else if (s.mode === 'ladder') {
      s.groupsByRound = { 1: clone(s.groups) };
      generateLadderMatches(s);
    }
    autoAssign(c, s);
    return { ok: true };
  }

  function newMatch(a, b, round, extra) {
    return Object.assign({ id: uid(), a, b, sa: null, sb: null, done: false, round, court: null, pref: null, forfeit: null }, extra || {});
  }

  // Tous contre tous, méthode du cercle : chaque « tour » ne contient qu'un match par joueur.
  function roundRobin(ids, legs) {
    const arr = ids.slice();
    if (arr.length % 2 === 1) arr.push(null);
    const n = arr.length, out = [];
    let cur = arr.slice();
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) {
        const a = cur[i], b = cur[n - 1 - i];
        if (a && b) out.push([a, b, r]);
      }
      cur = [cur[0], cur[n - 1]].concat(cur.slice(1, n - 1));
    }
    if (legs === 2) out.slice().forEach(([a, b, r]) => out.push([b, a, r + n - 1]));
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Planification des terrains
   * ------------------------------------------------------------------ *
   * Un match « prêt » (deux joueurs connus, non validé) reçoit un terrain libre si aucun de ses
   * joueurs n'est déjà sur un terrain. Priorité : ronde la plus ancienne, puis ordre de création ;
   * le terrain « préféré » (celui du groupe) est choisi s'il est libre.
   */
  function autoAssign(c, s) {
    if (s.status !== 'playing') return [];
    const courts = Math.max(1, c.courts || 1);
    const busyCourts = new Set(), busy = new Set();
    s.matches.forEach(m => {
      if (m.court && !m.done) {
        if (m.court > courts) { m.court = null; return; }
        busyCourts.add(m.court); busy.add(m.a); busy.add(m.b);
      }
    });
    const assigned = [];
    const queue = s.matches.map((m, i) => ({ m, i }))
      .filter(x => !x.m.done && !x.m.court && x.m.a && x.m.b)
      .sort((x, y) => (x.m.round - y.m.round) || (x.i - y.i));
    for (const { m } of queue) {
      if (busyCourts.size >= courts) break;
      if (busy.has(m.a) || busy.has(m.b)) continue;
      let court = m.pref && m.pref <= courts && !busyCourts.has(m.pref) ? m.pref : null;
      if (!court) for (let t = 1; t <= courts; t++) if (!busyCourts.has(t)) { court = t; break; }
      if (!court) break;
      m.court = court;
      busyCourts.add(court); busy.add(m.a); busy.add(m.b);
      assigned.push(m.id);
    }
    return assigned;
  }

  function matchState(m) {
    if (m.done) return 'done';
    if (!m.a || !m.b) return 'pending';
    if (m.court) return 'playing';
    return 'waiting';
  }

  /* ------------------------------------------------------------------ *
   * Saisie / correction des résultats
   * ------------------------------------------------------------------ */
  /**
   * input : { sa, sb } ou { forfeit: idDuPerdant }. Pour le reclassement, une correction qui change
   * un vainqueur invalide les matchs dépendants : needsConfirm est renvoyé sans opts.confirm.
   */
  function recordResult(c, s, matchId, input, opts) {
    opts = opts || {};
    if (s.status === 'closed') return fail('Séance clôturée : rouvrez-la depuis l\'historique pour corriger.');
    if (s.status !== 'playing') return fail('La séance n\'a pas commencé.');
    const m = s.matches.find(x => x.id === matchId);
    if (!m) return fail('Match introuvable.');
    if (!m.a || !m.b) return fail('Les deux joueurs ne sont pas encore connus.');
    let apply;
    if (input && input.forfeit) {
      if (input.forfeit !== m.a && input.forfeit !== m.b) return fail('Joueur forfait inconnu.');
      apply = x => { x.forfeit = input.forfeit; x.sa = null; x.sb = null; x.done = true; };
    } else {
      const err = validateScore(input && input.sa, input && input.sb);
      if (err) return fail(err);
      apply = x => { x.forfeit = null; x.sa = Number(input.sa); x.sb = Number(input.sb); x.done = true; };
    }
    return applyChange(c, s, m, x => { apply(x); x.court = null; x.invalidated = null; x.resultPlayers = [x.a, x.b]; }, opts);
  }

  function clearResult(c, s, matchId, opts) {
    const m = s.matches.find(x => x.id === matchId);
    if (!m) return fail('Match introuvable.');
    if (s.status !== 'playing') return fail('Séance non modifiable.');
    return applyChange(c, s, m, x => { x.done = false; x.sa = null; x.sb = null; x.forfeit = null; }, opts || {});
  }

  function applyChange(c, s, m, mutate, opts) {
    // Simulation pour détecter les conséquences en aval (reclassement) ou les rondes suivantes.
    const sim = clone(s);
    mutate(sim.matches.find(x => x.id === m.id));
    const invalidated = resolve(sim);
    const laterRound = (s.mode === 'swiss' || s.mode === 'ladder') && s.matches.some(x => x.round > m.round);
    if ((invalidated.length || laterRound) && !opts.confirm) {
      const msg = [];
      if (invalidated.length) msg.push(invalidated.length + ' match(s) suivant(s) dépendant de ce résultat seront invalidés et à rejouer.');
      if (laterRound) msg.push('La ronde suivante a déjà été générée avec l\'ancien résultat : elle est conservée (pas de régénération automatique).');
      return fail(msg.join(' '), { needsConfirm: true, invalidated });
    }
    mutate(m);
    resolve(s);
    if (s.mode === 'challenge') s.order = challengeOrder(s);
    autoAssign(c, s);
    return { ok: true, invalidated };
  }

  /**
   * Recalcule les joueurs des matchs alimentés par d'autres matchs (tableaux de reclassement) et
   * invalide les résultats devenus incohérents. Renvoie les identifiants des matchs invalidés.
   */
  function resolve(s) {
    const byId = new Map(s.matches.map(m => [m.id, m]));
    const inv = [];
    s.matches.forEach(m => {
      ['A', 'B'].forEach(side => {
        const src = m['source' + side];
        if (!src) return;
        const sm = byId.get(src.matchId);
        const id = sm && sm.done ? (src.take === 'winner' ? winnerOf(sm) : loserOf(sm)) : null;
        m[side === 'A' ? 'a' : 'b'] = id;
      });
      if (m.done && m.resultPlayers && (m.resultPlayers[0] !== m.a || m.resultPlayers[1] !== m.b)) {
        m.invalidated = { sa: m.sa, sb: m.sb, forfeit: m.forfeit };
        m.done = false; m.sa = null; m.sb = null; m.forfeit = null;
        inv.push(m.id);
      }
      if ((!m.a || !m.b) && m.court && !m.done) m.court = null;
    });
    return inv;
  }

  /* ------------------------------------------------------------------ *
   * Classement provisoire de la séance (distinct de l'Elo)
   * ------------------------------------------------------------------ */
  function sessionStandings(c, s, filter) {
    const st = {};
    const ids = s.positions.length ? s.positions : presentIds(c, s);
    ids.forEach((id, i) => { st[id] = { id, pos: i, played: 0, wins: 0, losses: 0, byes: 0, pf: 0, pa: 0, points: 0 }; });
    s.matches.filter(m => m.done && (!filter || filter(m))).forEach(m => {
      const w = winnerOf(m), l = loserOf(m);
      if (!st[m.a] || !st[m.b] || !w) return;
      st[m.a].played++; st[m.b].played++;
      st[w].wins++; st[l].losses++;
      if (!m.forfeit) { st[m.a].pf += m.sa; st[m.a].pa += m.sb; st[m.b].pf += m.sb; st[m.b].pa += m.sa; }
    });
    (s.byes || []).forEach(b => { if (st[b.id]) st[b.id].byes++; });
    const list = Object.values(st);
    list.forEach(x => {
      x.points = x.wins + x.byes; // exemption = 1 point de tournoi, jamais d'Elo
      x.diff = x.pf - x.pa;
      x.rate = x.played ? x.wins / x.played : 0;
      x.avgDiff = x.played ? x.diff / x.played : 0;
    });
    // Départage stable : points, différence, points marqués, position de départ validée.
    list.sort((a, b) => (b.points - a.points) || (b.diff - a.diff) || (b.pf - a.pf) || (a.pos - b.pos));
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  }

  /* ------------------------------------------------------------------ *
   * Ronde suisse — appariement exact de coût minimal (repris de tournoi-eps/engine.js)
   * ------------------------------------------------------------------ */
  function minCostPerfectMatching(n, costFn, budget) {
    budget = budget || 300000;
    if (n === 0) return { pairs: [], cost: 0, optimal: true };
    const cost = [], pref = [], minEdge = [];
    for (let i = 0; i < n; i++) { cost.push([]); for (let j = 0; j < n; j++) cost[i].push(i === j ? Infinity : costFn(i, j)); }
    for (let i = 0; i < n; i++) {
      const js = []; for (let j = 0; j < n; j++) if (j !== i) js.push(j);
      js.sort((x, y) => cost[i][x] - cost[i][y] || x - y);
      pref.push(js); minEdge.push(cost[i][js[0]]);
    }
    const used = new Array(n).fill(false), pairs = [];
    let best = Infinity, bestPairs = null, nodes = 0, aborted = false;
    (function dfs(cur, lb) {
      if (aborted) return;
      if (++nodes > budget) { aborted = true; return; }
      let i = -1;
      for (let k = 0; k < n; k++) if (!used[k]) { i = k; break; }
      if (i < 0) { if (cur < best) { best = cur; bestPairs = pairs.slice(); } return; }
      used[i] = true;
      for (const j of pref[i]) {
        if (used[j]) continue;
        const nlb = lb - minEdge[i] / 2 - minEdge[j] / 2, cc = cur + cost[i][j];
        if (cc + nlb >= best - 1e-9) continue;
        used[j] = true; pairs.push([i, j]);
        dfs(cc, nlb);
        pairs.pop(); used[j] = false;
        if (aborted && bestPairs) break;
      }
      used[i] = false;
    })(0, minEdge.reduce((a, b) => a + b, 0) / 2);
    return { pairs: bestPairs || [], cost: best, optimal: !aborted };
  }

  /**
   * Ronde suisse : coût = 1000 × rencontres déjà jouées + 10 × (écart de points)² + |écart de rang|.
   * Exemption (effectif impair) : priorité à ceux qui n'en ont pas eu, puis au classement le plus bas ;
   * 1 point de tournoi, aucune variation Elo.
   */
  function generateSwissRound(s) {
    const standings = sessionStandingsLite(s);
    const ids = standings.map(x => x.id);
    const seen = new Map();
    s.matches.forEach(m => { if (m.a && m.b) seen.set(pairKey(m.a, m.b), (seen.get(pairKey(m.a, m.b)) || 0) + 1); });
    const byeCount = id => (s.byes || []).filter(b => b.id === id).length;
    const solve = list => {
      const rank = new Map(list.map((id, i) => [id, i]));
      const pts = new Map(standings.map(x => [x.id, x.points]));
      return minCostPerfectMatching(list.length, (i, j) => {
        const a = list[i], b = list[j], d = pts.get(a) - pts.get(b);
        return 1000 * (seen.get(pairKey(a, b)) || 0) + 10 * d * d + Math.abs(rank.get(a) - rank.get(b));
      });
    };
    let pairs, bye = null, optimal = true;
    if (ids.length % 2 === 1) {
      const minBye = Math.min(...ids.map(byeCount));
      const candidates = ids.filter(id => byeCount(id) === minBye).reverse().slice(0, 4);
      let best = null;
      candidates.forEach(id => {
        const rest = ids.filter(x => x !== id), sol = solve(rest);
        if (!best || sol.cost < best.sol.cost) best = { id, rest, sol };
      });
      bye = best.id; optimal = best.sol.optimal;
      pairs = best.sol.pairs.map(([i, j]) => [best.rest[i], best.rest[j]]);
    } else {
      const sol = solve(ids); optimal = sol.optimal;
      pairs = sol.pairs.map(([i, j]) => [ids[i], ids[j]]);
    }
    pairs.forEach(([a, b]) => s.matches.push(newMatch(a, b, s.round)));
    if (bye) s.byes.push({ round: s.round, id: bye });
    s.lastPairing = { optimal, repeats: pairs.filter(([a, b]) => seen.has(pairKey(a, b))).length };
  }

  // Classement de séance sans dépendre de la classe (positions validées comme départage).
  function sessionStandingsLite(s) {
    return sessionStandings({ students: [], sessions: [] }, s);
  }

  /* ------------------------------------------------------------------ *
   * Montante-descendante
   * ------------------------------------------------------------------ */
  function groupRanking(s, group, round) {
    const ms = s.matches.filter(m => m.round === round && m.done && group.includes(m.a) && group.includes(m.b));
    const st = group.map((id, i) => ({ id, i, w: 0, d: 0, pf: 0 }));
    const get = id => st.find(x => x.id === id);
    ms.forEach(m => {
      const w = winnerOf(m);
      if (w) get(w).w++;
      if (!m.forfeit) { get(m.a).d += m.sa - m.sb; get(m.b).d += m.sb - m.sa; get(m.a).pf += m.sa; get(m.b).pf += m.sb; }
    });
    // Victoires, différence, points marqués, puis ordre d'arrivée sur le terrain (stable).
    return st.sort((a, b) => (b.w - a.w) || (b.d - a.d) || (b.pf - a.pf) || (a.i - b.i)).map(x => x.id);
  }

  function generateLadderMatches(s) {
    s.groups.forEach((g, gi) => {
      roundRobin(g, 1).forEach(([a, b, r]) => s.matches.push(newMatch(a, b, s.round, { group: gi, pref: gi + 1, sub: r })));
    });
  }

  /**
   * Rotation suivante : classement dans chaque groupe, puis les « move » derniers du terrain i
   * échangent avec les « move » premiers du terrain i+1. Terrain 1 : personne ne monte ;
   * dernier terrain : personne ne descend. Les mouvements ne modifient pas l'Elo.
   */
  function nextLadderRotation(s) {
    const prev = s.round;
    const ranked = s.groups.map(g => groupRanking(s, g, prev));
    const moveN = s.ladderType === 'single' ? 1 : s.move;
    const next = ranked.map(g => g.slice());
    for (let i = 0; i < next.length - 1; i++) {
      const n = Math.min(moveN, ranked[i].length - 1, ranked[i + 1].length - 1);
      const down = ranked[i].slice(ranked[i].length - n), up = ranked[i + 1].slice(0, n);
      next[i] = next[i].filter(x => !down.includes(x)).concat(up);
      next[i + 1] = down.concat(next[i + 1].filter(x => !up.includes(x)));
    }
    const moves = [];
    next.forEach((g, gi) => g.forEach(id => {
      const from = s.groups.findIndex(x => x.includes(id));
      if (from !== gi) moves.push({ round: prev + 1, id, from: from + 1, to: gi + 1 });
    }));
    s.moves.push(...moves);
    s.groups = next;
    s.round = prev + 1;
    s.groupsByRound = s.groupsByRound || {};
    s.groupsByRound[s.round] = clone(next);
    generateLadderMatches(s);
    return moves;
  }

  function canNextRound(s) {
    if (s.status !== 'playing' || !['swiss', 'ladder'].includes(s.mode)) return { ok: false, reason: 'Format sans rondes.' };
    if (s.round >= s.rounds) return { ok: false, reason: 'Nombre de rondes atteint.' };
    if (s.matches.some(m => !m.done)) return { ok: false, reason: 'Terminez d\'abord tous les matchs de la ronde.' };
    return { ok: true };
  }

  function nextRound(c, s) {
    const can = canNextRound(s);
    if (!can.ok) return fail(can.reason);
    if (s.mode === 'swiss') { s.round++; generateSwissRound(s); }
    else nextLadderRotation(s);
    autoAssign(c, s);
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * Jeu du défi
   * ------------------------------------------------------------------ *
   * Le rang local part de l'ordre validé ; il est rejoué chronologiquement à chaque résultat :
   * avec la permutation « swap », un défiant moins bien classé qui gagne prend la place du défié
   * (les élèves intermédiaires reculent d'un rang). Toutes les rencontres comptent pour l'Elo.
   */
  function challengeOrder(s) {
    let order = (s.order0 || s.positions).slice();
    s.matches.filter(m => m.done).sort((a, b) => (a.seq || 0) - (b.seq || 0)).forEach(m => {
      if (s.permutation !== 'swap') return;
      const w = winnerOf(m), l = loserOf(m);
      const iw = order.indexOf(w), il = order.indexOf(l);
      if (iw < 0 || il < 0 || iw < il) return;
      order.splice(iw, 1);
      order.splice(il, 0, w);
    });
    return order;
  }

  function addChallenge(c, s, challenger, defender) {
    if (s.mode !== 'challenge' || s.status !== 'playing') return fail('Pas de jeu du défi en cours.');
    s.order0 = s.order0 || s.positions.slice();
    const order = challengeOrder(s);
    const i = order.indexOf(challenger), j = order.indexOf(defender);
    if (i < 0 || j < 0) return fail('Élève absent ou inconnu.');
    if (i === j) return fail('Un élève ne peut pas se défier lui-même.');
    if (Math.abs(i - j) > s.gap) return fail('Écart de rang trop grand (' + Math.abs(i - j) + ' > ' + s.gap + ').');
    const busy = s.matches.some(m => !m.done && [m.a, m.b].some(x => x === challenger || x === defender));
    if (busy) return fail('Un des deux élèves a déjà un défi en cours ou en attente.');
    s.challengeSeq = (s.challengeSeq || 0) + 1;
    s.matches.push(newMatch(challenger, defender, 1, { seq: s.challengeSeq }));
    autoAssign(c, s);
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * Tournoi avec reclassement : brassage en poules puis tableaux intégraux
   * ------------------------------------------------------------------ */
  const isPow2 = n => n >= 1 && (n & (n - 1)) === 0;
  const POOL_SIZES = [3, 5, 6];
  const BRACKET_SIZES = [2, 4, 8, 16, 32, 64];
  function divisionFormat(size) {
    if (size >= 2 && isPow2(size)) return 'bracket';
    if (POOL_SIZES.includes(size)) return 'pool';
    return null;
  }
  function matchesPerPlayer(size) { return divisionFormat(size) === 'bracket' ? Math.round(Math.log2(size)) : size - 1; }
  function matchesInDivision(size) { return divisionFormat(size) === 'bracket' ? size * Math.round(Math.log2(size)) / 2 : size * (size - 1) / 2; }

  function validatePartition(sizes, n) {
    if (!Array.isArray(sizes) || !sizes.length) return { ok: false, error: 'Partition vide.' };
    const bad = sizes.filter(x => !Number.isInteger(x) || !divisionFormat(x));
    if (bad.length) return { ok: false, error: 'Tailles non autorisées : ' + bad.join(', ') + ' (tableau : 2, 4, 8, 16, 32 ; poule : 3, 5, 6).' };
    const sum = sizes.reduce((a, b) => a + b, 0);
    if (sum !== n) return { ok: false, error: 'La somme (' + sum + ') doit être égale au nombre de présents (' + n + ').' };
    return { ok: true };
  }

  function describePartition(sizes) {
    let start = 1;
    const divisions = sizes.map((size, i) => {
      const d = { name: String.fromCharCode(65 + i), size, format: divisionFormat(size), start, end: start + size - 1, mpp: matchesPerPlayer(size), matches: matchesInDivision(size) };
      start += size;
      return d;
    });
    const mpp = divisions.map(d => d.mpp);
    const warnings = [];
    if (divisions.length > 1) warnings.push('Les frontières de divisions sont fixées par le brassage : un élève ne peut pas finir devant un élève d\'une division supérieure.');
    if (Math.max(...mpp) !== Math.min(...mpp)) warnings.push('Nombre de matchs inégal selon la division (' + Math.min(...mpp) + ' à ' + Math.max(...mpp) + ').');
    if (divisions.some(d => d.format === 'pool')) warnings.push('Au moins une division en poule : ce n\'est plus un tableau intégral pur.');
    if (divisions.some(d => d.size === 2)) warnings.push('Une division de 2 ne comporte qu\'un match.');
    return { sizes, divisions, total: divisions.reduce((a, d) => a + d.matches, 0), warnings };
  }

  /** Propositions de divisions (même heuristique que tournoi-eps). */
  function proposePartitions(n, limit) {
    limit = limit || 4;
    if (n < 2) return [];
    const allowed = BRACKET_SIZES.concat(POOL_SIZES).filter(x => x <= n).sort((a, b) => b - a);
    const maxDiv = Math.min(12, Math.ceil(n / 3) + 1), found = [];
    (function rec(rem, max, acc) {
      if (found.length > 3000) return;
      if (rem === 0) { found.push(acc.slice()); return; }
      if (acc.length >= maxDiv) return;
      for (const sz of allowed) { if (sz > max || sz > rem) continue; acc.push(sz); rec(rem - sz, sz, acc); acc.pop(); }
    })(n, Infinity, []);
    const scored = found.map(sizes => {
      const d = describePartition(sizes);
      const mpp = d.divisions.map(x => x.mpp);
      const avg = sizes.reduce((a, sz, i) => a + sz * mpp[i], 0) / n;
      const poolCost = d.divisions.filter(x => x.format === 'pool').reduce((a, x) => a + 3 + 2 * (x.size - 3), 0);
      const score = 5 * (Math.max(...mpp) - Math.min(...mpp)) + 1.5 * (sizes.length - 1) + poolCost
        + 25 * sizes.filter(x => x === 2).length + 4 * Math.max(0, 3 - avg) + (poolCost ? 3 * Math.max(0, avg - 4) : 0);
      return Object.assign(d, { score });
    }).sort((a, b) => a.score - b.score || b.sizes[0] - a.sizes[0]);
    const out = scored.slice(0, limit);
    if (out.length) out[0].recommended = true;
    return out;
  }

  function seedOrder(n) {
    let order = [1, 2];
    while (order.length < n) {
      const m = order.length * 2, next = [];
      order.forEach(x => { next.push(x); next.push(m + 1 - x); });
      order = next;
    }
    return order.slice(0, n);
  }

  /** Classement du brassage : taux de victoires, différence moyenne, points moyens, position validée. */
  function brassageRanking(s) {
    const st = sessionStandings({ students: [], sessions: [] }, Object.assign({}, s, { byes: [] }), m => m.phase === 'brassage');
    const avgFor = x => (x.played ? x.pf / x.played : 0);
    // Moyennes : les poules peuvent avoir des tailles différentes (3 ou 4 élèves, etc.).
    st.sort((a, b) => (b.rate - a.rate) || (b.avgDiff - a.avgDiff) || (avgFor(b) - avgFor(a)) || (a.pos - b.pos));
    return st.map((x, i) => Object.assign({}, x, { rank: i + 1 }));
  }

  function canBuildClassement(s) {
    if (s.mode !== 'reclass' || s.status !== 'playing') return { ok: false, reason: 'Pas de tournoi avec reclassement en cours.' };
    if (s.phase !== 'brassage') return { ok: false, reason: 'Le reclassement est déjà généré.' };
    const br = s.matches.filter(m => m.phase === 'brassage');
    if (!br.length || br.some(m => !m.done)) return { ok: false, reason: 'Terminez tous les matchs de brassage.' };
    return { ok: true };
  }

  function buildClassement(c, s, sizes) {
    const can = canBuildClassement(s);
    if (!can.ok) return fail(can.reason);
    const v = validatePartition(sizes, s.positions.length);
    if (!v.ok) return fail(v.error);
    const order = brassageRanking(s).map(x => x.id);
    let off = 0, start = 1;
    s.divisions = [];
    sizes.forEach((size, di) => {
      const ids = order.slice(off, off + size);
      const name = String.fromCharCode(65 + di);
      const fmt = divisionFormat(size);
      s.divisions.push({ name, ids, start, size, format: fmt });
      if (fmt === 'bracket') buildBracket(s, name, ids, start);
      else roundRobin(ids, 1).forEach(([a, b, r]) => s.matches.push(newMatch(a, b, 2 + r, { phase: 'classement', division: name, places: [start, start + size - 1] })));
      off += size; start += size;
    });
    s.phase = 'classement';
    s.round = 2;
    autoAssign(c, s);
    return { ok: true };
  }

  // Tableau intégral : vainqueurs vers les places hautes, perdants vers les places basses, à chaque tour.
  function buildBracket(s, division, ids, start) {
    const slots = seedOrder(ids.length).map(k => ({ player: ids[k - 1] }));
    let num = 0;
    (function rec(group, placeStart, depth) {
      const m = group.length, made = [];
      for (let i = 0; i < m / 2; i++) {
        const A = group[2 * i], B = group[2 * i + 1];
        num++;
        const match = newMatch(A.player || null, B.player || null, 2 + depth, {
          phase: 'classement', division, number: num, depth,
          places: [placeStart, placeStart + m - 1], final: m === 2,
          sourceA: A.match ? { matchId: A.match, take: A.take } : null,
          sourceB: B.match ? { matchId: B.match, take: B.take } : null
        });
        s.matches.push(match);
        made.push(match);
      }
      if (m === 2) return;
      rec(made.map(x => ({ match: x.id, take: 'winner' })), placeStart, depth + 1);
      rec(made.map(x => ({ match: x.id, take: 'loser' })), placeStart + m / 2, depth + 1);
    })(slots, start, 0);
  }

  /** Places de la séance (reclassement). null = pas encore attribuée. */
  function reclassPlaces(s) {
    const places = new Map();
    (s.divisions || []).forEach(d => {
      const ms = s.matches.filter(m => m.division === d.name);
      if (d.format === 'bracket') {
        ms.filter(m => m.final && m.done).forEach(m => { places.set(winnerOf(m), m.places[0]); places.set(loserOf(m), m.places[0] + 1); });
      } else if (ms.every(m => m.done)) {
        const sub = sessionStandings({ students: [], sessions: [] }, Object.assign({}, s, { positions: d.ids, byes: [] }), m => m.division === d.name);
        sub.forEach((x, i) => places.set(x.id, d.start + i));
      }
    });
    return places;
  }

  /* ------------------------------------------------------------------ *
   * Clôture, annulation, réouverture
   * ------------------------------------------------------------------ */
  function canClose(s) {
    if (s.status !== 'playing') return { ok: false, reason: 'Séance non démarrée.' };
    if (!s.matches.some(m => m.done)) return { ok: false, reason: 'Aucun match validé.' };
    if (s.matches.some(m => !m.done)) return { ok: false, reason: 'Tous les matchs générés doivent être validés (ou effacés pour un défi).' };
    return { ok: true };
  }

  function closeSession(c, s) {
    const can = canClose(s);
    if (!can.ok) return fail(can.reason);
    s.matches.forEach(m => { m.court = null; });
    s.status = 'closed';
    s.closedAt = Date.now();
    delete s.snapshot;
    s.reopened = false;
    return { ok: true };
  }

  /**
   * Annulation : une séance jamais clôturée est supprimée ; une séance ROUVERTE retrouve son état
   * clôturé d'origine (bug V1 : elle était supprimée définitivement).
   */
  function cancelSession(c, s) {
    if (s.status === 'closed') return fail('Séance déjà clôturée.');
    if (s.reopened && s.snapshot) {
      const restored = s.snapshot;
      const idx = c.sessions.indexOf(s);
      c.sessions[idx] = restored;
      return { ok: true, restored: true };
    }
    c.sessions = c.sessions.filter(x => x !== s);
    return { ok: true, restored: false };
  }

  function reopenSession(c, sessionId) {
    if (activeSession(c)) return fail('Terminez ou annulez la séance active avant de rouvrir une ancienne séance.');
    const s = c.sessions.find(x => x.id === sessionId);
    if (!s || s.status !== 'closed') return fail('Séance introuvable ou non clôturée.');
    const snap = clone(s);
    s.snapshot = snap;
    s.reopened = true;
    s.status = 'playing';
    return { ok: true };
  }

  /** Correction d'un match pendant la séance : efface un défi non commencé. */
  function removeMatch(c, s, matchId) {
    const m = s.matches.find(x => x.id === matchId);
    if (!m) return fail('Match introuvable.');
    if (s.mode !== 'challenge') return fail('Seuls les défis peuvent être supprimés.');
    if (m.done) return fail('Effacez d\'abord le résultat.');
    s.matches = s.matches.filter(x => x !== m);
    autoAssign(c, s);
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * Persistance : schéma versionné, migration, validation
   * ------------------------------------------------------------------ */
  function emptyDB() { return { schemaVersion: SCHEMA_VERSION, classes: [], active: null }; }

  /**
   * Migration V1 (sans schemaVersion) → V2 : les terrains V1 étaient attribués d'avance à tous les
   * matchs ; pour une séance en cours, les matchs non joués sont remis en file d'attente (terrain
   * préféré conservé) puis réaffectés sans conflit. Les séances clôturées ne changent pas.
   */
  function migrate(db) {
    if (!db || typeof db !== 'object' || !Array.isArray(db.classes)) throw new Error('Structure invalide (classes absentes).');
    if (db.schemaVersion > SCHEMA_VERSION) throw new Error('Sauvegarde créée par une version plus récente de l\'application.');
    if (!db.schemaVersion || db.schemaVersion < 2) {
      db.classes.forEach(c => {
        c.k = c.k != null ? c.k : 32;
        c.courts = c.courts || 4;
        (c.sessions || []).forEach(s => {
          s.byes = s.bye ? [{ round: s.round || 1, id: s.bye }] : (s.byes || []);
          delete s.bye;
          s.moves = s.moves || [];
          s.divisions = s.divisions || [];
          s.permutation = s.permutation || 'none';
          s.matches.forEach(m => {
            m.forfeit = m.forfeit || null;
            if (s.status !== 'closed' && !m.done) { m.pref = m.court || null; m.court = null; }
            if (m.done) m.resultPlayers = [m.a, m.b];
          });
          if (s.status === 'playing') {
            if (!s.order) s.order = s.positions.slice();
            if (['pools', 'ladder', 'reclass'].includes(s.mode) && !s.groups) {
              const ids = s.positions.slice();
              s.groups = makeGroups(s, ids);
            }
            if (s.mode === 'reclass' && s.phase === 'reclassement') s.phase = 'classement';
            if (s.mode === 'reclass') s.matches.forEach(m => { if (!m.phase) m.phase = m.round === 1 ? 'brassage' : 'classement'; });
          }
        });
      });
      db.schemaVersion = 2;
    }
    db.classes.forEach(c => (c.sessions || []).forEach(s => { if (s.status === 'playing') autoAssign(c, s); }));
    return db;
  }

  function validateDB(db) {
    const errors = [];
    try { migrate(db); } catch (e) { return { ok: false, errors: [e.message] }; }
    db.classes.forEach(c => {
      if (!c.id || !Array.isArray(c.students) || !Array.isArray(c.sessions)) { errors.push('Classe invalide : ' + (c.name || '?')); return; }
      const ids = new Set();
      c.students.forEach(p => { if (!p.id || ids.has(p.id)) errors.push('Élève sans identifiant ou en double dans ' + c.name); ids.add(p.id); });
      const seqs = new Set();
      c.sessions.forEach(s => {
        if (seqs.has(s.seq)) errors.push('Numéro de séance en double dans ' + c.name);
        seqs.add(s.seq);
        if (!Array.isArray(s.matches)) errors.push('Séance sans matchs dans ' + c.name);
        else s.matches.forEach(m => { [m.a, m.b].forEach(x => { if (x && !ids.has(x)) errors.push('Match avec un élève inconnu dans ' + c.name); }); });
      });
      if (c.sessions.filter(s => s.status !== 'closed').length > 1) errors.push('Plusieurs séances actives dans ' + c.name);
    });
    return { ok: errors.length === 0, errors: Array.from(new Set(errors)) };
  }

  function parseDB(text) {
    const db = JSON.parse(text);
    const v = validateDB(db);
    if (!v.ok) throw new Error(v.errors.slice(0, 4).join(' '));
    return db;
  }

  /* ------------------------------------------------------------------ *
   * Élèves
   * ------------------------------------------------------------------ */
  function addStudents(c, names) {
    const added = [], skipped = [];
    names.map(n => String(n || '').replace(/\s+/g, ' ').trim()).filter(Boolean).forEach(name => {
      if (c.students.some(p => nameKey(p.name) === nameKey(name)) || added.some(p => nameKey(p.name) === nameKey(name))) { skipped.push(name); return; }
      const p = { id: uid(), name };
      c.students.push(p);
      added.push(p);
    });
    return { ok: true, added, skipped };
  }

  function renameStudent(c, id, name) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    if (!name) return fail('Nom vide.');
    if (c.students.some(p => p.id !== id && nameKey(p.name) === nameKey(name))) return fail('Ce nom existe déjà.');
    const p = c.students.find(x => x.id === id);
    if (!p) return fail('Élève introuvable.');
    p.name = name;
    return { ok: true };
  }

  return {
    SCHEMA_VERSION, MODES, GROUP_MODES,
    uid, clone, isSporting, winnerOf, loserOf, validateScore, expected, sessionDeltas, computeStats, ranks,
    activeSession, createSession, presentIds, proposePlacement, setAbsent, moveToGroup, shiftPosition, placementWarnings,
    balancedGroups, groupCount, makeGroups, startSession, roundRobin, autoAssign, matchState,
    recordResult, clearResult, resolve, sessionStandings, minCostPerfectMatching,
    nextRound, canNextRound, groupRanking, challengeOrder, addChallenge, removeMatch,
    divisionFormat, validatePartition, describePartition, proposePartitions, seedOrder, brassageRanking,
    canBuildClassement, buildClassement, reclassPlaces,
    canClose, closeSession, cancelSession, reopenSession,
    emptyDB, migrate, validateDB, parseDB, addStudents, renameStudent, nameKey
  };
});
