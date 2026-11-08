/*
 * Racket EPS — interface. Toute la logique métier est dans engine.js (RacketEngine).
 */
(function () {
  'use strict';
  const R = window.RacketEngine;
  const KEY = 'racket_eps_v1';          // clé conservée pour retrouver les données du prototype V1
  const KEY_BAK = 'racket_eps_v1_backup';
  const KEY_BAD = 'racket_eps_v1_illisible';

  let db = null;
  let tab = 'dashboard', selectedStudent = null, storageError = null, partitionKey = null;

  /* ---------------- Persistance ---------------- */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageError = 'Stockage local indisponible : les données ne seront pas conservées.'; }
    if (!raw) return R.emptyDB();
    try { return R.parseDB(raw); }
    catch (e) {
      try { localStorage.setItem(KEY_BAD, raw); } catch (e2) { /* ignore */ }
      try {
        const bak = localStorage.getItem(KEY_BAK);
        if (bak) { toast('Sauvegarde principale illisible : copie de secours restaurée.', true); return R.parseDB(bak); }
      } catch (e3) { /* ignore */ }
      storageError = 'Sauvegarde illisible (' + e.message + '). Elle est conservée sous « ' + KEY_BAD + ' » ; une base vide est utilisée.';
      return R.emptyDB();
    }
  }

  function save() {
    try {
      const prev = localStorage.getItem(KEY);
      if (prev) localStorage.setItem(KEY_BAK, prev);
      localStorage.setItem(KEY, JSON.stringify(db));
      storageError = null;
    } catch (e) {
      storageError = 'Sauvegarde impossible (' + (e && e.name === 'QuotaExceededError' ? 'espace plein' : e.message) + '). Exportez une sauvegarde JSON maintenant.';
    }
  }

  /* ---------------- Utilitaires ---------------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = n => Number(n).toFixed(1);
  const today = () => new Date().toISOString().slice(0, 10);
  const cl = () => db.classes.find(c => c.id === db.active) || null;
  const nameOf = (c, id) => (c.students.find(p => p.id === id) || {}).name || 'Élève supprimé';

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, isError ? 6000 : 2500);
  }

  /** Exécute une opération du moteur sur la classe active ; confirme les conséquences si besoin. */
  function act(fn, okMsg) {
    let res = fn({});
    if (res && !res.ok && res.needsConfirm) {
      if (!confirm(res.error + '\n\nConfirmer ?')) return res;
      res = fn({ confirm: true });
    }
    if (res && !res.ok) { toast(res.error, true); return res; }
    save(); render();
    if (okMsg) toast(okMsg);
    return res;
  }

  /* ---------------- Rendu ---------------- */
  const TABS = [['dashboard', 'Tableau de bord'], ['students', 'Élèves'], ['session', 'Séance'], ['ranking', 'Classement Elo'], ['history', 'Historique'], ['settings', 'Réglages']];

  function render() {
    const c = cl();
    $('classSelect').innerHTML = db.classes.map(x => `<option value="${esc(x.id)}" ${x.id === db.active ? 'selected' : ''}>${esc(x.name)}</option>`).join('') || '<option value="">Aucune classe</option>';
    $('nav').innerHTML = TABS.map(([id, t]) => `<button type="button" class="${tab === id ? 'active' : ''}" aria-current="${tab === id ? 'page' : 'false'}" data-action="tab" data-tab="${id}">${t}</button>`).join('');
    $('banner').innerHTML = storageError ? `<div class="notice warn" role="alert">${esc(storageError)} <button class="btn" data-action="export-json">Exporter</button></div>` : '';
    const views = { dashboard, students, session, ranking, history, settings };
    $('view').innerHTML = !c ? welcome() : (views[tab] || dashboard)(c);
  }

  function welcome() {
    return `<section class="panel"><h2>Bienvenue dans Racket EPS</h2><p>Créez une classe pour organiser vos séances, faire l'appel et suivre les classements Elo.</p><button class="btn primary" data-action="add-class">Créer ma première classe</button></section>`;
  }

  function rankingTable(r, opts) {
    opts = opts || {};
    return `<div class="tablewrap"><table><thead><tr><th>Rang</th><th>Élève</th><th>Elo</th><th>Variation</th><th>Matchs</th><th>V</th><th>D</th><th>%</th><th>Diff. points</th></tr></thead><tbody>${
      r.map((p, i) => `<tr><td>${i + 1}</td><td><button class="btn linkish" data-action="student" data-id="${p.id}">${esc(p.name)}</button></td><td><b>${fmt(p.elo)}</b></td>
        <td class="${p.lastDelta >= 0 ? 'good' : 'bad'}">${p.history.length ? (p.lastDelta >= 0 ? '+' : '') + fmt(p.lastDelta) : '—'}</td>
        <td>${p.played}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.played ? fmt(p.wins / p.played * 100) + ' %' : '—'}</td><td>${p.for - p.against}</td></tr>`).join('')
    }</tbody></table></div>${opts.note ? `<p class="muted small">${opts.note}</p>` : ''}`;
  }

  function dashboard(c) {
    const r = R.ranks(c), s = R.activeSession(c), closed = c.sessions.filter(x => x.status === 'closed').length;
    const status = s ? (s.status === 'setup' ? 'Appel et terrains à valider' : (s.reopened ? 'Séance rouverte pour correction' : 'Matchs en cours')) : '';
    return `<div class="grid"><div class="stat"><b>${c.students.length}</b><small>Élèves inscrits</small></div><div class="stat"><b>${closed}</b><small>Séances clôturées</small></div><div class="stat"><b>${c.courts}</b><small>Terrains</small></div><div class="stat"><b>${c.sessions.reduce((n, x) => n + x.matches.filter(m => m.done).length, 0)}</b><small>Matchs enregistrés</small></div></div>
      <section class="panel" style="margin-top:16px"><h2>${s ? 'Séance en cours' : 'Prochaine séance'}</h2><p class="muted">${s ? `Séance ${s.seq} · ${R.MODES[s.mode]} · ${status}` : 'Préparez une séance, faites l\'appel puis validez les terrains avant de lancer les matchs.'}</p>
      <button class="btn primary" data-action="tab" data-tab="session">${s ? 'Reprendre la séance' : 'Préparer une séance'}</button></section>
      <section class="panel"><h2>Top 10 · Classement Elo</h2>${rankingTable(r.slice(0, 10))}</section>`;
  }

  function students(c) {
    const st = R.computeStats(c);
    return `<section class="panel"><h2>Gestion des élèves</h2>
      <div class="row"><div class="field"><label for="newStudent">Ajouter un élève</label><input id="newStudent" placeholder="Prénom N." autocomplete="off"></div><button class="btn primary" data-action="add-student">Ajouter</button></div>
      <div class="field"><label for="bulk">Importer une liste (un élève par ligne)</label><textarea id="bulk" placeholder="Prénom N.&#10;Prénom N.&#10;…"></textarea></div>
      <button class="btn" data-action="bulk-students">Importer les noms</button>
      <p class="muted small">Les doublons (majuscules et accents ignorés) sont refusés. Les noms restent dans ce navigateur : évitez les données nominatives sur un appareil partagé.</p></section>
      <section class="panel"><h2>Liste (${c.students.length})</h2>${
        c.students.map((p, i) => `<div class="row between listrow"><span>${i + 1}. ${esc(p.name)} <span class="muted small">· Elo ${fmt(st[p.id].elo)} · ${st[p.id].absences} absence(s)</span></span><button class="btn" data-action="rename" data-id="${p.id}">Renommer</button></div>`).join('') || '<div class="empty">Aucun élève</div>'
      }</section>`;
  }

  /* ---------------- Séance ---------------- */
  function session(c) {
    const s = R.activeSession(c);
    if (!s) return newSessionUI(c);
    if (s.status === 'setup') return setupUI(c, s);
    return playingUI(c, s);
  }

  function modeFieldsHTML(mode) {
    const group = ['pools', 'reclass', 'ladder'].includes(mode);
    return `<div class="row">
      <div class="field"><label for="target">Score cible (indicatif)</label><input id="target" type="number" min="1" max="99" value="11"></div>
      ${mode === 'swiss' || mode === 'ladder' ? `<div class="field"><label for="rounds">${mode === 'ladder' ? 'Nombre de rotations' : 'Nombre de rondes'}</label><input id="rounds" type="number" min="1" max="30" value="4"></div>` : ''}
      ${group ? `<div class="field"><label for="groupSize">${mode === 'reclass' ? 'Taille des poules de brassage' : 'Élèves par groupe (souhaité)'}</label><select id="groupSize">${[3, 4, 5, 6].map(n => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
      ${mode === 'ladder' ? `<div class="field"><label for="ladderType">Variante</label><select id="ladderType"><option value="single">Individuelle (2 par terrain)</option><option value="group" selected>Par groupes (mini-poules)</option></select></div>
        <div class="field"><label for="move">Montées / descentes par rotation (groupes)</label><select id="move"><option>1</option><option>2</option></select></div>` : ''}
      ${mode === 'challenge' ? `<div class="field"><label for="challengeGap">Écart maximal de rang</label><input id="challengeGap" type="number" min="1" value="3"></div>
        <div class="field"><label for="permutation">Si le défiant gagne</label><select id="permutation"><option value="swap">Il prend la place du défié</option><option value="none">Pas de permutation</option></select></div>` : ''}
      ${mode === 'pools' ? `<div class="field"><label for="legs">Matchs</label><select id="legs"><option value="1">Aller simple</option><option value="2">Aller-retour</option></select></div>` : ''}
    </div>`;
  }

  function newSessionUI(c) {
    return `<section class="panel"><h2>Nouvelle séance</h2>
      <div class="row"><div class="field"><label for="sdate">Date</label><input type="date" id="sdate" value="${today()}"></div>
      <div class="field"><label for="smode">Format de tournoi</label><select id="smode">${Object.entries(R.MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
      <div id="modeOptions">${modeFieldsHTML('pools')}</div>
      <button class="btn primary" data-action="create-session">Créer la séance et faire l'appel</button>
      <p class="muted small">Chaque match validé compte pour l'Elo, mais les Elo ne changent qu'à la clôture de la séance.</p></section>`;
  }

  function setupUI(c, s) {
    const ranked = R.ranks(c);
    const warnings = R.placementWarnings(s);
    let placement;
    if (s.groups) {
      placement = `<p class="muted small">Proposition automatique dans l'ordre Elo (terrain/groupe 1 = meilleurs Elo). Ce placement est exactement celui qui servira à générer les matchs. Les déplacements ne modifient pas l'Elo.</p>
        <div class="grid">${s.groups.map((g, i) => `<div class="court"><h3>${s.mode === 'ladder' ? 'Terrain' : 'Groupe'} ${i + 1}${i + 1 > c.courts ? ' <span class="badge">partage un terrain</span>' : ''}</h3>${
          g.map(id => `<div class="player"><span>${esc(nameOf(c, id))}</span><label class="sr-only" for="mv_${id}">Groupe de ${esc(nameOf(c, id))}</label><select id="mv_${id}" data-action="move-group" data-id="${id}">${
            s.groups.map((_, j) => `<option value="${j}" ${j === i ? 'selected' : ''}>${s.mode === 'ladder' ? 'T' : 'G'}${j + 1}</option>`).join('')}<option value="${s.groups.length}">Nouveau</option></select></div>`).join('')}</div>`).join('')}</div>`;
    } else {
      placement = `<p class="muted small">Ordre de départ proposé selon l'Elo (rang local). Utilisez ↑ ↓ pour l'ajuster ; l'Elo n'est pas modifié.</p>
        <ol class="order">${s.positions.map((id, i) => `<li class="player"><span>${i + 1}. ${esc(nameOf(c, id))}</span><span><button class="btn mini" data-action="shift" data-id="${id}" data-dir="-1" aria-label="Monter ${esc(nameOf(c, id))}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn mini" data-action="shift" data-id="${id}" data-dir="1" aria-label="Descendre ${esc(nameOf(c, id))}" ${i === s.positions.length - 1 ? 'disabled' : ''}>↓</button></span></li>`).join('')}</ol>`;
    }
    return `<section class="panel"><div class="row between"><h2>Séance ${s.seq} · Appel et terrains</h2><span class="badge">Validation obligatoire</span></div>
      <p class="muted">${esc(s.date)} · ${R.MODES[s.mode]} · ${s.positions.length} présents / ${c.students.length} · ${c.courts} terrain(s)</p>
      <h3>Appel</h3><div class="grid">${ranked.map(p => `<label class="player"><span>${esc(p.name)} · Elo ${fmt(p.elo)}</span><span><input type="checkbox" style="width:auto" data-action="absent" data-id="${p.id}" ${s.absent.includes(p.id) ? 'checked' : ''}> Absent</span></label>`).join('')}</div>
      <h3 style="margin-top:20px">Placement</h3>${placement}
      ${warnings.length ? `<div class="notice warn">${warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="actions" style="margin-top:18px"><button class="btn primary" data-action="start-session" ${s.positions.length < 2 ? 'disabled' : ''}>✓ Valider les terrains et générer les matchs</button>
      <button class="btn" data-action="repropose">Reproposer selon l'Elo</button>
      <button class="btn danger" data-action="cancel-session">Annuler la séance</button></div></section>`;
  }

  function matchLabel(c, s, m) {
    if (m.phase === 'classement') return `Division ${m.division}${m.number ? ' · M' + m.number : ''} · places ${m.places[0]}-${m.places[1]}`;
    if (s.mode === 'pools' || m.phase === 'brassage') return `Groupe ${m.group + 1} · tour ${m.round}`;
    if (s.mode === 'ladder') return `Rotation ${m.round} · terrain ${m.group + 1}`;
    if (s.mode === 'swiss') return `Ronde ${m.round}`;
    return `Défi ${m.seq || ''}`;
  }

  function sourceText(s, m, side) {
    const src = m['source' + side];
    if (!src) return '?';
    const sm = s.matches.find(x => x.id === src.matchId);
    return (src.take === 'winner' ? 'Vainqueur' : 'Perdant') + ' M' + (sm ? sm.number : '?');
  }

  function matchRow(c, s, m) {
    const st = R.matchState(m), w = R.winnerOf(m);
    const nameA = m.a ? esc(nameOf(c, m.a)) : `<i>${esc(sourceText(s, m, 'A'))}</i>`;
    const nameB = m.b ? esc(nameOf(c, m.b)) : `<i>${esc(sourceText(s, m, 'B'))}</i>`;
    const stateTxt = { done: m.forfeit ? '✓ forfait de ' + esc(nameOf(c, m.forfeit)) : '✓ enregistré', playing: '▶ en cours · terrain ' + m.court, waiting: 'en attente d\'un terrain', pending: 'en attente des matchs précédents' }[st];
    const ready = !!(m.a && m.b);
    return `<div class="match st-${st}">
      <div class="name ${w && w === m.a ? 'win' : ''}">${nameA}</div>
      <input type="number" min="0" inputmode="numeric" value="${m.sa == null ? '' : m.sa}" id="a_${m.id}" placeholder="0" aria-label="Score de ${m.a ? esc(nameOf(c, m.a)) : 'A'}" ${ready ? '' : 'disabled'}>
      <span>–</span>
      <input type="number" min="0" inputmode="numeric" value="${m.sb == null ? '' : m.sb}" id="b_${m.id}" placeholder="0" aria-label="Score de ${m.b ? esc(nameOf(c, m.b)) : 'B'}" ${ready ? '' : 'disabled'}>
      <div class="name ${w && w === m.b ? 'win' : ''}">${nameB}</div>
      <button class="btn ${m.done ? '' : 'primary'}" data-action="record" data-id="${m.id}" ${ready ? '' : 'disabled'}>${m.done ? 'Corriger' : 'Valider'}</button>
      <div class="muted small meta">${esc(matchLabel(c, s, m))} · ${stateTxt}${m.invalidated ? ' · <span class="bad">résultat invalidé par une correction en amont, à rejouer</span>' : ''}
        ${ready ? `<details class="more"><summary>Autres actions</summary><div class="actions">
          <button class="btn" data-action="forfeit" data-id="${m.id}" data-loser="${m.a}">Forfait de ${esc(nameOf(c, m.a))}</button>
          <button class="btn" data-action="forfeit" data-id="${m.id}" data-loser="${m.b}">Forfait de ${esc(nameOf(c, m.b))}</button>
          ${m.done ? `<button class="btn" data-action="clear" data-id="${m.id}">Effacer le résultat</button>` : ''}
          ${s.mode === 'challenge' && !m.done ? `<button class="btn danger" data-action="remove-match" data-id="${m.id}">Supprimer ce défi</button>` : ''}</div></details>` : ''}
      </div></div>`;
  }

  function courtsPanel(c, s) {
    const cards = [];
    for (let t = 1; t <= c.courts; t++) {
      const m = s.matches.find(x => x.court === t && !x.done);
      cards.push(`<div class="court"><h3>Terrain ${t}</h3>${m ? `<div class="player"><b>${esc(nameOf(c, m.a))}</b></div><div class="muted small" style="text-align:center">contre</div><div class="player"><b>${esc(nameOf(c, m.b))}</b></div>` : '<div class="muted">Libre</div>'}</div>`);
    }
    const waiting = s.matches.filter(m => R.matchState(m) === 'waiting').length;
    return `<section class="panel"><div class="row between"><h2>Terrains</h2><span class="muted small">${waiting} match(s) en file d'attente · un élève ne joue jamais deux matchs à la fois</span></div><div class="grid">${cards.join('')}</div></section>`;
  }

  function standingsPanel(c, s) {
    let title = 'Classement provisoire de la séance', body = '';
    if (s.mode === 'ladder') {
      const lastMoves = s.moves.filter(mv => mv.round === s.round);
      body = `<div class="grid">${s.groups.map((g, i) => `<div class="court"><h3>Terrain ${i + 1}</h3>${R.groupRanking(s, g, s.round).map(id => {
        const mv = lastMoves.find(x => x.id === id);
        return `<div class="player"><span>${esc(nameOf(c, id))}</span>${mv ? `<span class="badge">${mv.to < mv.from ? '↑ monte du T' + mv.from : '↓ descend du T' + mv.from}</span>` : ''}</div>`;
      }).join('')}</div>`).join('')}</div><p class="muted small">Terrain 1 : personne ne monte ; dernier terrain : personne ne descend. Ces positions ne modifient pas l'Elo.</p>`;
      title = 'Terrains de la rotation ' + s.round;
    } else if (s.mode === 'challenge') {
      const order = R.challengeOrder(s);
      body = `<ol>${order.map(id => `<li>${esc(nameOf(c, id))}</li>`).join('')}</ol><p class="muted small">Rang local rejoué à partir de l'ordre validé ${s.permutation === 'swap' ? '(le défiant vainqueur prend la place du défié)' : '(sans permutation)'}.</p>`;
      title = 'Rang local du jeu du défi';
    } else if (s.mode === 'reclass' && s.phase === 'classement') {
      const places = R.reclassPlaces(s);
      const rows = s.positions.slice().sort((a, b) => (places.get(a) || 999) - (places.get(b) || 999));
      body = `<div class="tablewrap"><table><thead><tr><th>Place</th><th>Élève</th><th>Division</th></tr></thead><tbody>${rows.map(id => `<tr><td>${places.get(id) || '—'}</td><td>${esc(nameOf(c, id))}</td><td>${(s.divisions.find(d => d.ids.includes(id)) || {}).name || ''}</td></tr>`).join('')}</tbody></table></div><p class="muted small">${places.size} / ${s.positions.length} places attribuées. Les places dépendent des tableaux, pas de l'Elo.</p>`;
      title = 'Places du tournoi (reclassement)';
    }
    if (!body) {
      const st = s.mode === 'reclass' ? R.brassageRanking(s) : R.sessionStandings(c, s);
      body = `<div class="tablewrap"><table><thead><tr><th>Rg</th><th>Élève</th><th>Pts</th><th>J</th><th>V</th><th>D</th>${s.mode === 'swiss' ? '<th>Exempt.</th>' : ''}<th>Diff</th></tr></thead><tbody>${
        st.map(x => `<tr><td>${x.rank}</td><td>${esc(nameOf(c, x.id))}</td><td><b>${x.points}</b></td><td>${x.played}</td><td>${x.wins}</td><td>${x.losses}</td>${s.mode === 'swiss' ? `<td>${x.byes}</td>` : ''}<td>${x.diff}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small">${s.mode === 'reclass' ? 'Brassage : taux de victoires, puis différence moyenne, points marqués moyens, position de départ.' : 'Points de tournoi (victoire = 1' + (s.mode === 'swiss' ? ', exemption = 1 sans Elo' : '') + '), puis différence, points marqués, position de départ.'} Ce classement est distinct de l'Elo.</p>`;
    }
    return `<section class="panel"><h2>${title}</h2>${body}</section>`;
  }

  function reclassChooser(c, s) {
    const n = s.positions.length;
    const props = R.proposePartitions(n);
    const key = partitionKey || (props[0] ? props[0].sizes.join('+') : '');
    return `<div class="notice"><b>Brassage terminé.</b> Choisissez les divisions de classement (les élèves y sont répartis selon le classement du brassage) :
      <div class="field"><label for="partition">Divisions</label><select id="partition" data-action="partition">${props.map(p => `<option value="${p.sizes.join('+')}" ${p.sizes.join('+') === key ? 'selected' : ''}>${p.sizes.join(' + ')} — ${p.total} matchs${p.recommended ? ' (recommandé)' : ''}</option>`).join('')}</select></div>
      ${(() => { const p = props.find(x => x.sizes.join('+') === key) || props[0]; return p ? `<div class="small">${p.divisions.map(d => `${d.name} : places ${d.start}-${d.end} (${d.format === 'pool' ? 'poule' : 'tableau intégral'}, ${d.mpp} match(s)/élève)`).join(' · ')}</div>${p.warnings.length ? `<div class="small muted">${p.warnings.map(esc).join('<br>')}</div>` : ''}` : ''; })()}
      <button class="btn primary" data-action="build-classement" style="margin-top:8px">Générer le reclassement</button></div>`;
  }

  function playingUI(c, s) {
    const total = s.matches.length, done = s.matches.filter(m => m.done).length;
    const canNext = R.canNextRound(s);
    const order = s.mode === 'challenge' ? R.challengeOrder(s) : [];
    const groups = new Map();
    s.matches.forEach(m => {
      const key = m.phase === 'classement' ? 'Division ' + m.division : (s.mode === 'pools' || m.phase === 'brassage' ? 'Groupe ' + (m.group + 1) : (s.mode === 'challenge' ? 'Défis' : (s.mode === 'ladder' ? 'Rotation ' : 'Ronde ') + m.round));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
    const entries = Array.from(groups.entries());
    if (['swiss', 'ladder'].includes(s.mode) || s.mode === 'reclass') entries.reverse(); // ronde la plus récente en haut
    const list = entries.map(([k, ms]) => `<h3 class="grouphead">${esc(k)}</h3>${ms.map(m => matchRow(c, s, m)).join('')}`).join('');
    return `<section class="panel"><div class="row between"><div><h2>Séance ${s.seq} · ${R.MODES[s.mode]}${s.mode === 'ladder' ? (s.ladderType === 'single' ? ' individuelle' : ' par groupes') : ''}</h2>
        <div class="muted small">${esc(s.date)} · Elo figé jusqu'à la clôture · ${s.mode === 'reclass' ? (s.phase === 'classement' ? 'tableaux de classement · ' : 'brassage · ') : ''}${done}/${total} matchs terminés</div></div>
        <span class="badge">${s.reopened ? 'Rouverte (correction)' : 'En cours'}</span></div>
      <div class="bar" style="margin:15px 0"><i style="width:${total ? done / total * 100 : 0}%"></i></div>
      <div class="actions">
        ${['ladder', 'swiss'].includes(s.mode) ? `<button class="btn primary" data-action="next-round" ${canNext.ok ? '' : 'disabled'} title="${esc(canNext.reason || '')}">${s.mode === 'ladder' ? 'Rotation suivante' : 'Ronde suivante'} (${s.round}/${s.rounds})</button>` : ''}
        <button class="btn" data-action="tab" data-tab="ranking">Voir l'Elo actuel</button>
      </div>
      ${s.mode === 'reclass' && R.canBuildClassement(s).ok ? reclassChooser(c, s) : ''}
      ${s.mode === 'swiss' && s.lastPairing && s.lastPairing.repeats ? `<div class="notice warn">${s.lastPairing.repeats} revanche(s) inévitable(s) dans cette ronde.</div>` : ''}
      ${s.mode === 'challenge' ? `<div class="row" style="margin-top:10px">
        <div class="field"><label for="challenger">Défiant</label><select id="challenger">${order.map((id, i) => `<option value="${id}">${i + 1}. ${esc(nameOf(c, id))}</option>`).join('')}</select></div>
        <div class="field"><label for="defender">Défié</label><select id="defender">${order.map((id, i) => `<option value="${id}">${i + 1}. ${esc(nameOf(c, id))}</option>`).join('')}</select></div>
        <button class="btn primary" data-action="add-challenge">+ Lancer le défi</button></div>
        <p class="muted small">Écart maximal : ${s.gap} rang(s). Un élève déjà engagé dans un défi non terminé ne peut pas en lancer un autre.</p>` : ''}
    </section>
    ${courtsPanel(c, s)}
    <section class="panel"><h2>Rencontres</h2>${list || '<div class="empty">Aucun match pour l\'instant.</div>'}
      <div class="notice">Seuls les matchs validés (hors forfait) comptent pour l'Elo, chacun une fois, indépendamment de l'ordre de saisie.</div></section>
    ${standingsPanel(c, s)}
    <section class="panel"><h2>Clôturer la séance</h2><p class="muted">Le calcul Elo utilisera, pour chaque match, les Elo de début de séance. ${s.reopened ? 'Les séances suivantes seront recalculées automatiquement.' : ''}</p>
      <div class="actions"><button class="btn primary" data-action="close-session" ${R.canClose(s).ok ? '' : 'disabled'}>✓ Valider tous les résultats et recalculer l'Elo</button>
      <button class="btn danger" data-action="cancel-session">${s.reopened ? 'Annuler la correction (restaurer la séance clôturée)' : 'Annuler la séance'}</button></div>
      ${R.canClose(s).ok ? '' : `<p class="muted small">${esc(R.canClose(s).reason)}</p>`}</section>`;
  }

  /* ---------------- Classement et fiche ---------------- */
  function ranking(c) {
    const r = R.ranks(c), p = r.find(x => x.id === selectedStudent) || r[0];
    let fiche = '';
    if (p) {
      const closed = c.sessions.filter(s => s.status === 'closed');
      const ms = closed.flatMap(s => s.matches.map(m => Object.assign({ seq: s.seq }, m))).filter(m => m.done && (m.a === p.id || m.b === p.id));
      fiche = `<section class="panel"><h2>Fiche individuelle · ${esc(p.name)}</h2>
        <div class="grid"><div class="stat"><b>${fmt(p.elo)}</b><small>Elo actuel</small></div><div class="stat"><b>${p.wins} / ${p.played}</b><small>Matchs gagnés${p.played ? ' (' + fmt(p.wins / p.played * 100) + ' %)' : ''}</small></div>
        <div class="stat"><b>${p.for} / ${p.against}</b><small>Points marqués / encaissés</small></div><div class="stat"><b>${p.opponents.size}</b><small>Adversaires différents</small></div><div class="stat"><b>${p.absences}</b><small>Absences</small></div></div>
        <h3 style="margin-top:20px">Évolution par séance</h3><div class="tablewrap"><table><tr><th>Séance</th><th>Date</th><th>Variation</th><th>Elo final</th><th>Rang</th></tr>${
          p.history.map(h => `<tr><td>${h.seq}</td><td>${esc(h.date || '')}</td><td class="${h.delta >= 0 ? 'good' : 'bad'}">${h.absent ? 'absent' : (h.delta >= 0 ? '+' : '') + fmt(h.delta)}</td><td>${fmt(h.elo)}</td><td>${h.rank}</td></tr>`).join('')}</table></div>
        <h3 style="margin-top:20px">Matchs</h3><div class="tablewrap"><table><tr><th>Séance</th><th>Adversaire</th><th>Score</th><th>Résultat</th></tr>${
          ms.map(m => { const me = m.a === p.id; const opp = me ? m.b : m.a; const won = R.winnerOf(m) === p.id;
            return `<tr><td>${m.seq}</td><td>${esc(nameOf(c, opp))}</td><td>${m.forfeit ? 'forfait' : (me ? m.sa + ' – ' + m.sb : m.sb + ' – ' + m.sa)}</td><td class="${won ? 'good' : 'bad'}">${won ? 'Victoire' : 'Défaite'}</td></tr>`; }).join('')}</table></div></section>`;
    }
    return `<section class="panel"><h2>Classement général Elo</h2>${rankingTable(r, { note: 'Calculé uniquement à partir des séances clôturées, dans l\'ordre chronologique. Égalités départagées par ordre alphabétique (affiché de façon stable). Variation = dernière séance clôturée. Les forfaits et exemptions ne comptent pas pour l\'Elo.' })}</section>${fiche}`;
  }

  function history(c) {
    return `<section class="panel"><h2>Historique des séances</h2>${
      c.sessions.slice().sort((a, b) => b.seq - a.seq).map(s => `<div class="row between listrow"><div><b>Séance ${s.seq}</b> · ${esc(s.date)} · ${R.MODES[s.mode]}<div class="muted small">${s.matches.filter(m => m.done).length} matchs · ${s.absent.length} absent(s) · ${s.status === 'closed' ? 'Clôturée' : (s.reopened ? 'Rouverte' : 'En cours')}</div></div>
        <div class="actions">${s.status === 'closed' ? `<button class="btn" data-action="reopen" data-id="${s.id}">Rouvrir pour corriger</button>` : '<button class="btn" data-action="tab" data-tab="session">Reprendre</button>'}</div></div>`).join('') || '<div class="empty">Aucune séance</div>'
    }</section>`;
  }

  function settings(c) {
    const anyClosed = c.sessions.some(s => s.status === 'closed');
    return `<section class="panel"><h2>Réglages de ${esc(c.name)}</h2><div class="row">
      <div class="field"><label for="sport">Sport</label><select id="sport">${['Badminton', 'Tennis de table', 'Pickleball', 'Tennis', 'Padel', 'Autre'].map(v => `<option ${c.sport === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="courts">Nombre de terrains</label><input type="number" id="courts" min="1" max="30" value="${c.courts}"></div>
      <div class="field"><label for="k">Coefficient Elo K (par match)</label><input type="number" id="k" min="1" max="100" value="${c.k}"></div>
      <div class="field"><label for="initElo">Elo initial du cycle</label><input type="number" id="initElo" min="100" max="3000" value="${Number.isFinite(c.initialElo) ? c.initialElo : 1000}"></div></div>
      <button class="btn primary" data-action="save-settings">Enregistrer les réglages</button>
      <p class="muted small">K est mémorisé à la création de chaque séance : le modifier n'affecte pas les séances passées. ${anyClosed ? 'Modifier l\'Elo initial recalcule tout le cycle.' : ''} Le nombre de terrains peut être changé pendant une séance : les matchs sont réaffectés automatiquement.</p></section>
      <section class="panel"><h2>Sauvegarde et transfert</h2><div class="actions"><button class="btn" data-action="export-json">Exporter sauvegarde JSON</button><button class="btn" data-action="export-csv">Exporter classement CSV</button>
      <label class="btn">Importer sauvegarde JSON<input type="file" id="importFile" accept="application/json,.json" style="display:none"></label></div>
      <p class="muted small">Le stockage local n'est pas synchronisé entre appareils. Avant chaque enregistrement, la version précédente est gardée comme copie de secours.</p></section>
      <section class="panel"><h2>Gestion</h2><button class="btn danger" data-action="delete-class">Supprimer cette classe et ses données</button></section>`;
  }

  /* ---------------- Exports ---------------- */
  function download(name, data, type) {
    const blob = new Blob([data], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- Actions ---------------- */
  const handlers = {
    'tab': el => { tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
    'student': el => { selectedStudent = el.dataset.id; tab = 'ranking'; render(); },
    'add-class': () => {
      const name = prompt('Nom de la classe (ex. 3e B)');
      if (!name || !name.trim()) return;
      const c = { id: R.uid(), name: name.trim(), sport: 'Badminton', courts: 4, students: [], sessions: [], k: 32, initialElo: 1000 };
      db.classes.push(c); db.active = c.id; tab = 'students';
      save(); render();
    },
    'add-student': () => {
      const c = cl(), v = $('newStudent').value;
      const r = R.addStudents(c, [v]);
      if (r.skipped.length) return toast('Nom déjà présent.', true);
      if (!r.added.length) return;
      save(); render(); $('newStudent').focus();
    },
    'bulk-students': () => {
      const r = R.addStudents(cl(), $('bulk').value.split(/\r?\n/));
      save(); render();
      toast(r.added.length + ' élève(s) ajouté(s)' + (r.skipped.length ? ', ' + r.skipped.length + ' doublon(s) ignoré(s)' : ''));
    },
    'rename': el => {
      const c = cl(), p = c.students.find(x => x.id === el.dataset.id);
      const name = prompt('Nom', p.name);
      if (name == null) return;
      act(() => R.renameStudent(c, p.id, name), 'Élève renommé');
    },
    'create-session': () => {
      const c = cl(), g = id => ($(id) ? $(id).value : undefined);
      act(() => R.createSession(c, { date: g('sdate'), mode: g('smode'), rounds: g('rounds'), target: g('target'), groupSize: g('groupSize'), ladderType: g('ladderType'), move: g('move'), gap: g('challengeGap'), legs: g('legs'), permutation: g('permutation') }));
    },
    'repropose': () => { const c = cl(); R.proposePlacement(c, R.activeSession(c)); save(); render(); },
    'shift': el => act(() => R.shiftPosition(R.activeSession(cl()), el.dataset.id, Number(el.dataset.dir))),
    'start-session': () => {
      const c = cl(), s = R.activeSession(c);
      if (!confirm('Valider le placement et générer les matchs ? L\'appel et les groupes ne pourront plus être modifiés.')) return;
      act(() => R.startSession(c, s), 'Séance lancée');
    },
    'cancel-session': () => {
      const c = cl(), s = R.activeSession(c);
      const msg = s.reopened ? 'Annuler la correction ? La séance retrouvera son état clôturé d\'origine.' : 'Annuler cette séance et supprimer ses résultats ?';
      if (!confirm(msg)) return;
      act(() => R.cancelSession(c, s), s.reopened ? 'Séance restaurée' : 'Séance annulée');
    },
    'record': el => {
      const c = cl(), s = R.activeSession(c), id = el.dataset.id;
      const a = $('a_' + id).value.trim(), b = $('b_' + id).value.trim();
      act(o => R.recordResult(c, s, id, { sa: a === '' ? '' : Number(a), sb: b === '' ? '' : Number(b) }, o), 'Score enregistré');
    },
    'forfeit': el => {
      const c = cl(), s = R.activeSession(c);
      if (!confirm('Enregistrer un forfait de ' + nameOf(c, el.dataset.loser) + ' ? Un forfait ne compte pas pour l\'Elo ni pour les points.')) return;
      act(o => R.recordResult(c, s, el.dataset.id, { forfeit: el.dataset.loser }, o), 'Forfait enregistré');
    },
    'clear': el => {
      if (!confirm('Effacer ce résultat ?')) return;
      const c = cl(); act(o => R.clearResult(c, R.activeSession(c), el.dataset.id, o), 'Résultat effacé');
    },
    'remove-match': el => { const c = cl(); act(() => R.removeMatch(c, R.activeSession(c), el.dataset.id), 'Défi supprimé'); },
    'next-round': () => { const c = cl(); act(() => R.nextRound(c, R.activeSession(c)), 'Nouvelle ronde générée'); },
    'add-challenge': () => { const c = cl(); act(() => R.addChallenge(c, R.activeSession(c), $('challenger').value, $('defender').value), 'Défi lancé'); },
    'build-classement': () => {
      const c = cl(), s = R.activeSession(c);
      const sizes = ($('partition').value || '').split('+').map(Number);
      if (!confirm('Générer les tableaux de classement ' + sizes.join(' + ') + ' ? Les divisions seront figées à partir du brassage.')) return;
      act(() => R.buildClassement(c, s, sizes), 'Reclassement généré');
    },
    'close-session': () => {
      const c = cl(), s = R.activeSession(c);
      if (!confirm('Clôturer la séance ? Les Elo seront calculés et le classement mis à jour.')) return;
      const r = act(() => R.closeSession(c, s), 'Séance clôturée');
      if (r && r.ok) { tab = 'ranking'; render(); }
    },
    'reopen': el => {
      if (!confirm('Rouvrir cette séance pour corriger des résultats ? Les séances suivantes seront recalculées à la nouvelle clôture. Vous pourrez annuler la correction.')) return;
      const c = cl(); const r = act(() => R.reopenSession(c, el.dataset.id), 'Séance rouverte');
      if (r && r.ok) { tab = 'session'; render(); }
    },
    'save-settings': () => {
      const c = cl(), n = Number($('courts').value), k = Number($('k').value), e = Number($('initElo').value);
      if (!Number.isInteger(n) || n < 1 || n > 30 || !Number.isFinite(k) || k < 1 || k > 100 || !Number.isFinite(e) || e < 100 || e > 3000) return toast('Réglages invalides.', true);
      if (c.sessions.some(s => s.status === 'closed') && e !== (Number.isFinite(c.initialElo) ? c.initialElo : 1000) && !confirm('Modifier l\'Elo initial recalcule tout le cycle. Continuer ?')) return;
      c.courts = n; c.k = k; c.initialElo = e; c.sport = $('sport').value;
      const s = R.activeSession(c);
      if (s) R.autoAssign(c, s);
      save(); render(); toast('Réglages enregistrés');
    },
    'export-json': () => download('racket-eps-sauvegarde-' + today() + '.json', JSON.stringify(db, null, 2), 'application/json'),
    'export-csv': () => {
      const c = cl();
      const rows = [['Rang', 'Eleve', 'Elo', 'Matchs', 'Victoires', 'Defaites', 'Points marques', 'Points encaisses', 'Adversaires distincts', 'Absences']]
        .concat(R.ranks(c).map((p, i) => [i + 1, p.name, fmt(p.elo), p.played, p.wins, p.losses, p.for, p.against, p.opponents.size, p.absences]));
      download('classement-' + c.name.replace(/[^a-z0-9]/gi, '-') + '.csv', '﻿' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n'), 'text/csv;charset=utf-8');
    },
    'delete-class': () => {
      const c = cl();
      if (!confirm('Supprimer définitivement ' + c.name + ' et toutes ses séances ?')) return;
      if (prompt('Pour confirmer, tapez le nom de la classe : ' + c.name) !== c.name) return toast('Suppression annulée.');
      db.classes = db.classes.filter(x => x.id !== c.id);
      db.active = db.classes[0] ? db.classes[0].id : null;
      save(); render();
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type === 'checkbox')) return;
    const h = handlers[el.dataset.action];
    if (h) { e.preventDefault(); h(el); }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'classSelect') { db.active = el.value || null; save(); render(); return; }
    if (el.id === 'smode') { $('modeOptions').innerHTML = modeFieldsHTML(el.value); return; }
    if (el.id === 'partition') { partitionKey = el.value; render(); return; }
    if (el.id === 'importFile') { importJSON(el); return; }
    const c = cl();
    if (el.dataset.action === 'absent') { const s = R.activeSession(c); act(() => R.setAbsent(c, s, el.dataset.id, el.checked)); return; }
    if (el.dataset.action === 'move-group') { const s = R.activeSession(c); act(() => R.moveToGroup(s, el.dataset.id, Number(el.value))); }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'newStudent') handlers['add-student']();
    const m = e.target.id && e.target.id.match(/^[ab]_(.+)$/);
    if (m) handlers.record({ dataset: { id: m[1] } });
  });

  async function importJSON(el) {
    const file = el.files[0];
    el.value = '';
    if (!file) return;
    try {
      const next = R.parseDB(await file.text());
      if (!confirm('Remplacer toutes les données locales par cette sauvegarde ? (Pensez à exporter les données actuelles avant.)')) return;
      try { localStorage.setItem(KEY_BAK, JSON.stringify(db)); } catch (e) { /* ignore */ }
      db = next;
      if (!cl()) db.active = db.classes[0] ? db.classes[0].id : null;
      save(); render(); toast('Sauvegarde importée');
    } catch (e) { toast('Import impossible : ' + e.message, true); }
  }

  window.addEventListener('storage', e => {
    if (e.key === KEY) { storageError = 'Les données ont été modifiées dans un autre onglet : rechargez la page avant de continuer.'; render(); }
  });

  db = load();
  if (db.active && !cl()) db.active = db.classes[0] ? db.classes[0].id : null;
  render();
  window.__racket = { getDB: () => db };
})();
