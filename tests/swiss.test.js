'use strict';
const test = require('node:test');
const { E, assert, makeTournament, playSwiss, playReady, randomScore } = require('./helpers');

function pairsOf(s) {
  return s.matches.filter(m => m.phase === 'swiss' && !m.isBye).map(m => [m.playerAId, m.playerBId].sort().join('|'));
}

test('Ronde 1 avec têtes de série : la moitié haute rencontre la moitié basse', () => {
  let s = makeTournament(8, { useSeeds: true });
  s = E.startTournament(s).state;
  const seed = id => s.players.find(p => p.id === id).initialSeed;
  const pairs = s.matches.map(m => [seed(m.playerAId), seed(m.playerBId)]);
  assert.deepEqual(pairs, [[1, 5], [2, 6], [3, 7], [4, 8]]);
});

test('Tirage aléatoire reproductible avec la même graine, différent avec une autre', () => {
  const a = E.startTournament(makeTournament(12, {}, 'graine-A')).state;
  const b = E.startTournament(makeTournament(12, {}, 'graine-A')).state;
  const c = E.startTournament(makeTournament(12, {}, 'graine-B')).state;
  assert.deepEqual(pairsOf(a), pairsOf(b));
  assert.notDeepEqual(pairsOf(a), pairsOf(c));
});

for (const n of [5, 7, 9, 11, 25]) {
  test(`Effectif impair N=${n} : exemptions réparties équitablement, jamais deux matchs simultanés`, () => {
    const rounds = Math.min(n, 6);
    let s = makeTournament(n, { swissRounds: rounds });
    s = playSwiss(s, E.rngFor('odd' + n, 's'));
    const byes = new Map();
    s.matches.filter(m => m.isBye).forEach(m => byes.set(m.playerAId, (byes.get(m.playerAId) || 0) + 1));
    assert.equal(s.matches.filter(m => m.isBye).length, rounds);
    // rounds <= n : personne n'a deux exemptions
    for (const [, c] of byes) assert.equal(c, 1);
    // dans chaque ronde, chaque joueur apparaît exactement une fois
    s.rounds.forEach(r => {
      const ids = E.roundMatches(s, r).flatMap(m => [m.playerAId, m.playerBId]).filter(Boolean);
      assert.equal(ids.length, n);
      assert.equal(new Set(ids).size, n);
    });
    // matchs joués : écart maximal de 1
    const st = E.swissStandings(s);
    const played = st.map(x => x.played);
    assert.ok(Math.max(...played) - Math.min(...played) <= 1);
    // une exemption n'est pas une victoire
    st.forEach(x => assert.equal(x.wins + x.losses + x.draws, x.played));
  });
}

// Existe-t-il un appariement parfait sans paire déjà jouée ? (force brute, petits effectifs)
function repeatFreeExists(ids, played) {
  if (ids.length === 0) return true;
  const [a, ...rest] = ids;
  for (let i = 0; i < rest.length; i++) {
    const b = rest[i];
    if (played.has([a, b].sort().join('|'))) continue;
    if (repeatFreeExists(rest.filter((_, j) => j !== i), played)) return true;
  }
  return false;
}

for (const n of [4, 6, 8, 10, 12]) {
  test(`N=${n} : aucune paire répétée tant qu'une alternative existe (${n - 1} rondes)`, () => {
    for (const seed of ['a', 'b', 'c']) {
      const rng = E.rngFor(seed + n, 'r');
      let s = makeTournament(n, { swissRounds: n - 1 }, seed);
      s = E.startTournament(s).state;
      for (;;) {
        s = playReady(s, rng);
        const can = E.canGenerateNextRound(s);
        if (!can.ok) break;
        const played = new Set(pairsOf(s));
        const exists = repeatFreeExists(s.players.map(p => p.id), played);
        s = E.generateNextSwissRound(s).state;
        const last = s.rounds[s.rounds.length - 1];
        if (exists) assert.equal(last.repeats, 0, `ronde ${last.number} (graine ${seed}) : répétition évitable`);
        assert.ok(last.optimal);
      }
    }
  });
}

test('Grands effectifs (24, 36) : 5 rondes sans répétition', () => {
  for (const n of [24, 36]) {
    let s = makeTournament(n, { swissRounds: 5 });
    s = playSwiss(s, E.rngFor('big' + n, 's'));
    const pairs = pairsOf(s);
    assert.equal(new Set(pairs).size, pairs.length);
  }
});

test('Appariements suivants : joueurs de même niveau rapprochés', () => {
  let s = makeTournament(8, { swissRounds: 2, useSeeds: true });
  s = E.startTournament(s).state;
  // Les têtes de série 1 à 4 gagnent toutes
  s.matches.forEach(m => { s = E.setResult(s, m.id, { scoreA: 21, scoreB: 5 }).state; });
  s = E.generateNextSwissRound(s).state;
  const st = E.swissStandings(s);
  const mp = new Map(st.map(x => [x.playerId, x.matchPoints]));
  E.roundMatches(s, s.rounds[1]).forEach(m => assert.equal(mp.get(m.playerAId), mp.get(m.playerBId)));
});

test('Classement : départage documenté et explicable', () => {
  let s = makeTournament(4, { swissRounds: 1 });
  s = E.startTournament(s).state;
  const [m1, m2] = s.matches;
  s = E.setResult(s, m1.id, { scoreA: 21, scoreB: 10 }).state; // +11
  s = E.setResult(s, m2.id, { scoreA: 21, scoreB: 19 }).state; // +2
  const st = E.swissStandings(s);
  assert.equal(st[0].playerId, m1.playerAId);
  assert.equal(st[1].playerId, m2.playerAId);
  assert.equal(st[1].decidedBy, 'différence moyenne');
  assert.equal(st[2].decidedBy, 'points de match');
});

test('Exemption : points de match selon le paramètre, sans victoire ni points marqués', () => {
  let s = makeTournament(3, { swissRounds: 1 });
  s = E.startTournament(s).state;
  const bye = s.matches.find(m => m.isBye);
  const st = E.swissStandings(s).find(x => x.playerId === bye.playerAId);
  assert.equal(st.byes, 1); assert.equal(st.wins, 0); assert.equal(st.matchPoints, 1); assert.equal(st.pointsFor, 0);
  let s0 = makeTournament(3, { swissRounds: 1, byePoints: 0 });
  s0 = E.startTournament(s0).state;
  assert.equal(E.swissStandings(s0).find(x => x.byes === 1).matchPoints, 0);
});

test('La ronde suivante ne peut pas être générée avant la fin de la ronde en cours', () => {
  let s = makeTournament(6, { swissRounds: 3 });
  s = E.startTournament(s).state;
  assert.equal(E.generateNextSwissRound(s).ok, false);
  s = E.setResult(s, s.matches[0].id, randomScore(E.rngFor('a', 'b'))).state;
  assert.equal(E.generateNextSwissRound(s).ok, false);
});
