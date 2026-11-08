'use strict';
const test = require('node:test');
const { E, assert, makeTournament, playSwiss, freeze, playReady, fullTournament, randomScore } = require('./helpers');

function finalsOf(s, divId) {
  return s.matches.filter(m => m.phase === 'final' && (!divId || m.divisionId === divId));
}

for (const n of [4, 8, 16, 32]) {
  test(`Tableau intégral N=${n} : ${n * Math.log2(n) / 2} matchs, log2(N) matchs par joueur, places 1..N`, () => {
    let s = makeTournament(n, { swissRounds: 0 });
    s = playSwiss(s, E.rngFor('x', 'y'));
    s = freeze(s, [n]);
    const k = Math.log2(n);
    assert.equal(finalsOf(s).length, n * k / 2);
    s = playReady(s, E.rngFor('n' + n, 'scores'));
    assert.equal(s.tournament.phase, 'done');
    // chaque joueur : exactement k matchs, un par tour
    for (const p of s.players) {
      const ms = finalsOf(s).filter(m => m.playerAId === p.id || m.playerBId === p.id);
      assert.equal(ms.length, k, p.name);
      assert.deepEqual(ms.map(m => m.depth).sort((a, b) => a - b), Array.from({ length: k }, (_, i) => i));
    }
    // chaque match final de placement attribue deux places distinctes
    finalsOf(s).filter(m => m.placementFinal).forEach(m => {
      assert.equal(m.targetRanks[1] - m.targetRanks[0], 1);
      assert.notEqual(m.result.winnerId, m.result.loserId);
    });
    assert.equal(finalsOf(s).filter(m => m.placementFinal).length, n / 2);
    const chk = E.checkFinalRanking(s);
    assert.ok(chk.ok, chk.errors.join(' '));
  });
}

test('Structure du tableau de 8 : 4 quarts, 4 demi-finales de classement, 4 matchs de places', () => {
  let s = makeTournament(8, { swissRounds: 0, useSeeds: true });
  s = playSwiss(s, E.rngFor('a', 'b'));
  s = freeze(s, [8]);
  const ms = finalsOf(s);
  assert.equal(ms.length, 12);
  const byDepth = d => ms.filter(m => m.depth === d);
  assert.deepEqual(byDepth(0).map(m => m.label), ['Q1', 'Q2', 'Q3', 'Q4']);
  assert.deepEqual(byDepth(1).map(m => m.targetRanks.join('-')), ['1-4', '1-4', '5-8', '5-8']);
  assert.deepEqual(byDepth(2).map(m => m.targetRanks.join('-')), ['1-2', '3-4', '5-6', '7-8']);
  assert.ok(byDepth(2).every(m => m.placementFinal));
  // Têtes de série : 1-8, 4-5, 2-7, 3-6
  const seedOf = id => s.players.find(p => p.id === id).initialSeed;
  assert.deepEqual(byDepth(0).map(m => [seedOf(m.playerAId), seedOf(m.playerBId)]), [[1, 8], [4, 5], [2, 7], [3, 6]]);
  // Liens : demi 1-4 n°1 = vainqueurs Q1 et Q2 ; demi 5-8 n°1 = perdants Q1 et Q2
  const [q1, q2, q3, q4] = byDepth(0);
  const [w1, w2, l1, l2] = byDepth(1);
  assert.deepEqual([w1.sourceA, w1.sourceB], [{ matchId: q1.id, take: 'winner' }, { matchId: q2.id, take: 'winner' }]);
  assert.deepEqual([w2.sourceA, w2.sourceB], [{ matchId: q3.id, take: 'winner' }, { matchId: q4.id, take: 'winner' }]);
  assert.deepEqual([l1.sourceA, l1.sourceB], [{ matchId: q1.id, take: 'loser' }, { matchId: q2.id, take: 'loser' }]);
  assert.deepEqual([l2.sourceA, l2.sourceB], [{ matchId: q3.id, take: 'loser' }, { matchId: q4.id, take: 'loser' }]);
  const [f12, f34, f56, f78] = byDepth(2);
  assert.deepEqual([f12.sourceA.take, f12.sourceB.take, f34.sourceA.take, f56.sourceA.take, f78.sourceA.take], ['winner', 'winner', 'loser', 'winner', 'loser']);
  assert.equal(f34.sourceA.matchId, w1.id);
  assert.equal(f78.sourceB.matchId, l2.id);
  // Avant tout résultat : aucun adversaire inventé
  assert.ok(byDepth(1).concat(byDepth(2)).every(m => m.playerAId === null && m.playerBId === null && m.status === 'pending'));
  // Score dans Q1 : vainqueur et perdant apparaissent dans les bonnes branches
  const r = E.setResult(s, q1.id, { scoreA: 21, scoreB: 10 });
  assert.ok(r.ok);
  s = r.state;
  const get = id => s.matches.find(m => m.id === id);
  assert.equal(get(w1.id).playerAId, q1.playerAId);
  assert.equal(get(l1.id).playerAId, q1.playerBId);
  assert.equal(get(w1.id).playerBId, null);
  assert.equal(get(w1.id).status, 'pending');
});

