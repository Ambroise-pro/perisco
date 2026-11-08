'use strict';
const test = require('node:test');
const { E, assert, makeTournament, playSwiss, freeze, playReady, fullTournament, randomScore } = require('./helpers');

function checkCourtInvariants(s) {
  const active = s.matches.filter(m => m.courtId && !m.result);
  const courts = active.map(m => m.courtId);
  assert.equal(new Set(courts).size, courts.length, 'terrain utilisé deux fois');
  const players = active.flatMap(m => [m.playerAId, m.playerBId]);
  assert.equal(new Set(players).size, players.length, 'joueur sur deux terrains');
  assert.ok(courts.every(c => E.courtNumber(c) >= 1 && E.courtNumber(c) <= s.tournament.settings.courts));
  assert.ok(active.every(m => m.status === 'in_progress'));
}

/** Simulation réaliste : seuls les matchs sur un terrain sont joués, dans un ordre aléatoire. */
function simulateWithCourts(n, courts, sizes) {
  const rng = E.rngFor('courts' + n + '-' + courts, 'x');
  let s = makeTournament(n, { courts, swissRounds: 3, autoAssign: true });
  s = E.startTournament(s).state;
  let maxSimultaneous = 0;
  for (let guard = 0; guard < 5000; guard++) {
    checkCourtInvariants(s);
    const active = s.matches.filter(m => m.courtId && !m.result);
    maxSimultaneous = Math.max(maxSimultaneous, active.length);
    if (active.length) {
      const m = active[Math.floor(rng() * active.length)];
      const r = E.setResult(s, m.id, randomScore(rng));
      assert.ok(r.ok, r.error);
      s = r.state;
      continue;
    }
    // Plus rien sur les terrains
    assert.equal(E.readyQueue(s).length, 0, 'match prêt non affecté alors que des terrains sont libres');
    if (E.canGenerateNextRound(s).ok) { s = E.generateNextSwissRound(s).state; continue; }
    if (s.tournament.phase === 'swiss') { s = freeze(s, sizes); continue; }
    break;
  }
  assert.equal(s.tournament.phase, 'done');
  assert.ok(maxSimultaneous <= courts);
  assert.ok(E.checkFinalRanking(s).ok);
  return { s, maxSimultaneous };
}

for (const courts of [1, 2, 3, 6, 10]) {
  test(`${courts} terrain(s) : aucun double emploi d'un terrain ou d'un joueur (24 joueurs)`, () => {
    const { maxSimultaneous } = simulateWithCourts(24, courts, [8, 8, 8]);
    assert.equal(maxSimultaneous, Math.min(courts, 12));
  });
}

test('Effectif impair et terrains : 13 joueurs, 4 terrains', () => {
  simulateWithCourts(13, 4, E.proposePartitions(13)[0].sizes);
});

test('Affectation manuelle validée : terrain occupé, joueur occupé, match non prêt', () => {
  let s = makeTournament(8, { courts: 2, swissRounds: 0 });
  s = E.startTournament(s).state;
  s = freeze(s, [8]);
  const [q1, q2] = s.matches;
  s = E.assignCourt(s, q1.id, 'C1').state;
  assert.equal(E.assignCourt(s, q2.id, 'C1').code, 'COURT_BUSY');
  assert.equal(E.assignCourt(s, q2.id, 'C9').code, 'INVALID_COURT');
  const semi = s.matches.find(m => m.depth === 1);
  assert.equal(E.assignCourt(s, semi.id, 'C2').code, 'NOT_READY');
  assert.ok(E.assignCourt(s, q2.id, 'C2').ok);
  // Réduction du nombre de terrains impossible si un match y est en cours
  s = E.assignCourt(s, q2.id, 'C2').state;
  assert.equal(E.updateSettings(s, { courts: 1 }).ok, false);
});

test('Validation des scores', () => {
  let s = makeTournament(4, { swissRounds: 1 });
  s = E.startTournament(s).state;
  const m = s.matches[0];
  assert.equal(E.setResult(s, m.id, { scoreA: 10, scoreB: 10 }).code, 'INVALID_SCORE');
  assert.equal(E.setResult(s, m.id, { scoreA: -1, scoreB: 10 }).code, 'INVALID_SCORE');
  assert.equal(E.setResult(s, m.id, { scoreA: 2.5, scoreB: 10 }).code, 'INVALID_SCORE');
  assert.equal(E.setResult(s, m.id, { scoreA: '', scoreB: 10 }).code, 'INVALID_SCORE');
  assert.equal(E.setResult(s, m.id, { scoreA: 1000, scoreB: 10 }).code, 'INVALID_SCORE');
  assert.ok(E.setResult(s, m.id, { scoreA: '21', scoreB: '3' }).ok);
  // Nul autorisé au brassage si le paramètre est activé, jamais en tableau
  let d = makeTournament(4, { swissRounds: 1, allowDrawsSwiss: true });
  d = E.startTournament(d).state;
  const r = E.setResult(d, d.matches[0].id, { scoreA: 7, scoreB: 7 });
  assert.ok(r.ok);
  assert.equal(E.swissStandings(r.state).find(x => x.playerId === d.matches[0].playerAId).matchPoints, 0.5);
  let f = makeTournament(4, { swissRounds: 0, allowDrawsSwiss: true });
  f = freeze(E.startTournament(f).state, [4]);
  assert.equal(E.setResult(f, f.matches[0].id, { scoreA: 7, scoreB: 7 }).code, 'INVALID_SCORE');
});

