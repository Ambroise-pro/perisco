'use strict';
const test = require('node:test');
const { E, assert, fullTournament, makeTournament, playReady, freeze } = require('./helpers');

test('Sérialisation / désérialisation sans perte (tournoi terminé)', () => {
  const s = fullTournament(24, [8, 8, 8]);
  const text = E.serialize(s);
  const back = E.deserialize(text);
  assert.deepEqual(back, s);
  assert.ok(E.checkFinalRanking(back).ok);
});

test('Rechargement en cours de tableau puis poursuite du tournoi', () => {
  const rng = E.rngFor('reload', 'x');
  let s = makeTournament(8, { swissRounds: 0 });
  s = freeze(E.startTournament(s).state, [8]);
  for (let i = 0; i < 5; i++) {
    const m = s.matches.find(x => !x.result && x.status === 'ready');
    s = E.setResult(s, m.id, { scoreA: 21, scoreB: i }).state;
  }
  const back = E.deserialize(E.serialize(s));
  assert.deepEqual(back.matches.map(m => [m.playerAId, m.playerBId, m.status]), s.matches.map(m => [m.playerAId, m.playerBId, m.status]));
  const done = playReady(back, rng);
  assert.ok(E.checkFinalRanking(done).ok);
});

test('Import invalide refusé avec un message explicite', () => {
  assert.throws(() => E.deserialize('{"foo":1}'), /schemaVersion/);
  assert.throws(() => E.deserialize('pas du json'));
  const s = makeTournament(4);
  const future = Object.assign({}, s, { schemaVersion: 99 });
  assert.throws(() => E.deserialize(JSON.stringify(future)), /plus récente/);
  const broken = JSON.parse(E.serialize(s));
  broken.players.push({ id: broken.players[0].id, name: 'Clone' });
  assert.throws(() => E.deserialize(JSON.stringify(broken)), /dupliqué/);
});

test('Exports CSV : BOM, séparateur point-virgule, une ligne par joueur et par match', () => {
  const s = fullTournament(12, [8, 4]);
  const csv = E.standingsCSV(s);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.replace(/\r\n$/, '').split('\r\n');
  assert.equal(lines.length, 13);
  assert.match(lines[0], /^﻿Place finale;Joueur;Division/);
  assert.match(lines[1], /^1;/);
  const res = E.resultsCSV(s).trim().split('\r\n');
  assert.equal(res.length, s.matches.length + 1);
  assert.equal(E.toCSV([['a;b', 'c"d']]), '﻿"a;b";"c""d"\r\n');
});

test('Estimation de durée : 24 joueurs, 6 terrains, 3 rondes, 3×8', () => {
  const est = E.estimateSchedule(24, 6, 3, [8, 8, 8], 8);
  assert.equal(est.swissWaves, 6);
  assert.equal(est.finalWaves, 6);
  assert.equal(est.minutes, 120);
});