test('Branches : chaque division de 8 a 4 matchs de branche haute et 4 de branche basse après les quarts', () => {
  let s = makeTournament(8, { swissRounds: 0 });
  s = playSwiss(s, E.rngFor('a', 'b'));
  s = freeze(s, [8]);
  const ms = finalsOf(s).filter(m => m.depth > 0);
  assert.equal(ms.filter(m => m.branch === 'upper').length, 4);
  assert.equal(ms.filter(m => m.branch === 'lower').length, 4);
});

test('24 joueurs, 3 rondes, 3 divisions de 8 : 36 matchs de classement, places 1..24', () => {
  const s = fullTournament(24, [8, 8, 8], { rounds: 3 });
  assert.equal(finalsOf(s).length, 36);
  assert.equal(s.divisions.length, 3);
  s.divisions.forEach((d, i) => {
    assert.equal(finalsOf(s, d.id).length, 12);
    assert.equal(d.globalRankStart, 1 + 8 * i);
  });
  const chk = E.checkFinalRanking(s);
  assert.ok(chk.ok, chk.errors.join(' '));
  // les places de chaque division restent dans sa plage
  chk.standings.rows.forEach(r => {
    const d = s.divisions.find(x => x.id === r.divisionId);
    assert.ok(r.rank >= d.globalRankStart && r.rank < d.globalRankStart + 8);
  });
  // les divisions suivent le classement du brassage
  const swiss = E.swissStandings({ ...s, matches: s.matches.filter(m => m.phase === 'swiss') });
  assert.deepEqual(s.divisions[0].playerIds, swiss.slice(0, 8).map(x => x.playerId));
});

for (const n of [6, 10, 12, 24, 25, 28, 36]) {
  test(`N=${n} : partitions documentées, classement final complet sans trou ni doublon`, () => {
    const props = E.proposePartitions(n);
    assert.ok(props.length > 0);
    assert.ok(props[0].recommended);
    props.forEach(p => {
      assert.equal(p.sizes.reduce((a, b) => a + b, 0), n);
      assert.ok(E.validatePartition(p.sizes, n).ok);
      if (p.divisions.length > 1) assert.ok(p.warnings.some(w => /frontières/.test(w)));
      if (!p.pure) assert.ok(p.warnings.some(w => /poule/.test(w)));
    });
    for (const p of props.slice(0, 3)) {
      const s = fullTournament(n, p.sizes, { rounds: 3, seed: 'n' + n + p.sizes.join('') });
      const chk = E.checkFinalRanking(s);
      assert.ok(chk.ok, p.sizes.join('+') + ' : ' + chk.errors.join(' '));
      assert.equal(finalsOf(s).length, p.total);
    }
  });
}

test('Partitions recommandées attendues', () => {
  assert.deepEqual(E.proposePartitions(24)[0].sizes, [8, 8, 8]);
  assert.deepEqual(E.proposePartitions(16)[0].sizes, [16]);
  assert.deepEqual(E.proposePartitions(32)[0].sizes, [32]);
  assert.deepEqual(E.proposePartitions(6)[0].sizes, [3, 3]);
  assert.ok(E.proposePartitions(24).some(p => p.sizes.join() === '16,8'));
});

test('Partition invalide refusée', () => {
  assert.equal(E.validatePartition([8, 8, 7], 23).ok, false);
  assert.equal(E.validatePartition([8, 8], 24).ok, false);
  assert.equal(E.validatePartition([16, 8], 24).ok, true);
  assert.equal(E.validatePartition([5, 5], 10).ok, true);
});

test('Poule de 3 : 3 matchs, rangs attribués à la fin seulement', () => {
  let s = makeTournament(6, { swissRounds: 1 });
  const rng = E.rngFor('p', 'q');
  s = playSwiss(s, rng);
  s = freeze(s, [3, 3]);
  assert.equal(finalsOf(s).length, 6);
  const first = finalsOf(s)[0];
  s = E.setResult(s, first.id, randomScore(rng)).state;
  assert.equal(E.finalStandings(s).assigned, 0);
  s = playReady(s, rng);
  assert.ok(E.checkFinalRanking(s).ok);
});
