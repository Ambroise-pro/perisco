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
      tiebreak: TIEBREAKS[opts.tiebreak] ? opts.tiebreak : 'h2h-diff-pf',
      k: c.k != null ? c.k : 32,
      courts: Math.max(1, c.courts || 1), closedCourts: [],
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
    ensureQrToken(s);
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
  /*
   * Terrains de la séance. Le nombre de terrains de la classe sert de valeur par défaut à la
   * création ; pendant la séance, l'enseignant peut en ajouter, en retirer ou fermer un terrain
   * précis (s.closedCourts) sans toucher au réglage de la classe ni aux séances passées.
   */
  function totalCourts(c, s) {
    return Math.max(1, (s && s.courts) || c.courts || 1);
  }

  function availableCourts(c, s) {
    const closed = new Set((s && s.closedCourts) || []);
    const out = [];
    for (let t = 1; t <= totalCourts(c, s); t++) if (!closed.has(t)) out.push(t);
    return out;
  }

  function autoAssign(c, s) {
    if (s.status !== 'playing') return [];
    const avail = availableCourts(c, s);
    const open = new Set(avail);
    const busyCourts = new Set(), busy = new Set();
    s.matches.forEach(m => {
      if (m.court && !m.done) {
        // Terrain retiré ou fermé : le match retourne en file d'attente.
        if (!open.has(m.court)) { m.court = null; return; }
        busyCourts.add(m.court); busy.add(m.a); busy.add(m.b);
      }
    });
    const assigned = [];
    const queue = s.matches.map((m, i) => ({ m, i }))
      .filter(x => !x.m.done && !x.m.court && x.m.a && x.m.b)
      .sort((x, y) => (x.m.round - y.m.round) || (x.i - y.i));
    for (const { m } of queue) {
      if (busyCourts.size >= avail.length) break;
      if (busy.has(m.a) || busy.has(m.b)) continue;
      let court = m.pref && open.has(m.pref) && !busyCourts.has(m.pref) ? m.pref : null;
      if (!court) court = avail.find(t => !busyCourts.has(t)) || null;
      if (!court) break;
      m.court = court;
      busyCourts.add(court); busy.add(m.a); busy.add(m.b);
      assigned.push(m.id);
    }
    return assigned;
  }

  function courtChange(c, s, mutate, opts) {
    if (s.status === 'closed') return fail('Séance clôturée.');
    const sim = clone(s);
    mutate(sim);
    const open = new Set(availableCourts(c, sim));
    if (!open.size) return fail('Il faut garder au moins un terrain disponible.');
    const displaced = s.matches.filter(m => m.court && !m.done && !open.has(m.court));
    if (displaced.length && !(opts && opts.confirm)) {
      return fail(displaced.length + ' match(s) en cours sur un terrain retiré (' + displaced.map(m => 'terrain ' + m.court).join(', ') +
        ') : ' + (displaced.length > 1 ? 'ils retourneront' : 'il retournera') + ' en file d\'attente, score non saisi.', { needsConfirm: true, displaced: displaced.map(m => m.id) });
    }
    mutate(s);
    const assigned = autoAssign(c, s);
    return { ok: true, assigned, displaced: displaced.map(m => m.id) };
  }

  /** Change le nombre de terrains de la séance (1 à 30). */
  function setSessionCourts(c, s, n, opts) {
    n = Math.floor(Number(n));
    if (!(n >= 1 && n <= 30)) return fail('Nombre de terrains entre 1 et 30.');
    return courtChange(c, s, x => {
      x.courts = n;
      x.closedCourts = (x.closedCourts || []).filter(t => t <= n);
    }, opts);
  }

  /** Ferme (indisponible) ou rouvre un terrain précis pendant la séance. */
  function setCourtClosed(c, s, t, closed, opts) {
    t = Math.floor(Number(t));
    if (!(t >= 1 && t <= totalCourts(c, s))) return fail('Terrain inexistant.');
    return courtChange(c, s, x => {
      const set = new Set(x.closedCourts || []);
      if (closed) set.add(t); else set.delete(t);
      x.closedCourts = Array.from(set).sort((a, b2) => a - b2);
    }, opts);
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
  /*
   * Départages configurables des groupes (poules, montante-descendante, poules de reclassement).
   * Toujours : victoires d'abord. Puis, dans l'ordre choisi :
   *   h2h  = confrontation directe : victoires dans les matchs entre les seuls ex aequo
   *          (mini-classement si 3 ex aequo ou plus) ;
   *   diff = différence de points ; pf = points marqués.
   * Chaque critère n'est appliqué qu'aux élèves encore à égalité ; en dernier recours, l'ordre de
   * départ du groupe (placement validé) départage de façon stable.
   * Les anciennes séances (sans réglage) gardent le départage de la V1 : différence puis points.
   */
  const TIEBREAKS = {
    'h2h-diff-pf': { label: 'Confrontation directe, puis différence, puis points marqués', order: ['h2h', 'diff', 'pf'] },
    'diff-pf-h2h': { label: 'Différence, puis points marqués, puis confrontation directe', order: ['diff', 'pf', 'h2h'] },
    'diff-pf': { label: 'Différence, puis points marqués', order: ['diff', 'pf'] }
  };
  const CRIT_LABEL = { wins: 'victoires', h2h: 'confrontation directe', diff: 'différence de points', pf: 'points marqués', pos: 'ordre de départ' };

  function tiebreakOrder(s) {
    return (TIEBREAKS[s.tiebreak] || TIEBREAKS['diff-pf']).order;
  }

  function rankGroup(s, ids, filter) {
    const ms = s.matches.filter(m => m.done && ids.includes(m.a) && ids.includes(m.b) && (!filter || filter(m)));
    const st = new Map(ids.map((id, i) => [id, { id, pos: i, played: 0, wins: 0, losses: 0, pf: 0, pa: 0, decidedBy: null }]));
    ms.forEach(m => {
      const w = winnerOf(m), l = loserOf(m);
      if (!w) return;
      st.get(m.a).played++; st.get(m.b).played++;
      st.get(w).wins++; st.get(l).losses++;
      if (!m.forfeit) { st.get(m.a).pf += m.sa; st.get(m.a).pa += m.sb; st.get(m.b).pf += m.sb; st.get(m.b).pa += m.sa; }
    });
    const key = (crit, x, group) => {
      if (crit === 'wins') return x.wins;
      if (crit === 'diff') return x.pf - x.pa;
      if (crit === 'pf') return x.pf;
      if (crit === 'h2h') {
        const set = new Set(group.map(g => g.id));
        return ms.filter(m => set.has(m.a) && set.has(m.b) && winnerOf(m) === x.id).length;
      }
      return -x.pos;
    };
    // decidedBy = critère qui sépare un élève de celui classé juste devant lui.
    const out = [];
    (function split(group, crits) {
      if (group.length === 1) { out.push(group[0]); return; }
      if (!crits.length) {
        group.sort((a, b) => a.pos - b.pos).forEach((x, i) => { if (i > 0) x.decidedBy = 'pos'; out.push(x); });
        return;
      }
      const c = crits[0];
      const buckets = new Map();
      group.forEach(x => { const k = key(c, x, group); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(x); });
      Array.from(buckets.keys()).sort((a, b) => b - a).forEach((k, idx) => {
        const start = out.length;
        split(buckets.get(k), crits.slice(1));
        if (idx > 0) out[start].decidedBy = c;
      });
    })(Array.from(st.values()), ['wins'].concat(tiebreakOrder(s)));
    out.forEach((x, i) => { x.rank = i + 1; x.diff = x.pf - x.pa; x.decidedLabel = CRIT_LABEL[x.decidedBy] || ''; });
    return out;
  }

  function groupRanking(s, group, round) {
    return rankGroup(s, group, m => m.round === round).map(x => x.id);
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
        const sub = rankGroup(s, d.ids, m => m.division === d.name);
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
   * Groupes de travail (hors séance) : répartition des présents sur N terrains
   * ------------------------------------------------------------------ *
   * À partir du classement Elo (meilleur en premier) :
   *  - 'balanced' (équilibrés) : distribution en serpentin — T1, T2, …, Tn puis Tn, …, T1 — pour
   *    que chaque terrain ait un niveau moyen proche ;
   *  - 'level' (par niveau) : blocs consécutifs — les meilleurs au terrain 1.
   * Les effectifs par terrain diffèrent au plus d'un élève. N'affecte jamais l'Elo.
   */
  function makeWorkGroups(rankedIds, courts, mode) {
    const n = rankedIds.length;
    const k = Math.max(1, Math.min(Math.floor(courts) || 1, n || 1));
    if (mode === 'level') return balancedGroups(rankedIds, k);
    const groups = Array.from({ length: k }, () => []);
    rankedIds.forEach((id, i) => {
      const pass = Math.floor(i / k), pos = i % k;
      groups[pass % 2 === 0 ? pos : k - 1 - pos].push(id);
    });
    return groups.filter(g => g.length);
  }

  /** Crée ou recalcule les groupes de travail de la classe (c.workGroups). */
  function buildWorkGroups(c, opts) {
    opts = opts || {};
    const prev = c.workGroups || {};
    const courts = clampInt(opts.courts != null ? opts.courts : prev.courts, 1, 30, c.courts || 4);
    const mode = (opts.mode || prev.mode) === 'level' ? 'level' : 'balanced';
    const absent = (opts.absent || prev.absent || []).filter(id => c.students.some(p => p.id === id));
    const ranked = ranks(c).filter(p => !absent.includes(p.id)).map(p => p.id);
    if (!ranked.length) return fail('Aucun élève présent.');
    c.workGroups = { courts, mode, absent, groups: makeWorkGroups(ranked, courts, mode), createdAt: Date.now() };
    return { ok: true };
  }

  function moveWorkGroup(c, id, to) {
    const wg = c.workGroups;
    if (!wg) return fail('Aucun groupe de travail.');
    const from = wg.groups.findIndex(g => g.includes(id));
    if (from < 0 || to < 0 || to >= wg.groups.length) return fail('Déplacement impossible.');
    if (from === to) return { ok: true };
    wg.groups[from] = wg.groups[from].filter(x => x !== id);
    wg.groups[to].push(id);
    return { ok: true };
  }

  /** Statistiques par groupe : effectif, Elo moyen ; écart entre la moyenne la plus haute et la plus basse. */
  function workGroupStats(c) {
    const wg = c.workGroups;
    if (!wg) return null;
    const st = computeStats(c);
    const groups = wg.groups.map(g => ({ size: g.length, avg: g.length ? g.reduce((a, id) => a + (st[id] ? st[id].elo : 0), 0) / g.length : 0 }));
    const avgs = groups.filter(g => g.size).map(g => g.avg);
    return { groups, spread: avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0 };
  }

  /* ------------------------------------------------------------------ *
   * QR codes : aller-retour hors ligne entre tablettes élèves et appareil enseignant
   * ------------------------------------------------------------------ *
   * Les données restent sur l'appareil de l'enseignant (aucun serveur). Le QR d'un match ouvre
   * sur la tablette une « feuille de match » autonome (noms, terrain, score cible) ; en fin de
   * match, la tablette affiche un code de résultat (QR + texte court) que l'enseignant scanne.
   * Code : RE1.<séance>.<match>.<x>.<y>.<contrôle>, avec x.y = score A.B, ou F.a / F.b (forfait
   * du joueur A ou B). Le contrôle est une empreinte calculée avec un jeton propre à la séance :
   * il détecte les erreurs de saisie et les codes d'une autre séance (ce n'est pas un chiffrement).
   */
  function shortHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    // Base 32 de Crockford (sans I, L, O, U) : lisible et dictable sans confusion.
    const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let n = h >>> 0, out = '';
    for (let i = 0; i < 7; i++) { out = A[n % 32] + out; n = Math.floor(n / 32); }
    return out;
  }
  const shortId = id => shortHash('id:' + id).slice(0, 6);

  function ensureQrToken(s) {
    if (!s.qrToken) s.qrToken = shortHash(uid() + ':' + Math.random()).slice(0, 6);
    return s.qrToken;
  }

  function utf8ToB64url(str) {
    let b64;
    if (typeof btoa === 'function') b64 = btoa(unescape(encodeURIComponent(str)));
    else b64 = Buffer.from(str, 'utf8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToUtf8(b) {
    const b64 = b.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b.length + 3) % 4);
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(b64)));
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  /** Données de la feuille de match (affichée sur la tablette, sans accès à la base). */
  function sheetData(c, s, m) {
    const nm = id => (c.students.find(p => p.id === id) || {}).name || '?';
    return { v: 1, s: shortId(s.id), m: shortId(m.id), a: nm(m.a), b: nm(m.b), t: m.court || null, g: s.target || 11, k: ensureQrToken(s), n: s.seq };
  }
  function encodeSheet(d) { return utf8ToB64url(JSON.stringify(d)); }
  function decodeSheet(str) {
    const d = JSON.parse(b64urlToUtf8(String(str || '')));
    if (!d || d.v !== 1 || !d.s || !d.m || !d.k || !d.a || !d.b) throw new Error('Feuille de match illisible.');
    return d;
  }

  /** Code de résultat produit par la tablette. r = { sa, sb } ou { forfeit: 'a' | 'b' }. */
  function resultCode(d, r) {
    let x, y;
    if (r.forfeit) { x = 'F'; y = r.forfeit === 'a' ? 'a' : 'b'; }
    else {
      const err = validateScore(r.sa, r.sb);
      if (err) throw new Error(err);
      x = String(Number(r.sa)); y = String(Number(r.sb));
    }
    return ['RE1', d.s, d.m, x, y, shortHash([d.k, d.s, d.m, x, y].join('|'))].join('.');
  }

  function parseResultCode(text) {
    // Tolère minuscules, espaces et confusions courantes (O→0, I/L→1).
    const t = String(text || '').trim().replace(/\s+/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
    const parts = t.split('.');
    if (parts.length !== 6 || parts[0] !== 'RE1') return { ok: false, error: 'Ce n\'est pas un code de résultat Racket EPS.' };
    const [, sid, mid, x, y, h] = parts;
    const forfeit = x.toUpperCase() === 'F';
    if (forfeit && !/^[AB]$/.test(y)) return { ok: false, error: 'Code de forfait invalide.' };
    if (!forfeit && (!/^\d{1,3}$/.test(x) || !/^\d{1,3}$/.test(y))) return { ok: false, error: 'Score illisible dans le code.' };
    return { ok: true, sid, mid, x: forfeit ? 'F' : x, y: forfeit ? y.toLowerCase() : y, h, forfeit };
  }

  /**
   * Enregistre un résultat scanné dans la séance active. Vérifie la séance, le match et le code
   * de contrôle. Un match déjà saisi avec le même résultat est signalé sans rien modifier ; avec
   * un résultat différent, une confirmation est demandée (opts.confirm).
   */
  function applyResultCode(c, s, text, opts) {
    opts = opts || {};
    const p = parseResultCode(text);
    if (!p.ok) return fail(p.error);
    if (!s || s.status !== 'playing') return fail('Aucune séance en cours.');
    if (shortId(s.id) !== p.sid) return fail('Ce code provient d\'une autre séance.');
    const ms = s.matches.filter(m => shortId(m.id) === p.mid);
    if (ms.length !== 1) return fail(ms.length ? 'Code ambigu : saisissez ce résultat à la main.' : 'Match introuvable dans cette séance.');
    const m = ms[0];
    if (!s.qrToken || shortHash([s.qrToken, p.sid, p.mid, p.x, p.y].join('|')) !== p.h) return fail('Code de contrôle incorrect : code mal recopié ou modifié.');
    if (!m.a || !m.b) return fail('Les joueurs de ce match ne sont pas encore connus.');
    const input = p.forfeit ? { forfeit: p.y === 'a' ? m.a : m.b } : { sa: Number(p.x), sb: Number(p.y) };
    const same = m.done && (input.forfeit ? m.forfeit === input.forfeit : (!m.forfeit && m.sa === input.sa && m.sb === input.sb));
    if (same) return { ok: true, already: true, match: m, input };
    if (m.done && !opts.confirm) return fail('Ce match a déjà un résultat différent (' + (m.forfeit ? 'forfait' : m.sa + ' – ' + m.sb) + ') : le remplacer ?', { needsConfirm: true, match: m, input });
    const r = recordResult(c, s, m.id, input, opts);
    return Object.assign({}, r, { match: m, input });
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

  /* ------------------------------------------------------------------ *
   * Classe exemple (données FICTIVES, pour tester l'application)
   * ------------------------------------------------------------------ *
   * Élèves nommés par des pseudonymes d'animaux (aucun nom réel). Les séances simulées passent par
   * le vrai moteur (appel, placement, matchs, terrains, clôture) : seuls les scores sont tirés au
   * hasard, de façon reproductible (graine), selon un « niveau » caché pour que l'Elo se différencie.
   * La classe porte demo: true et l'interface l'indique partout.
   */
  const DEMO_NAMES = ['Albatros', 'Bison', 'Castor', 'Dauphin', 'Écureuil', 'Faucon', 'Gazelle', 'Hérisson', 'Ibis', 'Jaguar',
    'Koala', 'Lynx', 'Marmotte', 'Narval', 'Ocelot', 'Panda', 'Quokka', 'Renard', 'Suricate', 'Tapir', 'Urubu', 'Vison',
    'Wapiti', 'Xérus', 'Yack', 'Zèbre', 'Alpaga', 'Blaireau', 'Caribou', 'Dingo', 'Émeu', 'Fennec', 'Gorille', 'Hibou',
    'Impala', 'Jabiru', 'Kiwi', 'Loutre', 'Manchot', 'Mouflon'];
  const DEMO_FORMATS = [
    { mode: 'pools', groupSize: 4 },
    { mode: 'swiss', rounds: 3 },
    { mode: 'ladder', ladderType: 'group', groupSize: 4, move: 1, rounds: 3 },
    { mode: 'reclass', groupSize: 4 },
    { mode: 'ladder', ladderType: 'single', rounds: 4 },
    { mode: 'challenge', gap: 3 }
  ];

  function demoRng(seed) {
    let h = 2166136261;
    String(seed).split('').forEach(ch => { h = Math.imul(h ^ ch.charCodeAt(0), 16777619); });
    let a = h >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createDemoClass(opts) {
    opts = opts || {};
    const n = clampInt(opts.students, 4, 40, 24);
    const nSessions = clampInt(opts.sessions, 0, 12, 3);
    const courts = clampInt(opts.courts, 1, 30, 6);
    const rand = demoRng(opts.seed || 'classe-exemple');
    const today = opts.today ? new Date(opts.today) : new Date();
    const c = { id: uid(), name: opts.name || 'Classe exemple (fictive)', sport: 'Badminton', courts, k: 32, initialElo: 1000, students: [], sessions: [], demo: true };
    addStudents(c, DEMO_NAMES.slice(0, n).map((x, i) => (i < DEMO_NAMES.length ? x : 'Élève ' + (i + 1))));
    const level = {};
    c.students.forEach(p => { level[p.id] = rand(); });
    const play = (s, m) => {
      // Le plus « fort » gagne plus souvent (probabilité logistique), score sur 11.
      const pA = 1 / (1 + Math.exp(-(level[m.a] - level[m.b]) * 6));
      const aWins = rand() < pA, lo = Math.floor(rand() * 10);
      return recordResult(c, s, m.id, aWins ? { sa: 11, sb: lo } : { sa: lo, sb: 11 }, { confirm: true });
    };
    for (let k = 0; k < nSessions; k++) {
      const f = DEMO_FORMATS[k % DEMO_FORMATS.length];
      const date = new Date(today.getTime() - (nSessions - k) * 7 * 864e5).toISOString().slice(0, 10);
      const s = createSession(c, Object.assign({ date }, f)).session;
      // 0 à 2 absents tirés au hasard (jamais au point de passer sous 4 présents)
      const abs = Math.min(Math.floor(rand() * 3), Math.max(0, n - 4));
      for (let a = 0; a < abs; a++) {
        const present = s.positions;
        setAbsent(c, s, present[Math.floor(rand() * present.length)], true);
      }
      startSession(c, s);
      for (let guard = 0; guard < 2000; guard++) {
        const m = s.matches.find(x => x.court && !x.done) || s.matches.find(x => !x.done && x.a && x.b);
        if (m) { play(s, m); continue; }
        if (canNextRound(s).ok) { nextRound(c, s); continue; }
        if (s.mode === 'reclass' && canBuildClassement(s).ok) { buildClassement(c, s, proposePartitions(s.positions.length)[0].sizes); continue; }
        if (s.mode === 'challenge' && s.matches.length < s.positions.length) {
          const order = challengeOrder(s);
          const i = 1 + Math.floor(rand() * (order.length - 1));
          const j = Math.max(0, i - 1 - Math.floor(rand() * Math.min(s.gap, i)));
          if (!addChallenge(c, s, order[i], order[j]).ok) break;
          continue;
        }
        break;
      }
      closeSession(c, s);
    }
    return c;
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
    totalCourts, availableCourts, setSessionCourts, setCourtClosed,
    recordResult, clearResult, resolve, sessionStandings, minCostPerfectMatching,
    nextRound, canNextRound, groupRanking, rankGroup, TIEBREAKS, challengeOrder, addChallenge, removeMatch,
    divisionFormat, validatePartition, describePartition, proposePartitions, seedOrder, brassageRanking,
    canBuildClassement, buildClassement, reclassPlaces,
    canClose, closeSession, cancelSession, reopenSession,
    makeWorkGroups, buildWorkGroups, moveWorkGroup, workGroupStats,
    shortHash, shortId, ensureQrToken, sheetData, encodeSheet, decodeSheet, resultCode, parseResultCode, applyResultCode,
    emptyDB, migrate, validateDB, parseDB, addStudents, renameStudent, nameKey, createDemoClass, DEMO_NAMES
  };
});