test('Correction amont en tableau : confirmation, invalidation explicite des résultats aval', () => {
  const rng = E.rngFor('corr', 'x');
  let s = makeTournament(8, { swissRounds: 0 });
  s = freeze(E.startTournament(s).state, [8]);
  s = playReady(s, rng);
  assert.ok(E.checkFinalRanking(s).ok);
  const q1 = s.matches.find(m => m.label === 'Q1');
  // Même vainqueur, autre score : pas de conséquence aval
  const sameWinner = q1.result.winnerId === q1.playerAId ? { scoreA: 21, scoreB: 1 } : { scoreA: 1, scoreB: 21 };
  const r0 = E.setResult(s, q1.id, sameWinner);
  assert.ok(r0.ok);
  assert.equal(r0.invalidated.length, 0);
  // Inversion du vainqueur : confirmation exigée
  const flip = q1.result.winnerId === q1.playerAId ? { scoreA: 0, scoreB: 21 } : { scoreA: 21, scoreB: 0 };
  const r1 = E.setResult(s, q1.id, flip);
  assert.equal(r1.ok, false);
  assert.ok(r1.needsConfirm);
  assert.ok(r1.impact.invalidates.length >= 2); // demi haute et demi basse au moins
  assert.match(r1.error, /invalidés/);
  const r2 = E.setResult(s, q1.id, flip, { confirm: true });
  assert.ok(r2.ok);
  s = r2.state;
  const inv = s.matches.filter(m => m.invalidated);
  assert.deepEqual(inv.map(m => m.id).sort(), r1.impact.invalidates.slice().sort());
  inv.forEach(m => assert.equal(m.result, null));
  // Pas de classement contradictoire : les places dépendantes ne sont plus attribuées
  const fs = E.finalStandings(s);
  assert.ok(fs.assigned < 8);
  const ranks = fs.rows.filter(r => r.rank != null).map(r => r.rank);
  assert.equal(new Set(ranks).size, ranks.length);
  // Les nouveaux joueurs sont bien propagés
  const w1 = s.matches.find(m => m.sourceA && m.sourceA.matchId === q1.id && m.sourceA.take === 'winner');
  assert.equal(w1.playerAId, s.matches.find(m => m.id === q1.id).result.winnerId);
  s = playReady(s, rng);
  assert.ok(E.checkFinalRanking(s).ok);
});

test('Effacer un résultat amont invalide aussi l\'aval (avec confirmation)', () => {
  const rng = E.rngFor('clear', 'x');
  let s = makeTournament(4, { swissRounds: 0 });
  s = freeze(E.startTournament(s).state, [4]);
  s = playReady(s, rng);
  const d1 = s.matches[0];
  assert.ok(E.clearResult(s, d1.id).needsConfirm);
  s = E.clearResult(s, d1.id, { confirm: true }).state;
  assert.equal(s.matches.filter(m => m.result).length, 1);
  assert.equal(s.tournament.phase, 'finals');
});

test('Correction au brassage : régénération de la ronde non jouée, conservation des rondes jouées, verrou après les tableaux', () => {
  const rng = E.rngFor('swc', 'x');
  let s = makeTournament(8, { swissRounds: 3 });
  s = E.startTournament(s).state;
  s = playReady(s, rng);
  s = E.generateNextSwissRound(s).state;
  const m1 = s.matches.find(m => m.phase === 'swiss' && s.rounds[0].matchIds.includes(m.id));
  const flip = m1.result.winnerId === m1.playerAId ? { scoreA: 0, scoreB: 21 } : { scoreA: 21, scoreB: 0 };
  const r = E.setResult(s, m1.id, flip);
  assert.ok(r.needsConfirm);
  assert.ok(r.impact.regenerateRoundId);
  const r2 = E.setResult(s, m1.id, flip, { confirm: true });
  assert.ok(r2.ok);
  assert.equal(r2.state.rounds.length, 2);
  assert.ok(r2.state.rounds[1].matchIds.every(id => r2.state.matches.find(m => m.id === id).result == null || r2.state.matches.find(m => m.id === id).isBye));
  // ronde 2 jouée : conservée, confirmation demandée quand même
  s = playReady(r2.state, rng);
  const r3 = E.setResult(s, m1.id, { scoreA: 21, scoreB: 20 });
  assert.ok(r3.needsConfirm && r3.impact.laterRoundsPlayed);
  const r4 = E.setResult(s, m1.id, { scoreA: 21, scoreB: 20 }, { confirm: true });
  assert.equal(r4.state.matches.filter(m => m.phase === 'swiss' && m.result).length, 8);
  // après gel des divisions : verrouillé
  s = playSwiss(r4.state, rng);
  s = freeze(s, [8]);
  assert.equal(E.setResult(s, m1.id, { scoreA: 1, scoreB: 21 }).code, 'LOCKED_FINALS');
  const back = E.reopenSwiss(s);
  assert.ok(back.ok);
  assert.equal(back.state.matches.filter(m => m.phase === 'final').length, 0);
  assert.ok(E.setResult(back.state, m1.id, { scoreA: 1, scoreB: 21 }).needsConfirm);
  assert.ok(E.setResult(back.state, m1.id, { scoreA: 1, scoreB: 21 }, { confirm: true }).ok);
});

