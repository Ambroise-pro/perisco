/*
 * Tournoi EPS — moteur de tournoi (logique pure, sans dépendance, sans DOM).
 *
 * Utilisable :
 *   - dans le navigateur via <script src="engine.js"> (expose window.TournoiEngine),
 *     ce qui fonctionne aussi en ouverture locale (file://) ;
 *   - dans Node (tests) via require('./engine.js').
 *
 * Principe général : l'état du tournoi est un objet JSON sérialisable. Les fonctions
 * de modification ne mutent jamais l'état reçu : elles travaillent sur une copie et
 * renvoient { ok, state, ... }. Les joueurs des matchs de tableau sont TOUJOURS
 * recalculés à partir des résultats des matchs sources (fonction propagate) : il n'y a
 * qu'une seule source de vérité, les résultats saisis.
 *
 * Les choix algorithmiques importants sont expliqués en commentaire et dans README.md.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TournoiEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const SPORTS = ['Badminton', 'Tennis de table', 'Pickleball', 'Tennis', 'Padel'];
  const MAX_SCORE = 999;
  const POOL_SIZES = [3, 5, 6]; // tailles autorisées pour une division en poule
  const BRACKET_SIZES = [2, 4, 8, 16, 32, 64];

  /* ------------------------------------------------------------------ *
   * Utilitaires
   * ------------------------------------------------------------------ */
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // Hachage de chaîne (cyrb53 simplifié, 32 bits) — déterministe.
  function hashString(str) {
    let h1 = 0xdeadbeef ^ str.length;
    let h2 = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return h1 >>> 0;
  }

  // Générateur pseudo-aléatoire reproductible (mulberry32).
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rngFor(seed, salt) {
    return mulberry32(hashString(String(seed) + '|' + salt));
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function randomSeed() {
    const words = ['raquette', 'volant', 'filet', 'smash', 'service', 'revers', 'lob', 'amorti', 'drive', 'ace'];
    const w = words[Math.floor(Math.random() * words.length)];
    return w + '-' + Math.floor(1000 + Math.random() * 9000);
  }

  function isPowerOfTwo(n) {
    return n >= 1 && (n & (n - 1)) === 0;
  }

  function log2int(n) {
    return Math.round(Math.log2(n));
  }

  function normalizeName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  // Clé de comparaison pour les doublons : insensible à la casse, aux accents et aux espaces.
  function nameKey(s) {
    return normalizeName(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function divisionLetter(i) {
    let s = '';
    i += 1;
    while (i > 0) {
      const r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function nextId(state, kind, prefix) {
    state.counters[kind] = (state.counters[kind] || 0) + 1;
    return prefix + state.counters[kind];
  }

  function playerMap(state) {
    const m = new Map();
    state.players.forEach(p => m.set(p.id, p));
    return m;
  }

  function matchMap(state) {
    const m = new Map();
    state.matches.forEach(x => m.set(x.id, x));
    return m;
  }

  /* ------------------------------------------------------------------ *
   * Création du tournoi et gestion des joueurs
   * ------------------------------------------------------------------ */
  function defaultSettings() {
    return {
      courts: 4,
      swissRounds: 3,
      matchFormat: 'temps',   // 'temps' (durée limitée) ou 'score' (score cible)
      matchMinutes: 8,
      targetScore: 21,
      allowDrawsSwiss: false, // match nul autorisé au brassage (jamais en tableau)
      byePoints: 1,           // points de match accordés pour une exemption (0 ou 1)
      useSeeds: false,        // têtes de série = ordre de la liste des joueurs
      autoAssign: true        // affectation automatique des terrains libres
    };
  }

  function createTournament(opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    return {
      schemaVersion: SCHEMA_VERSION,
      tournament: {
        id: opts.id || ('T' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36)),
        name: normalizeName(opts.name) || 'Tournoi EPS',
        sport: opts.sport || SPORTS[0],
        date: opts.date || new Date(now).toISOString().slice(0, 10),
        seed: opts.seed || randomSeed(),
        phase: 'setup', // setup | swiss | finals | done
        settings: Object.assign(defaultSettings(), opts.settings || {}),
        createdAt: now,
        updatedAt: now
      },
      counters: { player: 0, match: 0, round: 0 },
      players: [],
      rounds: [],
      divisions: [],
      matches: []
    };
  }

  /**
   * Analyse une liste de noms (une ligne par joueur). Les lignes vides sont ignorées,
   * les espaces superflus supprimés. Les doublons (insensibles casse/accents) sont signalés.
   */
  function analyzeNames(input) {
    const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
    const names = [];
    let empty = 0;
    const seen = new Map();
    const duplicates = [];
    lines.forEach(raw => {
      const n = normalizeName(raw);
      if (!n) { empty++; return; }
      const k = nameKey(n);
      if (seen.has(k)) {
        if (!duplicates.includes(n)) duplicates.push(n);
      } else {
        seen.set(k, n);
      }
      names.push(n);
    });
    const errors = [];
    if (duplicates.length) errors.push('Noms en double : ' + duplicates.join(', ') + '. Ajoutez une initiale pour les distinguer.');
    if (names.length < 2) errors.push('Il faut au moins 2 joueurs.');
    names.forEach(n => { if (n.length > 60) errors.push('Nom trop long (60 caractères max) : ' + n.slice(0, 20) + '…'); });
    return { names, empty, duplicates, errors, ok: errors.length === 0 };
  }

  /**
   * Lecture simple d'un CSV : prend la première colonne de chaque ligne (séparateur ; , ou
   * tabulation), ignore une ligne d'en-tête « nom / joueur / élève ».
   */
  function parseCSVNames(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    const out = [];
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const sep = line.includes(';') ? ';' : (line.includes('\t') ? '\t' : ',');
      let cell = line.split(sep)[0].trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
      if (i === 0 && /^(nom|noms|joueur|joueurs|name|eleve|élève|élèves|participant)s?$/i.test(cell)) return;
      if (cell) out.push(cell);
    });
    return out;
  }

  /** Remplace la liste des joueurs (uniquement en phase de configuration). */
  function setPlayers(state, names) {
    if (state.tournament.phase !== 'setup') return fail('LOCKED', 'Le tournoi a commencé : la liste des joueurs est verrouillée.');
    const a = analyzeNames(names);
    if (a.duplicates.length) return fail('DUPLICATES', a.errors[0]);
    const s = clone(state);
    s.counters.player = 0;
    s.players = a.names.map((name, i) => ({ id: nextId(s, 'player', 'P'), name, initialSeed: i + 1, withdrawn: false }));
    touch(s);
    return ok(s);
  }

  function updateSettings(state, patch) {
    const s = clone(state);
    const st = s.tournament.settings;
    const phase = s.tournament.phase;
    const errors = [];
    Object.keys(patch).forEach(key => {
      const v = patch[key];
      switch (key) {
        case 'courts': {
          const n = Math.floor(Number(v));
          if (!(n >= 1 && n <= 40)) { errors.push('Nombre de terrains entre 1 et 40.'); break; }
          const used = s.matches.filter(m => m.courtId && !m.result).map(m => courtNumber(m.courtId));
          if (used.some(c => c > n)) { errors.push('Un match est en cours sur un terrain supprimé : terminez-le ou libérez le terrain d\'abord.'); break; }
          st.courts = n; break;
        }
        case 'swissRounds': {
          const n = Math.floor(Number(v));
          if (!(n >= 0 && n <= 12)) { errors.push('Nombre de rondes de brassage entre 0 et 12.'); break; }
          if (phase === 'finals' || phase === 'done') { errors.push('Les tableaux sont générés : nombre de rondes verrouillé.'); break; }
          if (n < s.rounds.length) { errors.push('Déjà ' + s.rounds.length + ' ronde(s) générée(s) : impossible de descendre en dessous.'); break; }
          if (phase === 'swiss' && n === 0) { errors.push('Le brassage a commencé : au moins une ronde.'); break; }
          st.swissRounds = n; break;
        }
        case 'matchMinutes': {
          const n = Math.floor(Number(v));
          if (!(n >= 1 && n <= 120)) { errors.push('Durée de match entre 1 et 120 minutes.'); break; }
          st.matchMinutes = n; break;
        }
        case 'targetScore': {
          const n = Math.floor(Number(v));
          if (!(n >= 1 && n <= 99)) { errors.push('Score cible entre 1 et 99.'); break; }
          st.targetScore = n; break;
        }
        case 'matchFormat':
          if (v !== 'temps' && v !== 'score') { errors.push('Format de match inconnu.'); break; }
          st.matchFormat = v; break;
        case 'allowDrawsSwiss':
        case 'useSeeds':
        case 'byePoints':
          if (phase !== 'setup') { errors.push('Paramètre verrouillé après le début du tournoi.'); break; }
          st[key] = key === 'byePoints' ? (Number(v) ? 1 : 0) : !!v; break;
        case 'autoAssign':
          st.autoAssign = !!v; break;
        default:
          errors.push('Paramètre inconnu : ' + key);
      }
    });
    if (errors.length) return fail('INVALID_SETTING', errors.join(' '));
    touch(s);
    return ok(s);
  }

  function updateInfo(state, patch) {
    const s = clone(state);
    const t = s.tournament;
    if ('name' in patch) t.name = normalizeName(patch.name) || 'Tournoi EPS';
    if ('sport' in patch) t.sport = String(patch.sport || SPORTS[0]).slice(0, 40);
    if ('date' in patch) t.date = String(patch.date || '').slice(0, 10);
    if ('seed' in patch) {
      if (t.phase !== 'setup') return fail('LOCKED', 'La graine du tirage est verrouillée après le début du tournoi.');
      t.seed = normalizeName(patch.seed) || randomSeed();
    }
    touch(s);
    return ok(s);
  }

  function ok(state, extra) { return Object.assign({ ok: true, state }, extra || {}); }
  function fail(code, message, extra) { return Object.assign({ ok: false, code, error: message }, extra || {}); }
  function touch(s) { s.tournament.updatedAt = Date.now(); }

  /* ------------------------------------------------------------------ *
   * Classement du brassage
   * ------------------------------------------------------------------ *
   * Points de match : victoire 1, nul 0,5, défaite 0, exemption = byePoints (1 par défaut).
   * Une exemption n'est PAS une victoire : elle n'entre ni dans les victoires, ni dans les
   * points marqués/encaissés, ni dans la force des adversaires.
   * Un forfait compte comme victoire / défaite, sans points marqués/encaissés.
   *
   * Ordre de départage (affiché dans l'interface) :
   *   1. points de match ;
   *   2. différence de points MOYENNE par match avec score (les moyennes évitent de
   *      pénaliser un joueur exempté ou arrivé en retard, qui a joué moins de matchs) ;
   *   3. points marqués moyens par match avec score ;
   *   4. force des adversaires (moyenne des points de match des adversaires rencontrés) ;
   *   5. tête de série initiale (si l'option est activée) ;
   *   6. tirage reproductible dérivé de la graine du tournoi.
   * Limites : avec 3 rondes, les critères 2 à 4 restent peu discriminants ; la différence de
   * points dépend du format (temps limité vs score cible).
   */
  const CRITERIA = [
    { key: 'matchPoints', label: 'points de match' },
    { key: 'avgDiff', label: 'différence moyenne' },
    { key: 'avgFor', label: 'points marqués moyens' },
    { key: 'oppStrength', label: 'force des adversaires' },
    { key: 'seed', label: 'tête de série' },
    { key: 'draw', label: 'tirage au sort (graine)' }
  ];

  function swissStandings(state) {
    const settings = state.tournament.settings;
    const stats = new Map();
    state.players.forEach(p => {
      stats.set(p.id, {
        playerId: p.id, name: p.name, initialSeed: p.initialSeed, withdrawn: !!p.withdrawn,
        played: 0, wins: 0, draws: 0, losses: 0, byes: 0, forfeitWins: 0, forfeitLosses: 0,
        pointsFor: 0, pointsAgainst: 0, scored: 0, opponents: [], matchPoints: 0
      });
    });
    state.matches.forEach(m => {
      if (m.phase !== 'swiss' || !m.result) return;
      const r = m.result;
      if (r.type === 'exemption') {
        const s = stats.get(m.playerAId);
        if (s) s.byes++;
        return;
      }
      const a = stats.get(m.playerAId), b = stats.get(m.playerBId);
      if (!a || !b) return;
      a.played++; b.played++;
      a.opponents.push(b.playerId); b.opponents.push(a.playerId);
      if (r.type === 'forfait') {
        const w = stats.get(r.winnerId), l = stats.get(r.loserId);
        w.wins++; w.forfeitWins++; l.losses++; l.forfeitLosses++;
        return;
      }
      a.pointsFor += r.scoreA; a.pointsAgainst += r.scoreB;
      b.pointsFor += r.scoreB; b.pointsAgainst += r.scoreA;
      a.scored++; b.scored++;
      if (r.scoreA > r.scoreB) { a.wins++; b.losses++; }
      else if (r.scoreA < r.scoreB) { b.wins++; a.losses++; }
      else { a.draws++; b.draws++; }
    });
    const list = Array.from(stats.values());
    list.forEach(s => {
      s.matchPoints = s.wins + 0.5 * s.draws + s.byes * (settings.byePoints || 0);
      s.diff = s.pointsFor - s.pointsAgainst;
      s.avgDiff = s.scored ? s.diff / s.scored : 0;
      s.avgFor = s.scored ? s.pointsFor / s.scored : 0;
    });
    list.forEach(s => {
      s.oppStrength = s.opponents.length
        ? s.opponents.reduce((acc, id) => acc + stats.get(id).matchPoints, 0) / s.opponents.length
        : 0;
      s.seedValue = settings.useSeeds ? s.initialSeed : 0;
      s.drawValue = hashString(state.tournament.seed + '#tie#' + s.playerId);
    });
    const cmpAt = (a, b, k) => {
      switch (k) {
        case 'matchPoints': return b.matchPoints - a.matchPoints;
        case 'avgDiff': return round6(b.avgDiff - a.avgDiff);
        case 'avgFor': return round6(b.avgFor - a.avgFor);
        case 'oppStrength': return round6(b.oppStrength - a.oppStrength);
        case 'seed': return a.seedValue - b.seedValue;
        case 'draw': return a.drawValue - b.drawValue || (a.playerId < b.playerId ? -1 : 1);
      }
      return 0;
    };
    list.sort((a, b) => {
      for (const c of CRITERIA) {
        const d = cmpAt(a, b, c.key);
        if (d !== 0) return d;
      }
      return 0;
    });
    list.forEach((s, i) => {
      s.rank = i + 1;
      s.decidedBy = null;
      if (i > 0) {
        const prev = list[i - 1];
        for (const c of CRITERIA) {
          if (cmpAt(prev, s, c.key) !== 0) { s.decidedBy = c.label; break; }
        }
      }
    });
    return list;
  }

  function round6(x) { return Math.abs(x) < 1e-9 ? 0 : x; }

  /* ------------------------------------------------------------------ *
   * Appariements du brassage (inspiré du système suisse)
   * ------------------------------------------------------------------ *
   * Ronde 1 :
   *   - têtes de série : la moitié haute rencontre la moitié basse (1 contre N/2+1, …) ;
   *   - sinon : tirage aléatoire reproductible (graine), appariement des voisins.
   * Rondes suivantes : on cherche l'appariement parfait de COÛT MINIMAL, avec
   *   coût(i,j) = 1000 × (nombre de rencontres déjà jouées entre i et j)
   *             +   10 × (écart de points de match)²
   *             +    1 × |écart de rang provisoire|
   * La forte pénalité garantit qu'aucune paire répétée n'est choisie si une alternative
   * existe (la recherche est exacte : séparation et évaluation, avec un budget de nœuds
   * très large pour les effectifs scolaires ; au-delà, la meilleure solution trouvée est
   * conservée et signalée).
   * Exemption (effectif impair) : priorité aux joueurs qui n'en ont pas eu, puis à ceux
   * qui ont joué le plus de matchs, puis aux moins bien classés ; parmi les meilleurs
   * candidats, on retient celui qui permet l'appariement de coût minimal.
   */
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  function previousPairCounts(state) {
    const counts = new Map();
    state.matches.forEach(m => {
      if (!m.playerAId || !m.playerBId) return;
      const k = pairKey(m.playerAId, m.playerBId);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return counts;
  }

  function minCostPerfectMatching(n, costFn, budget) {
    budget = budget || 400000;
    if (n === 0) return { pairs: [], cost: 0, optimal: true };
    const cost = [];
    for (let i = 0; i < n; i++) {
      cost.push([]);
      for (let j = 0; j < n; j++) cost[i].push(i === j ? Infinity : costFn(i, j));
    }
    const pref = [];
    const minEdge = [];
    for (let i = 0; i < n; i++) {
      const js = [];
      for (let j = 0; j < n; j++) if (j !== i) js.push(j);
      js.sort((x, y) => cost[i][x] - cost[i][y] || x - y);
      pref.push(js);
      minEdge.push(cost[i][js[0]]);
    }
    const used = new Array(n).fill(false);
    let best = Infinity, bestPairs = null, nodes = 0, aborted = false;
    const pairs = [];
    const lb0 = minEdge.reduce((a, b) => a + b, 0) / 2;
    function dfs(cur, lb) {
      if (aborted) return;
      if (++nodes > budget) { aborted = true; return; }
      let i = -1;
      for (let k = 0; k < n; k++) if (!used[k]) { i = k; break; }
      if (i < 0) {
        if (cur < best) { best = cur; bestPairs = pairs.slice(); }
        return;
      }
      used[i] = true;
      for (const j of pref[i]) {
        if (used[j]) continue;
        const nlb = lb - minEdge[i] / 2 - minEdge[j] / 2;
        const c = cur + cost[i][j];
        if (c + nlb >= best - 1e-9) continue;
        used[j] = true; pairs.push([i, j]);
        dfs(c, nlb);
        pairs.pop(); used[j] = false;
        if (aborted && bestPairs) break;
      }
      used[i] = false;
    }
    dfs(0, lb0);
    return { pairs: bestPairs || [], cost: best, optimal: !aborted };
  }

  function computeSwissPairings(state, roundNumber) {
    const settings = state.tournament.settings;
    const standings = swissStandings(state);
    const active = standings.filter(s => !s.withdrawn);
    const counts = previousPairCounts(state);
    const result = { pairs: [], bye: null, optimal: true, repeats: 0 };
    if (active.length < 2) return result;

    const firstRound = !state.matches.some(m => m.phase === 'swiss' && m.result && m.result.type !== 'exemption');
    if (roundNumber === 1 || firstRound) {
      let order;
      if (settings.useSeeds) {
        order = active.slice().sort((a, b) => a.initialSeed - b.initialSeed).map(s => s.playerId);
      } else {
        order = shuffle(active.map(s => s.playerId).sort(), rngFor(state.tournament.seed, 'ronde-' + roundNumber));
      }
      if (order.length % 2 === 1) result.bye = order.pop();
      if (settings.useSeeds) {
        const half = order.length / 2;
        for (let i = 0; i < half; i++) result.pairs.push([order[i], order[i + half]]);
      } else {
        for (let i = 0; i < order.length; i += 2) result.pairs.push([order[i], order[i + 1]]);
      }
      return result;
    }

    const solve = ids => {
      const rankOf = new Map(ids.map((id, i) => [id, i]));
      const mp = new Map(active.map(s => [s.playerId, s.matchPoints]));
      const sol = minCostPerfectMatching(ids.length, (i, j) => {
        const a = ids[i], b = ids[j];
        const rep = counts.get(pairKey(a, b)) || 0;
        const dmp = mp.get(a) - mp.get(b);
        return 1000 * rep + 10 * dmp * dmp + Math.abs(rankOf.get(a) - rankOf.get(b));
      });
      return sol;
    };

    let ids = active.map(s => s.playerId);
    if (ids.length % 2 === 1) {
      const byeOrder = active.slice().sort((a, b) =>
        (a.byes - b.byes) || (b.played - a.played) || (b.rank - a.rank));
      const minByes = byeOrder[0].byes;
      const maxPlayed = Math.max.apply(null, byeOrder.filter(s => s.byes === minByes).map(s => s.played));
      const candidates = byeOrder.filter(s => s.byes === minByes && s.played === maxPlayed).slice(0, 4);
      let bestSol = null, bestBye = null;
      candidates.forEach(c => {
        const rest = ids.filter(id => id !== c.playerId);
        const sol = solve(rest);
        if (!bestSol || sol.cost < bestSol.cost) { bestSol = sol; bestBye = { id: c.playerId, rest }; }
      });
      result.bye = bestBye.id;
      result.optimal = bestSol.optimal;
      result.pairs = bestSol.pairs.map(([i, j]) => [bestBye.rest[i], bestBye.rest[j]]);
    } else {
      const sol = solve(ids);
      result.optimal = sol.optimal;
      result.pairs = sol.pairs.map(([i, j]) => [ids[i], ids[j]]);
    }
    result.repeats = result.pairs.filter(([a, b]) => counts.has(pairKey(a, b))).length;
    return result;
  }

  function newMatch(state, fields) {
    return Object.assign({
      id: nextId(state, 'match', 'M'),
      phase: 'swiss', roundId: null, divisionId: null, courtId: null,
      playerAId: null, playerBId: null, sourceA: null, sourceB: null,
      result: null, status: 'pending', targetRanks: null, label: '',
      number: 0, depth: 0, row: 0, isBye: false, invalidated: null,
      createdAt: Date.now(), startedAt: null, completedAt: null
    }, fields);
  }

  function startTournament(state) {
    if (state.tournament.phase !== 'setup') return fail('ALREADY_STARTED', 'Le tournoi a déjà commencé.');
    const a = analyzeNames(state.players.map(p => p.name));
    if (!a.ok) return fail('INVALID_PLAYERS', a.errors.join(' '));
    let s = clone(state);
    if (s.tournament.settings.swissRounds === 0) {
      s.tournament.phase = 'swiss'; // brassage vide : on passe directement au choix des divisions
      touch(s);
      return ok(s);
    }
    s.tournament.phase = 'swiss';
    const r = generateNextSwissRound(s);
    if (!r.ok) return r;
    return ok(r.state);
  }

  function swissRoundsComplete(state) {
    return state.rounds.every(r => roundMatches(state, r).every(m => !!m.result));
  }

  function roundMatches(state, round) {
    const ids = new Set(round.matchIds);
    return state.matches.filter(m => ids.has(m.id));
  }

  function canGenerateNextRound(state) {
    const t = state.tournament;
    if (t.phase !== 'swiss') return { ok: false, reason: 'Le brassage n\'est pas en cours.' };
    if (state.rounds.length >= t.settings.swissRounds) return { ok: false, reason: 'Toutes les rondes prévues ont été générées.' };
    if (!swissRoundsComplete(state)) return { ok: false, reason: 'La ronde en cours n\'est pas terminée.' };
    if (state.players.filter(p => !p.withdrawn).length < 2) return { ok: false, reason: 'Moins de 2 joueurs actifs.' };
    return { ok: true };
  }

  function generateNextSwissRound(state) {
    const can = canGenerateNextRound(state);
    if (!can.ok) return fail('CANNOT_GENERATE', can.reason);
    const s = clone(state);
    const number = s.rounds.length + 1;
    const p = computeSwissPairings(s, number);
    const round = { id: nextId(s, 'round', 'R'), phase: 'swiss', number, matchIds: [], optimal: p.optimal, repeats: p.repeats };
    p.pairs.forEach(([a, b], i) => {
      const m = newMatch(s, { phase: 'swiss', roundId: round.id, playerAId: a, playerBId: b, number: i + 1, label: 'R' + number + '-' + (i + 1), depth: number - 1, row: i });
      s.matches.push(m);
      round.matchIds.push(m.id);
    });
    if (p.bye) {
      const m = newMatch(s, {
        phase: 'swiss', roundId: round.id, playerAId: p.bye, isBye: true, number: p.pairs.length + 1,
        label: 'R' + number + '-exempt', depth: number - 1, row: p.pairs.length,
        result: { type: 'exemption', winnerId: null, loserId: null, playerAId: p.bye, playerBId: null }
      });
      m.completedAt = Date.now();
      s.matches.push(m);
      round.matchIds.push(m.id);
    }
    s.rounds.push(round);
    refresh(s);
    const out = s.tournament.settings.autoAssign ? autoAssignCourts(s).state : s;
    touch(out);
    return ok(out, { pairing: p });
  }

  /* ------------------------------------------------------------------ *
   * Divisions et tableaux de classement intégral
   * ------------------------------------------------------------------ */
  function divisionFormat(size) {
    if (size >= 2 && isPowerOfTwo(size)) return 'bracket';
    if (POOL_SIZES.includes(size)) return 'pool';
    return null;
  }

  function matchesPerPlayer(size) {
    return divisionFormat(size) === 'bracket' ? log2int(size) : size - 1;
  }

  function matchesInDivision(size) {
    return divisionFormat(size) === 'bracket' ? size * log2int(size) / 2 : size * (size - 1) / 2;
  }

  function validatePartition(sizes, n) {
    if (!Array.isArray(sizes) || !sizes.length) return { ok: false, error: 'Partition vide.' };
    const bad = sizes.filter(x => !Number.isInteger(x) || !divisionFormat(x));
    if (bad.length) return { ok: false, error: 'Tailles non autorisées : ' + bad.join(', ') + ' (tableau : 2, 4, 8, 16, 32, 64 ; poule : 3, 5, 6).' };
    const sum = sizes.reduce((a, b) => a + b, 0);
    if (sum !== n) return { ok: false, error: 'La somme des divisions (' + sum + ') doit être égale au nombre de joueurs (' + n + ').' };
    return { ok: true };
  }

  /** Décrit une partition : formats, matchs par joueur, total, avertissements. */
  function describePartition(sizes) {
    const divisions = [];
    let start = 1;
    sizes.forEach((size, i) => {
      divisions.push({
        name: divisionLetter(i), size, format: divisionFormat(size),
        rankStart: start, rankEnd: start + size - 1,
        matchesPerPlayer: matchesPerPlayer(size), matches: matchesInDivision(size)
      });
      start += size;
    });
    const mpp = divisions.map(d => d.matchesPerPlayer);
    const total = divisions.reduce((a, d) => a + d.matches, 0);
    const warnings = [];
    if (divisions.length > 1) warnings.push('Les frontières de divisions sont fixées par le brassage : un joueur d\'une division ne peut pas finir devant un joueur d\'une division supérieure, même s\'il gagne tous ses matchs.');
    if (Math.max.apply(null, mpp) !== Math.min.apply(null, mpp)) warnings.push('Nombre de matchs inégal selon la division (de ' + Math.min.apply(null, mpp) + ' à ' + Math.max.apply(null, mpp) + ' matchs par joueur).');
    if (divisions.some(d => d.format === 'pool')) warnings.push('Une ou plusieurs divisions se jouent en poule (tous contre tous) : ce n\'est plus un tableau intégral pur ; le rang y est obtenu par victoires puis départages.');
    if (divisions.some(d => d.size === 2)) warnings.push('Une division de 2 joueurs ne comporte qu\'un seul match.');
    return { sizes: sizes.slice(), divisions, total, matchesPerPlayer: mpp, warnings, pure: divisions.every(d => d.format === 'bracket') };
  }

  /**
   * Propose des partitions de N joueurs en divisions, classées par un score heuristique
   * (plus petit = meilleur) :
   *   5 × (écart de matchs par joueur entre divisions) + 1,5 × (divisions − 1)
   *   + Σ poules (3 + 2 × (taille − 3)) + 25 × (divisions de 2)
   *   + 4 × max(0, 3 − matchs moyens) + 3 × max(0, matchs moyens − 4) si une poule existe
   * (un tableau unique de 2^k joueurs reste ainsi recommandé : pas de frontière de division).
   * L'enseignant choisit ; la première proposition est seulement « recommandée ».
   */
  function proposePartitions(n, limit) {
    limit = limit || 5;
    if (n < 2) return [];
    const sizesAllowed = BRACKET_SIZES.concat(POOL_SIZES).filter(x => x <= n).sort((a, b) => b - a);
    const maxDiv = Math.min(12, Math.ceil(n / 3) + 1);
    const found = [];
    (function rec(remaining, maxSize, acc) {
      if (found.length > 5000) return;
      if (remaining === 0) { found.push(acc.slice()); return; }
      if (acc.length >= maxDiv) return;
      for (const sz of sizesAllowed) {
        if (sz > maxSize || sz > remaining) continue;
        acc.push(sz); rec(remaining - sz, sz, acc); acc.pop();
      }
    })(n, Infinity, []);
    const scored = found.map(sizes => {
      const d = describePartition(sizes);
      const mpp = d.matchesPerPlayer;
      const avg = sizes.reduce((acc, sz, i) => acc + sz * mpp[i], 0) / n;
      const poolCost = d.divisions.filter(x => x.format === 'pool').reduce((acc, x) => acc + 3 + 2 * (x.size - 3), 0);
      const twos = sizes.filter(x => x === 2).length;
      const spread = Math.max.apply(null, mpp) - Math.min.apply(null, mpp);
      const score = 5 * spread + 1.5 * (sizes.length - 1) + poolCost + 25 * twos + 4 * Math.max(0, 3 - avg) + (poolCost ? 3 * Math.max(0, avg - 4) : 0);
      return Object.assign(d, { score: Math.round(score * 100) / 100, avgMatches: Math.round(avg * 100) / 100 });
    });
    scored.sort((a, b) => a.score - b.score || b.sizes[0] - a.sizes[0]);
    const out = scored.slice(0, limit);
    if (out.length) out[0].recommended = true;
    return out;
  }

  // Ordre standard des têtes de série dans un tableau de taille n (1 et 2 ne se croisent qu'en finale).
  function seedOrder(n) {
    let order = [1, 2];
    while (order.length < n) {
      const m = order.length * 2;
      const next = [];
      order.forEach(s => { next.push(s); next.push(m + 1 - s); });
      order = next;
    }
    return order.slice(0, n);
  }

  /**
   * Construit le tableau intégral d'une division de taille 2^k.
   * Récurrence : un groupe de m joueurs jouant pour les places [a, a+m-1] dispute m/2 matchs ;
   * les vainqueurs forment le groupe [a, a+m/2-1], les perdants le groupe [a+m/2, a+m-1].
   * Quand m = 2, le match attribue directement les places a et a+1.
   * Total : (n/2) × log2(n) matchs ; chaque joueur en joue log2(n).
   * Disposition graphique : colonne = tour (depth), ligne = rang du match dans le tour ; les
   * vainqueurs d'un groupe sont placés au-dessus des perdants (branche haute / basse).
   */
  function buildBracket(state, division, seededIds) {
    const n = seededIds.length;
    const order = seedOrder(n);
    const slots = order.map(seed => ({ player: seededIds[seed - 1] }));
    let number = 0;
    const codes = { 2: 'F', 4: 'D', 8: 'Q', 16: 'H', 32: 'S', 64: 'T' };
    const created = [];
    function rec(groupSlots, placeStart, depth, rowStart, branch) {
      const m = groupSlots.length;
      const ms = [];
      for (let i = 0; i < m / 2; i++) {
        const a = groupSlots[2 * i], b = groupSlots[2 * i + 1];
        number++;
        const isFinal = m === 2;
        const label = depth === 0 ? (codes[n] || 'R') + (i + 1)
          : (isFinal ? 'Places ' + placeStart + '-' + (placeStart + 1) : 'Places ' + placeStart + '-' + (placeStart + m - 1));
        const match = newMatch(state, {
          phase: 'final', divisionId: division.id, number, label,
          depth, row: rowStart + i, branch: depth === 0 ? 'initial' : branch,
          placementFinal: isFinal,
          playerAId: a.player || null, playerBId: b.player || null,
          sourceA: a.match ? { matchId: a.match, take: a.take } : null,
          sourceB: b.match ? { matchId: b.match, take: b.take } : null,
          targetRanks: [placeStart, placeStart + m - 1]
        });
        state.matches.push(match);
        created.push(match);
        ms.push(match);
      }
      if (m === 2) return;
      const half = m / 2;
      // Branche haute (vainqueurs) puis branche basse (perdants) ; la couleur suit la moitié
      // de la division dans laquelle se trouvent les places en jeu.
      const mid = division.globalRankStart + division.playerIds.length / 2;
      const upperBranch = placeStart < mid ? 'upper' : 'lower';
      const lowerBranch = placeStart + half < mid ? 'upper' : 'lower';
      rec(ms.map(x => ({ match: x.id, take: 'winner' })), placeStart, depth + 1, rowStart, upperBranch);
      rec(ms.map(x => ({ match: x.id, take: 'loser' })), placeStart + half, depth + 1, rowStart + half / 2, lowerBranch);
    }
    rec(slots, division.globalRankStart, 0, 0, 'initial');
    return created;
  }

  // Poule (tous contre tous) — méthode du cercle pour répartir les matchs en tours.
  function buildPool(state, division, seededIds) {
    const ids = seededIds.slice();
    if (ids.length % 2 === 1) ids.push(null);
    const n = ids.length;
    const rounds = n - 1;
    let number = 0;
    const created = [];
    let arr = ids.slice();
    for (let r = 0; r < rounds; r++) {
      let row = 0;
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        if (a && b) {
          number++;
          const m = newMatch(state, {
            phase: 'final', divisionId: division.id, number, label: 'Poule ' + division.name + ' — tour ' + (r + 1),
            depth: r, row: row++, branch: 'pool', playerAId: a, playerBId: b,
            targetRanks: [division.globalRankStart, division.globalRankStart + division.playerIds.length - 1]
          });
          state.matches.push(m);
          created.push(m);
        }
      }
      arr = [arr[0]].concat([arr[n - 1]], arr.slice(1, n - 1));
    }
    return created;
  }

  /** Ordre des joueurs pour former les divisions : classement du brassage (forfaits généraux en dernier). */
  function seedingOrder(state) {
    let order;
    if (state.rounds.length > 0) {
      order = swissStandings(state).map(s => s.playerId);
    } else if (state.tournament.settings.useSeeds) {
      order = state.players.slice().sort((a, b) => a.initialSeed - b.initialSeed).map(p => p.id);
    } else {
      order = shuffle(state.players.map(p => p.id).sort(), rngFor(state.tournament.seed, 'divisions'));
    }
    const pm = playerMap(state);
    return order.filter(id => !pm.get(id).withdrawn).concat(order.filter(id => pm.get(id).withdrawn));
  }

  function canFreezeDivisions(state) {
    if (state.tournament.phase !== 'swiss') return { ok: false, reason: 'Les divisions ne peuvent être formées qu\'à la fin du brassage.' };
    if (state.rounds.length < state.tournament.settings.swissRounds) return { ok: false, reason: 'Toutes les rondes de brassage n\'ont pas été jouées.' };
    if (!swissRoundsComplete(state)) return { ok: false, reason: 'La dernière ronde n\'est pas terminée.' };
    return { ok: true };
  }

  /** Fige les têtes de série et génère les tableaux. L'interface doit avoir demandé confirmation. */
  function freezeDivisions(state, sizes) {
    const can = canFreezeDivisions(state);
    if (!can.ok) return fail('CANNOT_FREEZE', can.reason);
    const v = validatePartition(sizes, state.players.length);
    if (!v.ok) return fail('INVALID_PARTITION', v.error);
    const s = clone(state);
    const order = seedingOrder(s);
    let start = 1, offset = 0;
    s.divisions = [];
    sizes.forEach((size, i) => {
      const ids = order.slice(offset, offset + size);
      const div = { id: 'D' + divisionLetter(i), name: divisionLetter(i), playerIds: ids, globalRankStart: start, format: divisionFormat(size), size };
      s.divisions.push(div);
      if (div.format === 'bracket') buildBracket(s, div, ids); else buildPool(s, div, ids);
      start += size; offset += size;
    });
    s.tournament.phase = 'finals';
    s.tournament.frozenAt = Date.now();
    refresh(s);
    const out = s.tournament.settings.autoAssign ? autoAssignCourts(s).state : s;
    touch(out);
    return ok(out);
  }

  /** Supprime divisions et matchs de tableau pour revenir au brassage (confirmation côté interface). */
  function reopenSwiss(state) {
    if (state.tournament.phase !== 'finals' && state.tournament.phase !== 'done') return fail('NOT_IN_FINALS', 'Les tableaux ne sont pas générés.');
    const s = clone(state);
    s.matches = s.matches.filter(m => m.phase !== 'final');
    s.divisions = [];
    s.tournament.phase = 'swiss';
    refresh(s);
    touch(s);
    return ok(s);
  }

  /** Remet le tournoi en configuration en conservant joueurs et paramètres. */
  function resetMatches(state) {
    const s = clone(state);
    s.matches = []; s.rounds = []; s.divisions = [];
    s.players.forEach(p => { p.withdrawn = false; });
    s.tournament.phase = 'setup';
    delete s.tournament.frozenAt;
    touch(s);
    return ok(s);
  }

  /* ------------------------------------------------------------------ *
   * Propagation des résultats, états, invalidations
   * ------------------------------------------------------------------ */
  function resolveSource(src, mm) {
    if (!src) return undefined;
    const m = mm.get(src.matchId);
    if (!m || !m.result) return null;
    return src.take === 'winner' ? m.result.winnerId : m.result.loserId;
  }

  function computeStatus(m) {
    if (m.result) return 'completed';
    if (m.courtId) return 'in_progress';
    if (m.playerAId && m.playerBId) return 'ready';
    return 'pending';
  }

  /**
   * Recalcule les joueurs de chaque match de tableau à partir des sources (ordre de création =
   * ordre topologique), invalide les résultats devenus incohérents, applique les forfaits
   * automatiques (joueur retiré) et met à jour les états. Renvoie la liste des matchs invalidés.
   */
  function refresh(s) {
    const mm = matchMap(s);
    const pm = playerMap(s);
    const invalidated = [];
    s.matches.forEach(m => {
      if (m.phase === 'final') {
        if (m.sourceA) m.playerAId = resolveSource(m.sourceA, mm);
        if (m.sourceB) m.playerBId = resolveSource(m.sourceB, mm);
        if (m.result && m.result.type !== 'exemption' && (m.result.playerAId !== m.playerAId || m.result.playerBId !== m.playerBId)) {
          m.invalidated = { previous: m.result, at: Date.now() };
          invalidated.push(m.id);
          m.result = null; m.completedAt = null;
        }
        if ((!m.playerAId || !m.playerBId) && m.courtId) { m.courtId = null; m.startedAt = null; }
      }
      // Forfait automatique : un joueur retiré perd ses matchs non joués (tableaux et ronde en cours).
      if (!m.result && m.playerAId && m.playerBId) {
        const wa = pm.get(m.playerAId).withdrawn, wb = pm.get(m.playerBId).withdrawn;
        if (wa || wb) {
          // Si les deux sont retirés (double forfait), A est déclaré vainqueur pour que le tableau avance.
          const loser = wa && !wb ? m.playerAId : m.playerBId;
          const winner = loser === m.playerAId ? m.playerBId : m.playerAId;
          m.result = makeResult(m, { type: 'forfait', winnerId: winner, loserId: loser, auto: true, double: wa && wb });
          m.courtId = null; m.completedAt = Date.now();
        }
      }
      m.status = computeStatus(m);
    });
    s.rounds.forEach(r => {
      r.status = roundMatches(s, r).every(m => !!m.result) ? 'completed' : 'in_progress';
    });
    if (s.tournament.phase === 'finals' || s.tournament.phase === 'done') {
      const finals = s.matches.filter(m => m.phase === 'final');
      s.tournament.phase = finals.length && finals.every(m => m.result) ? 'done' : 'finals';
    }
    return invalidated;
  }

  function makeResult(m, r) {
    return Object.assign({ playerAId: m.playerAId, playerBId: m.playerBId }, r);
  }

  /** Validation explicite d'un score selon la phase et les règles. */
  function validateScore(state, match, scoreA, scoreB) {
    const a = Number(scoreA), b = Number(scoreB);
    if (scoreA === '' || scoreB === '' || scoreA == null || scoreB == null) return 'Saisissez les deux scores.';
    if (!Number.isInteger(a) || !Number.isInteger(b)) return 'Les scores doivent être des nombres entiers.';
    if (a < 0 || b < 0) return 'Les scores ne peuvent pas être négatifs.';
    if (a > MAX_SCORE || b > MAX_SCORE) return 'Score trop élevé (maximum ' + MAX_SCORE + ').';
    if (a === b) {
      if (match.phase === 'final') return 'Égalité interdite en tableau : jouez un point décisif et saisissez le score final.';
      if (!state.tournament.settings.allowDrawsSwiss) return 'Match nul non autorisé (paramètre) : jouez un point décisif.';
    }
    return null;
  }

  function findMatch(state, id) {
    return state.matches.find(m => m.id === id);
  }

  /**
   * Évalue les conséquences d'une modification (saisie, correction ou effacement) sur un match.
   * Renvoie { blocked, reason, invalidates[], regenerateRoundId, laterRoundsPlayed }.
   */
  function analyzeImpact(state, matchId, apply) {
    const m = findMatch(state, matchId);
    const impact = { blocked: false, reason: null, invalidates: [], regenerateRoundId: null, laterRoundsPlayed: false, needsConfirm: false };
    if (m.phase === 'swiss') {
      if (state.tournament.phase === 'finals' || state.tournament.phase === 'done') {
        impact.blocked = true;
        impact.reason = 'Les têtes de série sont figées : pour corriger un match du brassage, rouvrez d\'abord le brassage (les tableaux seront supprimés).';
        return impact;
      }
      const round = state.rounds.find(r => r.id === m.roundId);
      const later = state.rounds.filter(r => r.number > round.number);
      later.forEach(r => {
        const ms = roundMatches(state, r).filter(x => !x.isBye);
        if (ms.some(x => x.result)) impact.laterRoundsPlayed = true;
        else impact.regenerateRoundId = r.id;
      });
      impact.needsConfirm = impact.laterRoundsPlayed || !!impact.regenerateRoundId;
      return impact;
    }
    // Tableau : simulation sur une copie, puis repérage des résultats aval invalidés.
    const s = clone(state);
    apply(s, findMatch(s, matchId));
    impact.invalidates = refresh(s);
    impact.needsConfirm = impact.invalidates.length > 0;
    return impact;
  }

  function describeImpact(state, impact) {
    const lines = [];
    if (impact.regenerateRoundId) {
      const r = state.rounds.find(x => x.id === impact.regenerateRoundId);
      lines.push('La ronde ' + r.number + ' (pas encore jouée) sera supprimée puis régénérée avec le classement corrigé.');
    }
    if (impact.laterRoundsPlayed) lines.push('Des rondes suivantes ont déjà été jouées : elles sont conservées, mais leurs appariements avaient été calculés avec l\'ancien classement.');
    if (impact.invalidates.length) {
      const mm = matchMap(state);
      lines.push('Résultats aval invalidés et effacés : ' + impact.invalidates.map(id => matchName(state, mm.get(id))).join(', ') + '.');
    }
    return lines.join('\n');
  }

  function matchName(state, m) {
    if (!m) return '?';
    if (m.phase === 'swiss') return 'Ronde ' + ((state.rounds.find(r => r.id === m.roundId) || {}).number || '?') + ' match ' + m.number;
    const d = state.divisions.find(x => x.id === m.divisionId);
    return (d ? d.name : '') + 'M' + m.number + ' (' + m.label + ')';
  }

  function applyChange(state, matchId, mutate, opts) {
    opts = opts || {};
    const m0 = findMatch(state, matchId);
    if (!m0) return fail('NOT_FOUND', 'Match introuvable.');
    const impact = analyzeImpact(state, matchId, mutate);
    if (impact.blocked) return fail('LOCKED_FINALS', impact.reason, { impact });
    if (impact.needsConfirm && !opts.confirm) {
      return fail('NEEDS_CONFIRM', describeImpact(state, impact), { needsConfirm: true, impact });
    }
    let s = clone(state);
    const m = findMatch(s, matchId);
    mutate(s, m);
    if (impact.regenerateRoundId) {
      const r = s.rounds.find(x => x.id === impact.regenerateRoundId);
      const ids = new Set(r.matchIds);
      s.matches = s.matches.filter(x => !ids.has(x.id));
      s.rounds = s.rounds.filter(x => x.id !== r.id);
    }
    const invalidated = refresh(s);
    if (impact.regenerateRoundId) {
      const g = generateNextSwissRound(s);
      if (g.ok) s = g.state;
    }
    if (s.tournament.settings.autoAssign) s = autoAssignCourts(s).state;
    touch(s);
    return ok(s, { invalidated, impact });
  }

  /**
   * Enregistre ou corrige un résultat.
   * input = { scoreA, scoreB } ou { forfeitBy: playerId } (le joueur indiqué perd par forfait).
   * opts.confirm = true pour accepter les conséquences signalées (needsConfirm).
   */
  function setResult(state, matchId, input, opts) {
    const m = findMatch(state, matchId);
    if (!m) return fail('NOT_FOUND', 'Match introuvable.');
    if (m.isBye) return fail('BYE', 'Une exemption n\'a pas de score.');
    if (!m.playerAId || !m.playerBId) return fail('NOT_READY', 'Les deux joueurs de ce match ne sont pas encore connus.');
    let result;
    if (input && input.forfeitBy) {
      if (input.forfeitBy !== m.playerAId && input.forfeitBy !== m.playerBId) return fail('INVALID', 'Joueur forfait inconnu pour ce match.');
      const loser = input.forfeitBy;
      result = { type: 'forfait', winnerId: loser === m.playerAId ? m.playerBId : m.playerAId, loserId: loser, scoreA: null, scoreB: null };
    } else {
      const err = validateScore(state, m, input && input.scoreA, input && input.scoreB);
      if (err) return fail('INVALID_SCORE', err);
      const a = Number(input.scoreA), b = Number(input.scoreB);
      result = {
        type: 'score', scoreA: a, scoreB: b, draw: a === b,
        winnerId: a > b ? m.playerAId : (b > a ? m.playerBId : null),
        loserId: a > b ? m.playerBId : (b > a ? m.playerAId : null)
      };
    }
    return applyChange(state, matchId, (s, mm) => {
      mm.result = makeResult(mm, result);
      mm.invalidated = null;
      mm.courtId = null;
      mm.completedAt = Date.now();
    }, opts);
  }

  function clearResult(state, matchId, opts) {
    const m = findMatch(state, matchId);
    if (!m) return fail('NOT_FOUND', 'Match introuvable.');
    if (m.isBye) return fail('BYE', 'Une exemption ne peut pas être effacée.');
    if (!m.result) return fail('NO_RESULT', 'Ce match n\'a pas de résultat.');
    if (m.result.auto) return fail('AUTO', 'Forfait automatique (joueur retiré) : réintégrez le joueur pour l\'annuler.');
    return applyChange(state, matchId, (s, mm) => { mm.result = null; mm.completedAt = null; }, opts);
  }

  /** Retrait (abandon) ou réintégration d'un joueur. */
  function setWithdrawn(state, playerId, withdrawn) {
    const s = clone(state);
    const p = s.players.find(x => x.id === playerId);
    if (!p) return fail('NOT_FOUND', 'Joueur introuvable.');
    p.withdrawn = !!withdrawn;
    if (!withdrawn) {
      // Annule les forfaits automatiques qui le concernent (s'ils n'ont pas de conséquence aval jouée).
      s.matches.forEach(m => {
        if (m.result && m.result.auto && (m.playerAId === playerId || m.playerBId === playerId)) { m.result = null; m.completedAt = null; }
      });
    } else {
      s.matches.forEach(m => {
        if (!m.result && m.courtId && (m.playerAId === playerId || m.playerBId === playerId)) m.courtId = null;
      });
    }
    refresh(s);
    let out = s;
    if (out.tournament.settings.autoAssign) out = autoAssignCourts(out).state;
    touch(out);
    return ok(out);
  }

  /** Ajout d'un retardataire pendant le brassage, uniquement entre deux rondes. */
  function addLatePlayer(state, name) {
    const t = state.tournament;
    if (t.phase === 'setup') return fail('SETUP', 'Utilisez la liste des joueurs de la configuration.');
    if (t.phase !== 'swiss') return fail('LOCKED', 'Les tableaux sont générés : impossible d\'ajouter un joueur sans rouvrir le brassage.');
    if (!swissRoundsComplete(state)) return fail('ROUND_IN_PROGRESS', 'Attendez la fin de la ronde en cours pour ajouter un joueur.');
    const n = normalizeName(name);
    if (!n) return fail('EMPTY', 'Nom vide.');
    if (state.players.some(p => nameKey(p.name) === nameKey(n))) return fail('DUPLICATES', 'Ce nom existe déjà.');
    const s = clone(state);
    s.players.push({ id: nextId(s, 'player', 'P'), name: n, initialSeed: s.players.length + 1, withdrawn: false, late: true });
    touch(s);
    return ok(s);
  }

  function renamePlayer(state, playerId, name) {
    const n = normalizeName(name);
    if (!n) return fail('EMPTY', 'Nom vide.');
    if (state.players.some(p => p.id !== playerId && nameKey(p.name) === nameKey(n))) return fail('DUPLICATES', 'Ce nom existe déjà.');
    const s = clone(state);
    const p = s.players.find(x => x.id === playerId);
    if (!p) return fail('NOT_FOUND', 'Joueur introuvable.');
    p.name = n;
    touch(s);
    return ok(s);
  }

  /* ------------------------------------------------------------------ *
   * Planification sur les terrains
   * ------------------------------------------------------------------ *
   * La génération des rencontres est indépendante de leur planification. Un match « prêt »
   * (deux joueurs connus, pas de résultat) peut être affecté à un terrain libre si aucun de
   * ses joueurs n'est déjà sur un terrain. Priorité : tour le moins avancé, puis joueurs qui
   * attendent depuis le plus longtemps (repos), puis ordre des divisions et numéro de match.
   */
  function courtIds(state) {
    const out = [];
    for (let i = 1; i <= state.tournament.settings.courts; i++) out.push('C' + i);
    return out;
  }

  function courtNumber(courtId) { return Number(String(courtId).replace(/\D/g, '')); }

  function busyPlayerIds(state) {
    const busy = new Set();
    state.matches.forEach(m => {
      if (m.courtId && !m.result) { busy.add(m.playerAId); busy.add(m.playerBId); }
    });
    return busy;
  }

  function lastPlayedAt(state) {
    const last = new Map();
    state.matches.forEach(m => {
      if (!m.result || m.isBye || !m.completedAt) return;
      [m.playerAId, m.playerBId].forEach(id => { if (id) last.set(id, Math.max(last.get(id) || 0, m.completedAt)); });
    });
    return last;
  }

  function readyQueue(state) {
    const last = lastPlayedAt(state);
    const divOrder = new Map(state.divisions.map((d, i) => [d.id, i]));
    return state.matches
      .filter(m => m.status === 'ready' && !m.courtId && !m.isBye)
      .map(m => ({ m, wait: Math.max(last.get(m.playerAId) || 0, last.get(m.playerBId) || 0) }))
      .sort((x, y) => (x.m.depth - y.m.depth) || (x.wait - y.wait)
        || ((divOrder.get(x.m.divisionId) || 0) - (divOrder.get(y.m.divisionId) || 0)) || (x.m.number - y.m.number))
      .map(x => x.m);
  }

  function freeCourtIds(state) {
    const used = new Set(state.matches.filter(m => m.courtId && !m.result).map(m => m.courtId));
    return courtIds(state).filter(c => !used.has(c));
  }

  function autoAssignCourts(state) {
    const s = clone(state);
    const busy = busyPlayerIds(s);
    const free = freeCourtIds(s);
    const queue = readyQueue(s);
    const assigned = [];
    for (const c of free) {
      const idx = queue.findIndex(m => !busy.has(m.playerAId) && !busy.has(m.playerBId));
      if (idx < 0) break;
      const m = queue.splice(idx, 1)[0];
      const mm = findMatch(s, m.id);
      mm.courtId = c; mm.startedAt = Date.now();
      busy.add(m.playerAId); busy.add(m.playerBId);
      assigned.push(m.id);
    }
    refresh(s);
    return ok(s, { assigned });
  }

  function assignCourt(state, matchId, courtId) {
    const m = findMatch(state, matchId);
    if (!m) return fail('NOT_FOUND', 'Match introuvable.');
    if (m.result) return fail('COMPLETED', 'Match déjà terminé.');
    if (!m.playerAId || !m.playerBId) return fail('NOT_READY', 'Les joueurs de ce match ne sont pas encore connus.');
    if (!courtIds(state).includes(courtId)) return fail('INVALID_COURT', 'Terrain inexistant.');
    const occupant = state.matches.find(x => x.courtId === courtId && !x.result && x.id !== matchId);
    if (occupant) return fail('COURT_BUSY', 'Ce terrain est déjà occupé par ' + matchName(state, occupant) + '.');
    const busy = state.matches.filter(x => x.id !== matchId && x.courtId && !x.result);
    const pm = playerMap(state);
    for (const x of busy) {
      for (const id of [m.playerAId, m.playerBId]) {
        if (x.playerAId === id || x.playerBId === id) return fail('PLAYER_BUSY', pm.get(id).name + ' joue déjà sur un autre terrain.');
      }
    }
    const s = clone(state);
    const mm = findMatch(s, matchId);
    mm.courtId = courtId; mm.startedAt = Date.now();
    refresh(s);
    touch(s);
    return ok(s);
  }

  function unassignCourt(state, matchId) {
    const s = clone(state);
    const m = findMatch(s, matchId);
    if (!m) return fail('NOT_FOUND', 'Match introuvable.');
    m.courtId = null; m.startedAt = null;
    refresh(s);
    touch(s);
    return ok(s);
  }

  /* ------------------------------------------------------------------ *
   * Classements de phase finale
   * ------------------------------------------------------------------ */
  function poolRanking(state, division) {
    const ms = state.matches.filter(m => m.divisionId === division.id);
    const st = new Map(division.playerIds.map((id, i) => [id, { playerId: id, seedIndex: i, wins: 0, losses: 0, pf: 0, pa: 0 }]));
    ms.forEach(m => {
      if (!m.result) return;
      const w = st.get(m.result.winnerId), l = st.get(m.result.loserId);
      if (w) w.wins++;
      if (l) l.losses++;
      if (m.result.type === 'score') {
        const a = st.get(m.playerAId), b = st.get(m.playerBId);
        a.pf += m.result.scoreA; a.pa += m.result.scoreB; b.pf += m.result.scoreB; b.pa += m.result.scoreA;
      }
    });
    const list = Array.from(st.values());
    // Victoires, puis victoires dans les confrontations entre ex aequo, puis différence, points marqués, rang du brassage.
    const h2h = (group, id) => ms.filter(m => m.result && group.includes(m.playerAId) && group.includes(m.playerBId) && m.result.winnerId === id).length;
    list.sort((a, b) => b.wins - a.wins);
    const out = [];
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j < list.length && list[j].wins === list[i].wins) j++;
      const group = list.slice(i, j);
      const ids = group.map(g => g.playerId);
      group.forEach(g => { g.h2h = h2h(ids, g.playerId); g.diff = g.pf - g.pa; });
      group.sort((a, b) => (b.h2h - a.h2h) || (b.diff - a.diff) || (b.pf - a.pf) || (a.seedIndex - b.seedIndex));
      out.push.apply(out, group);
      i = j;
    }
    return { rows: out, complete: ms.every(m => !!m.result) };
  }

  /**
   * Classement final : place attribuée à chaque joueur (null si pas encore déterminée).
   * Tableau : le vainqueur d'un match « Places a-(a+1) » obtient a, le perdant a+1.
   * Poule : rang de poule une fois tous les matchs joués.
   */
  function finalStandings(state) {
    const pm = playerMap(state);
    const rows = [];
    const swiss = swissStandings(state);
    const swissRank = new Map(swiss.map(s => [s.playerId, s.rank]));
    state.divisions.forEach(d => {
      const ranks = new Map();
      if (d.format === 'bracket') {
        state.matches.filter(m => m.divisionId === d.id && m.placementFinal && m.result).forEach(m => {
          ranks.set(m.result.winnerId, m.targetRanks[0]);
          ranks.set(m.result.loserId, m.targetRanks[0] + 1);
        });
      } else {
        const pr = poolRanking(state, d);
        if (pr.complete) pr.rows.forEach((r, i) => ranks.set(r.playerId, d.globalRankStart + i));
      }
      d.playerIds.forEach(id => {
        rows.push({
          playerId: id, name: pm.get(id).name, divisionId: d.id, divisionName: d.name,
          rank: ranks.has(id) ? ranks.get(id) : null, swissRank: swissRank.get(id) || null,
          withdrawn: !!pm.get(id).withdrawn, path: playerPath(state, id)
        });
      });
    });
    rows.sort((a, b) => (a.rank == null) - (b.rank == null) || (a.rank || 0) - (b.rank || 0));
    const assigned = rows.filter(r => r.rank != null).length;
    return { rows, assigned, total: state.players.length, complete: state.divisions.length > 0 && assigned === state.players.length };
  }

  function playerPath(state, playerId) {
    return state.matches
      .filter(m => m.phase === 'final' && m.result && (m.playerAId === playerId || m.playerBId === playerId))
      .map(m => ({ matchId: m.id, number: m.number, label: m.label, won: m.result.winnerId === playerId, forfeit: m.result.type === 'forfait' }));
  }

  /** Vérifie qu'un classement final attribue les rangs 1..N exactement une fois. */
  function checkFinalRanking(state) {
    const fs = finalStandings(state);
    const errors = [];
    const ranks = fs.rows.map(r => r.rank);
    const n = state.players.length;
    const seen = new Set();
    ranks.forEach(r => {
      if (r == null) errors.push('Place non attribuée.');
      else if (seen.has(r)) errors.push('Place ' + r + ' attribuée deux fois.');
      else seen.add(r);
    });
    for (let i = 1; i <= n; i++) if (!seen.has(i)) errors.push('Place ' + i + ' manquante.');
    const ids = new Set(fs.rows.map(r => r.playerId));
    if (ids.size !== n) errors.push('Joueur manquant ou dupliqué dans le classement.');
    return { ok: errors.length === 0, errors, standings: fs };
  }

  /** Statistiques globales par joueur (brassage + phase finale). */
  function playerStats(state) {
    const st = new Map(state.players.map(p => [p.id, { playerId: p.id, name: p.name, played: 0, wins: 0, losses: 0, draws: 0, byes: 0, pf: 0, pa: 0 }]));
    state.matches.forEach(m => {
      if (!m.result) return;
      if (m.result.type === 'exemption') { st.get(m.playerAId).byes++; return; }
      const a = st.get(m.playerAId), b = st.get(m.playerBId);
      a.played++; b.played++;
      if (m.result.type === 'score') {
        a.pf += m.result.scoreA; a.pa += m.result.scoreB; b.pf += m.result.scoreB; b.pa += m.result.scoreA;
      }
      if (m.result.draw) { a.draws++; b.draws++; }
      else { st.get(m.result.winnerId).wins++; st.get(m.result.loserId).losses++; }
    });
    return Array.from(st.values());
  }

  /** Estimation du nombre de vagues et de la durée (rotation de 2 min comprise). */
  function estimateSchedule(n, courts, swissRounds, sizes, minutes) {
    const perRound = Math.floor(n / 2);
    const swissWaves = swissRounds * Math.ceil(perRound / Math.max(1, courts));
    let finalWaves = 0;
    if (sizes && sizes.length) {
      const byDepth = new Map();
      sizes.forEach(sz => {
        if (divisionFormat(sz) === 'bracket') {
          for (let d = 0; d < log2int(sz); d++) byDepth.set(d, (byDepth.get(d) || 0) + sz / 2);
        } else {
          const rounds = sz % 2 ? sz : sz - 1;
          const per = Math.floor(sz / 2);
          for (let d = 0; d < rounds; d++) byDepth.set(d, (byDepth.get(d) || 0) + per);
        }
      });
      byDepth.forEach(v => { finalWaves += Math.ceil(v / Math.max(1, courts)); });
    }
    const waves = swissWaves + finalWaves;
    return { swissWaves, finalWaves, waves, minutes: waves * ((minutes || 8) + 2) };
  }

  /* ------------------------------------------------------------------ *
   * Sérialisation, migration, validation d'import
   * ------------------------------------------------------------------ */
  function migrate(data) {
    if (!data || typeof data !== 'object') throw new Error('Données illisibles.');
    if (data.schemaVersion == null) throw new Error('Fichier non reconnu (schemaVersion absent).');
    if (data.schemaVersion > SCHEMA_VERSION) throw new Error('Fichier créé par une version plus récente de l\'application (schéma ' + data.schemaVersion + ').');
    // Version 1 = version actuelle : rien à migrer. Les futures migrations s'ajouteront ici.
    data.tournament.settings = Object.assign(defaultSettings(), data.tournament.settings || {});
    data.counters = data.counters || { player: 0, match: 0, round: 0 };
    return data;
  }

  function validateState(data) {
    const errors = [];
    try { migrate(data); } catch (e) { return { ok: false, errors: [e.message] }; }
    if (!data.tournament || !data.tournament.id) errors.push('Tournoi sans identifiant.');
    if (!Array.isArray(data.players)) errors.push('Liste des joueurs absente.');
    if (!Array.isArray(data.matches)) errors.push('Liste des matchs absente.');
    if (!Array.isArray(data.rounds)) errors.push('Liste des rondes absente.');
    if (!Array.isArray(data.divisions)) errors.push('Liste des divisions absente.');
    if (errors.length) return { ok: false, errors };
    const pids = new Set();
    data.players.forEach(p => { if (!p.id || pids.has(p.id)) errors.push('Identifiant de joueur invalide ou dupliqué : ' + p.id); pids.add(p.id); });
    const mids = new Set();
    data.matches.forEach(m => {
      if (!m.id || mids.has(m.id)) errors.push('Identifiant de match invalide ou dupliqué : ' + m.id);
      mids.add(m.id);
      ['playerAId', 'playerBId'].forEach(k => { if (m[k] && !pids.has(m[k])) errors.push('Match ' + m.id + ' : joueur inconnu ' + m[k]); });
    });
    data.matches.forEach(m => {
      ['sourceA', 'sourceB'].forEach(k => { if (m[k] && !mids.has(m[k].matchId)) errors.push('Match ' + m.id + ' : source inconnue.'); });
    });
    return { ok: errors.length === 0, errors };
  }

  function serialize(state) { return JSON.stringify(state); }

  function deserialize(text) {
    const data = JSON.parse(text);
    const v = validateState(data);
    if (!v.ok) throw new Error(v.errors.slice(0, 5).join(' '));
    refresh(data);
    return data;
  }

  /* ------------------------------------------------------------------ *
   * Exports CSV
   * ------------------------------------------------------------------ */
  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }

  function standingsCSV(state) {
    const fs = finalStandings(state);
    const stats = new Map(playerStats(state).map(s => [s.playerId, s]));
    const swiss = swissStandings(state);
    const header = ['Place finale', 'Joueur', 'Division', 'Rang brassage', 'Matchs', 'Victoires', 'Défaites', 'Nuls', 'Exemptions', 'Points marqués', 'Points encaissés', 'Différence', 'Forfait général'];
    const pm = playerMap(state);
    const base = state.divisions.length ? fs.rows : swiss.map(s => ({ playerId: s.playerId, rank: null, divisionName: '', swissRank: s.rank }));
    const rows = base.map(r => {
      const s = stats.get(r.playerId);
      return [r.rank == null ? '' : r.rank, pm.get(r.playerId).name, r.divisionName || '', r.swissRank || '', s.played, s.wins, s.losses, s.draws, s.byes, s.pf, s.pa, s.pf - s.pa, pm.get(r.playerId).withdrawn ? 'oui' : ''];
    });
    return toCSV([header].concat(rows));
  }

  function resultsCSV(state) {
    const pm = playerMap(state);
    const name = id => (id && pm.get(id) ? pm.get(id).name : '');
    const header = ['Phase', 'Ronde / Division', 'Match', 'Places en jeu', 'Joueur A', 'Joueur B', 'Score A', 'Score B', 'Vainqueur', 'Type', 'Terrain', 'État'];
    const rows = state.matches.map(m => {
      const round = state.rounds.find(r => r.id === m.roundId);
      const div = state.divisions.find(d => d.id === m.divisionId);
      const r = m.result || {};
      return [
        m.phase === 'swiss' ? 'Brassage' : 'Tableau',
        m.phase === 'swiss' ? 'Ronde ' + (round ? round.number : '') : 'Division ' + (div ? div.name : ''),
        m.label || m.number,
        m.targetRanks ? m.targetRanks[0] + '-' + m.targetRanks[1] : '',
        name(m.playerAId), m.isBye ? '(exemption)' : name(m.playerBId),
        r.scoreA != null ? r.scoreA : '', r.scoreB != null ? r.scoreB : '',
        r.draw ? 'nul' : name(r.winnerId), r.type || '', m.courtId ? 'Terrain ' + courtNumber(m.courtId) : '', m.status
      ];
    });
    return toCSV([header].concat(rows));
  }

  return {
    SCHEMA_VERSION, SPORTS, CRITERIA, POOL_SIZES, BRACKET_SIZES,
    // utilitaires
    hashString, rngFor, shuffle, isPowerOfTwo, nameKey, normalizeName, divisionLetter, randomSeed, clone,
    // configuration
    createTournament, analyzeNames, parseCSVNames, setPlayers, updateSettings, updateInfo, renamePlayer,
    startTournament, resetMatches, addLatePlayer, setWithdrawn,
    // brassage
    swissStandings, computeSwissPairings, generateNextSwissRound, canGenerateNextRound, swissRoundsComplete,
    minCostPerfectMatching, roundMatches,
    // divisions / tableaux
    divisionFormat, matchesPerPlayer, matchesInDivision, validatePartition, describePartition, proposePartitions,
    seedOrder, canFreezeDivisions, freezeDivisions, reopenSwiss, seedingOrder, poolRanking,
    // résultats
    validateScore, setResult, clearResult, analyzeImpact, describeImpact, refresh, matchName, findMatch,
    // terrains
    courtIds, courtNumber, readyQueue, freeCourtIds, autoAssignCourts, assignCourt, unassignCourt, busyPlayerIds,
    // classements
    finalStandings, checkFinalRanking, playerStats, estimateSchedule,
    // persistance / exports
    migrate, validateState, serialize, deserialize, standingsCSV, resultsCSV, toCSV
  };
});
