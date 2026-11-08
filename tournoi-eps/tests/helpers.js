'use strict';
const assert = require('node:assert/strict');
const E = require('../engine.js');

function names(n) {
  // Noms fictifs (aucun nom d'élève réel).
  return Array.from({ length: n }, (_, i) => 'Joueur ' + String(i + 1).padStart(2, '0'));
}

function makeTournament(n, settings, seed) {
  let s = E.createTournament({ name: 'Test', seed: seed || 'graine-test', settings: Object.assign({ autoAssign: false }, settings || {}) });
  const r = E.setPlayers(s, names(n));
  assert.ok(r.ok, r.error);
  return r.state;
}

function randomScore(rng) {
  const loser = Math.floor(rng() * 20);
  return rng() < 0.5 ? { scoreA: 21, scoreB: loser } : { scoreA: loser, scoreB: 21 };
}

/** Joue tous les matchs prêts (sans passer par les terrains) jusqu'à épuisement. */
function playReady(state, rng, filter) {
  let s = state;
  for (let guard = 0; guard < 10000; guard++) {
    const m = s.matches.find(x => !x.result && x.playerAId && x.playerBId && (!filter || filter(x)));
    if (!m) return s;
    const r = E.setResult(s, m.id, randomScore(rng));
    assert.ok(r.ok, r.error);
    s = r.state;
  }
  throw new Error('boucle infinie');
}

function playSwiss(state, rng) {
  let s = state;
  if (s.tournament.phase === 'setup') {
    const r = E.startTournament(s);
    assert.ok(r.ok, r.error);
    s = r.state;
  }
  for (;;) {
    s = playReady(s, rng, m => m.phase === 'swiss');
    const can = E.canGenerateNextRound(s);
    if (!can.ok) break;
    const g = E.generateNextSwissRound(s);
    assert.ok(g.ok, g.error);
    s = g.state;
  }
  return s;
}

function freeze(state, sizes) {
  const r = E.freezeDivisions(state, sizes);
  assert.ok(r.ok, r.error);
  return r.state;
}

function fullTournament(n, sizes, opts) {
  opts = opts || {};
  const rng = E.rngFor(opts.seed || 'sim', 'scores');
  let s = makeTournament(n, Object.assign({ swissRounds: opts.rounds == null ? 3 : opts.rounds }, opts.settings || {}), opts.seed);
  s = playSwiss(s, rng);
  s = freeze(s, sizes || E.proposePartitions(n)[0].sizes);
  s = playReady(s, rng);
  return s;
}

module.exports = { E, assert, names, makeTournament, randomScore, playReady, playSwiss, freeze, fullTournament };