test('Forfait ponctuel et abandon (retrait) d\'un joueur', () => {
  const rng = E.rngFor('wd', 'x');
  let s = makeTournament(8, { swissRounds: 2 });
  s = E.startTournament(s).state;
  const m = s.matches[0];
  s = E.setResult(s, m.id, { forfeitBy: m.playerBId }).state;
  const st = E.swissStandings(s).find(x => x.playerId === m.playerAId);
  assert.equal(st.wins, 1); assert.equal(st.forfeitWins, 1); assert.equal(st.pointsFor, 0);
  // Retrait pendant la ronde : forfait automatique sur son match non joué
  const m2 = s.matches[1];
  s = E.setWithdrawn(s, m2.playerAId, true).state;
  const m2b = s.matches.find(x => x.id === m2.id);
  assert.equal(m2b.result.type, 'forfait');
  assert.equal(m2b.result.loserId, m2.playerAId);
  s = playReady(s, rng);
  s = E.generateNextSwissRound(s).state;
  // Ronde 2 : le joueur retiré n'est pas apparié, les 7 autres ont 3 matchs + 1 exemption
  const r2 = E.roundMatches(s, s.rounds[1]);
  assert.ok(r2.every(x => x.playerAId !== m2.playerAId && x.playerBId !== m2.playerAId));
  assert.equal(r2.filter(x => x.isBye).length, 1);
  s = playReady(s, rng);
  // Tableau : le joueur retiré est placé en dernière tête de série et perd par forfait ; toutes les places restent attribuées
  s = freeze(s, [8]);
  assert.equal(s.divisions[0].playerIds[7], m2.playerAId);
  s = playReady(s, rng);
  const chk = E.checkFinalRanking(s);
  assert.ok(chk.ok, chk.errors.join(' '));
  assert.equal(chk.standings.rows.find(r => r.playerId === m2.playerAId).rank, 8);
});

test('Joueurs : doublons, liste vide, verrouillage, retardataire', () => {
  const a = E.analyzeNames('Léa\n\nlea \nTom\n  \nTom');
  assert.deepEqual(a.duplicates, ['lea', 'Tom']);
  assert.equal(a.empty, 2);
  assert.equal(a.ok, false);
  assert.equal(E.analyzeNames('').ok, false);
  assert.equal(E.analyzeNames('Seul').ok, false);
  let s = E.createTournament({});
  assert.equal(E.setPlayers(s, ['A', 'a']).code, 'DUPLICATES');
  assert.equal(E.startTournament(s).ok, false); // liste vide
  s = makeTournament(6, { swissRounds: 2 });
  s = E.startTournament(s).state;
  assert.equal(E.setPlayers(s, ['X', 'Y']).code, 'LOCKED');
  assert.equal(E.addLatePlayer(s, 'Retard').code, 'ROUND_IN_PROGRESS');
  s = playReady(s, E.rngFor('l', 'x'));
  assert.equal(E.addLatePlayer(s, 'joueur 01').code, 'DUPLICATES');
  s = E.addLatePlayer(s, 'Retardataire').state;
  assert.equal(s.players.length, 7);
  s = E.generateNextSwissRound(s).state;
  const ids = E.roundMatches(s, s.rounds[1]).flatMap(m => [m.playerAId, m.playerBId]).filter(Boolean);
  assert.equal(new Set(ids).size, 7);
  assert.deepEqual(E.parseCSVNames('Nom;Classe\n"Dupont, A";5B\nMartin;5C\n\n'), ['Dupont, A', 'Martin']);
});

test('Paramètres verrouillés après le début, réinitialisation explicite', () => {
  let s = makeTournament(6, { swissRounds: 2 });
  s = E.startTournament(s).state;
  assert.equal(E.updateSettings(s, { useSeeds: true }).ok, false);
  assert.equal(E.updateInfo(s, { seed: 'autre' }).ok, false);
  assert.equal(E.updateSettings(s, { swissRounds: 0 }).ok, false);
  assert.ok(E.updateSettings(s, { swissRounds: 4 }).ok);
  assert.ok(E.updateSettings(s, { courts: 3 }).ok);
  const r = E.resetMatches(s);
  assert.equal(r.state.tournament.phase, 'setup');
  assert.equal(r.state.matches.length, 0);
  assert.equal(r.state.players.length, 6);
});
