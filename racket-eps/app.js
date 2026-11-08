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
  let tab = 'dashboard', storageError = null, partitionKey = null;
  const projection = location.hash === '#projection';
  const poolSheetMode = location.hash.indexOf('#p=') === 0;     // feuille de poule (tablette)
  const sheetMode = location.hash.indexOf('#f=') === 0 || poolSheetMode;

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
    if (sheetMode || projection) return; // tablette élève / projection : lecture seule
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
  // Barre du bas (portée du pouce sur tablette) ; Historique et Réglages sont dans l'en-tête.
  const TABS = [['dashboard', 'Accueil', 'home'], ['session', 'Séance', 'court'], ['groups', 'Groupes', 'groups'], ['ranking', 'Classement', 'rank'], ['students', 'Élèves', 'student']];
  const ICONS = {"home": "<path d=\"M3 11l9-7 9 7\"/><path d=\"M5 10v10h14V10\"/>", "court": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"1.5\"/><path d=\"M12 5v14\"/>", "groups": "<circle cx=\"7\" cy=\"8\" r=\"3\"/><circle cx=\"17\" cy=\"8\" r=\"3\"/><path d=\"M2 20a5 5 0 0 1 10 0\"/><path d=\"M12 20a5 5 0 0 1 10 0\"/>", "rank": "<path d=\"M4 20V10\"/><path d=\"M10 20V4\"/><path d=\"M16 20v-7\"/><path d=\"M22 20H2\"/>", "student": "<circle cx=\"12\" cy=\"8\" r=\"3.5\"/><path d=\"M5 20a7 7 0 0 1 14 0\"/>"};
  const icon = (k, size) => `<svg width="${size || 30}" height="${size || 30}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;
  // Brouillon de la nouvelle séance (réglé au toucher, sans clavier)
  const draft = { mode: 'pools', rounds: 4, target: 11, groupSize: 4, ladderType: 'group', move: 1, gap: 3, legs: 1, permutation: 'swap', tiebreak: 'h2h-diff-pf' };

  function render() {
    if (projection) { renderProjection(); return; }
    if (poolSheetMode) { renderPoolSheet(); return; }
    if (sheetMode) { renderSheet(); return; }
    const c = cl();
    $('classSelect').innerHTML = db.classes.map(x => `<option value="${esc(x.id)}" ${x.id === db.active ? 'selected' : ''}>${esc(x.name)}</option>`).join('') || '<option value="">Aucune classe</option>';
    $('nav').innerHTML = TABS.map(([id, t, ic]) => `<button type="button" class="tab-btn ${tab === id ? 'active' : ''}" aria-current="${tab === id ? 'page' : 'false'}" data-action="tab" data-tab="${id}">${icon(ic)}<span>${t}</span></button>`).join('');
    document.querySelectorAll('.top [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('banner').innerHTML = storageError ? `<div class="notice warn" role="alert">${esc(storageError)} <button class="btn" data-action="export-json">Exporter</button></div>` : '';
    const views = { dashboard, students, session, groups: groupsView, ranking, history, settings, diagnostic };
    // Pastille sur le bouton de sauvegarde : séances clôturées non encore sauvegardées
    const unsaved = R.unsavedSessions(db), saveBtn = document.querySelector('.top [data-action="export-json"]');
    if (saveBtn) { saveBtn.dataset.count = unsaved ? String(unsaved) : ''; saveBtn.setAttribute('aria-label', 'Sauvegarder (export JSON)' + (unsaved ? ' — ' + unsaved + ' séance(s) non sauvegardée(s)' : '')); }
    $('view').innerHTML = !c ? welcome() : (views[tab] || dashboard)(c);
  }

  function welcome() {
    return `<section class="panel"><h2>Bienvenue dans Racket EPS</h2><p>Créez une classe pour organiser vos séances, faire l'appel et suivre les classements Elo.</p><div class="actions"><button class="btn primary" data-action="add-class">Créer ma première classe</button>
      <button class="btn" data-action="demo-class">Essayer avec une classe exemple</button></div>
      <p class="muted small">La classe exemple contient des élèves fictifs (pseudonymes d'animaux) et, si vous le souhaitez, quelques séances déjà jouées avec des résultats simulés, pour découvrir l'Elo, les graphiques et l'historique.</p></section>`;
  }

  function rankingTable(r, opts) {
    opts = opts || {};
    return `<div class="tablewrap"><table><thead><tr><th>Rang</th><th>Élève</th><th>Elo</th><th>Variation</th><th>Matchs</th><th>V</th><th>D</th><th>%</th><th>Diff. points</th></tr></thead><tbody>${
      r.map((p, i) => `<tr><td>${i + 1}</td><td><button class="btn linkish" data-action="student" data-id="${p.id}">${esc(p.name)}</button></td><td><b>${fmt(p.elo)}</b></td>
        <td class="${p.lastDelta >= 0 ? 'good' : 'bad'}">${!p.history.length ? '—' : (p.history[p.history.length - 1].absent ? '<span class="muted">absent</span>' : (p.lastDelta >= 0 ? '+' : '') + fmt(p.lastDelta))}</td>
        <td>${p.played}</td><td>${p.wins}</td><td>${p.losses}</td><td>${p.played ? fmt(p.wins / p.played * 100) + ' %' : '—'}</td><td>${p.for - p.against}</td></tr>`).join('')
    }</tbody></table></div>${opts.note ? `<p class="muted small">${opts.note}</p>` : ''}`;
  }

  function dashboard(c) {
    const r = R.ranks(c), s = R.activeSession(c), closed = c.sessions.filter(x => x.status === 'closed');
    const last = closed.length ? closed.slice().sort((a, b) => b.seq - a.seq)[0] : null;
    const status = s ? (s.status === 'setup' ? 'Appel et terrains à valider' : (s.reopened ? 'Séance rouverte pour correction' : s.matches.filter(m => m.done).length + ' / ' + s.matches.length + ' matchs terminés')) : '';
    const medal = ['#f5c04a', '#d8e1e8', '#d9a066'];
    const tile = (tabId, ic, title, sub) => `<button type="button" class="home-tile" data-action="tab" data-tab="${tabId}">${icon(ic, 46)}<span><b>${title}</b><span class="muted">${sub}</span></span></button>`;
    const unsaved = R.unsavedSessions(db);
    const backup = unsaved ? `<div class="notice warn backup-reminder" role="status"><span><b>${unsaved} séance(s) clôturée(s) non sauvegardée(s).</b> Les données ne sont que sur cet appareil : sauvegardez-les (fichier, ENT, clé USB).</span>
      <span class="actions"><button type="button" class="btn primary" data-action="export-json">Sauvegarder maintenant</button>${canShareFiles() ? '<button type="button" class="btn" data-action="share-backup">Partager…</button>' : ''}</span></div>` : '';
    return `${demoNotice(c)}${backup}<div class="home">
      <section class="panel hero">
        <div><div class="eyebrow">${s ? 'Séance ' + s.seq + ' en cours' : 'Séance ' + (Math.max(0, ...c.sessions.map(x => x.seq)) + 1)}</div>
        <h1>${s ? esc(R.MODES[s.mode]) : 'Prête à démarrer'}</h1>
        <p class="muted">${s ? esc(status) : (last ? 'Dernière séance : ' + esc(R.MODES[last.mode].toLowerCase()) + ', ' + last.absent.length + ' absent(s). Les terrains seront proposés dans l\'ordre du classement.' : 'Faites l\'appel, validez les terrains, puis les matchs se lancent.')}</p></div>
        <button type="button" class="btn primary hero-btn" data-action="tab" data-tab="session"><svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${s ? 'Reprendre la séance' : 'Lancer la séance'}</button>
      </section>
      <section class="panel podium"><h2>Podium Elo</h2>${r.slice(0, 3).map((p, i) => `<button type="button" class="podium-row" data-action="student" data-id="${p.id}"><span class="medal" style="background:${medal[i]}">${i + 1}</span><b>${esc(p.name)}</b><span class="muted">${fmt(p.elo)}</span></button>`).join('') || '<p class="muted">Ajoutez des élèves.</p>'}</section>
      ${tile('groups', 'groups', 'Groupes de travail', 'Répartir la classe sur les terrains')}
      ${tile('ranking', 'rank', 'Classement', closed.length + ' séance(s) clôturée(s)')}
      ${tile('students', 'student', 'Élèves', c.students.length + ' élève(s)')}
    </div>`;
  }

  function demoNotice(c) {
    return c.demo ? `<div class="notice warn" role="note"><b>Classe exemple — données fictives.</b> Élèves et résultats ont été générés pour tester l'application. Supprimez-la dans Réglages quand vous n'en avez plus besoin.</div>` : '';
  }

  function students(c) {
    const st = R.computeStats(c);
    return `${demoNotice(c)}<section class="panel"><h2>Gestion des élèves</h2>
      <div class="row"><div class="field"><label for="newStudent">Ajouter un élève</label><input id="newStudent" placeholder="Prénom N." autocomplete="off"></div><button class="btn primary" data-action="add-student">Ajouter</button></div>
      <div class="field"><label for="bulk">Importer une liste (un élève par ligne)</label><textarea id="bulk" placeholder="Prénom N.&#10;Prénom N.&#10;…"></textarea></div>
      <button class="btn" data-action="bulk-students">Importer les noms</button>
      <p class="muted small">Les doublons (majuscules et accents ignorés) sont refusés. Les noms restent dans ce navigateur : évitez les données nominatives sur un appareil partagé.</p></section>
      <section class="panel"><h2>Liste (${c.students.length})</h2>${
        c.students.map((p, i) => `<div class="row between listrow"><span>${i + 1}. <button class="btn linkish" data-action="student" data-id="${p.id}">${esc(p.name)}</button> <span class="muted small">· Elo ${fmt(st[p.id].elo)} · ${st[p.id].absences} absence(s)</span></span><button class="btn" data-action="rename" data-id="${p.id}">Renommer</button></div>`).join('') || '<div class="empty">Aucun élève</div>'
      }</section>`;
  }

  /* ---------------- Séance ---------------- */
  function session(c) {
    const s = R.activeSession(c);
    if (!s) return newSessionUI(c);
    if (s.status === 'setup') return setupUI(c, s);
    return playingUI(c, s);
  }

  const FORMAT_DESC = {
    pools: 'Tous contre tous par groupe', ladder: 'Le gagnant monte, le perdant descend', swiss: 'Adversaires de même niveau',
    challenge: 'Défier un élève proche au classement', reclass: 'Brassage puis toutes les places'
  };
  function segBtns(key, opts, label) {
    const wide = opts.some(([, l]) => String(l).length > 6);
    return `<div class="field-big"><span class="fb-label">${label}</span><div class="seg ${wide ? 'wide' : ''}" role="group" aria-label="${esc(label)}">${opts.map(([v, l]) => {
      const on = String(draft[key]) === String(v);
      return `<button type="button" class="seg-btn ${on ? 'on' : ''}" aria-pressed="${on}" data-action="draft" data-key="${key}" data-value="${v}">${l}</button>`;
    }).join('')}</div></div>`;
  }
  function stepperBig(key, min, max, label) {
    return `<div class="field-big row-step"><span class="fb-label">${label}</span><div class="step-big">
      <button type="button" class="btn step-btn" data-action="draft-step" data-key="${key}" data-delta="-1" data-min="${min}" data-max="${max}" aria-label="${esc(label)} : moins" ${draft[key] <= min ? 'disabled' : ''}>−</button>
      <b aria-live="polite">${draft[key]}</b>
      <button type="button" class="btn step-btn" data-action="draft-step" data-key="${key}" data-delta="1" data-min="${min}" data-max="${max}" aria-label="${esc(label)} : plus" ${draft[key] >= max ? 'disabled' : ''}>+</button></div></div>`;
  }

  function newSessionUI(c) {
    const m = draft.mode, group = ['pools', 'reclass', 'ladder'].includes(m);
    const fields = [];
    if (m === 'swiss' || m === 'ladder') fields.push(stepperBig('rounds', 1, 30, m === 'ladder' ? 'Rotations' : 'Rondes'));
    if (m === 'ladder') fields.push(segBtns('ladderType', [['single', 'Individuelle (2 par terrain)'], ['group', 'Par groupes']], 'Variante'));
    if (group && !(m === 'ladder' && draft.ladderType === 'single')) fields.push(segBtns('groupSize', [[3, '3'], [4, '4'], [5, '5'], [6, '6']], m === 'reclass' ? 'Élèves par poule de brassage' : 'Élèves par groupe'));
    if (m === 'ladder' && draft.ladderType === 'group') fields.push(segBtns('move', [[1, '1'], [2, '2']], 'Montées / descentes'));
    if (m === 'pools') fields.push(segBtns('legs', [[1, 'Aller simple'], [2, 'Aller-retour']], 'Matchs'));
    if (m === 'challenge') { fields.push(stepperBig('gap', 1, 50, 'Écart de rang maximal')); fields.push(segBtns('permutation', [['swap', 'Le vainqueur prend la place'], ['none', 'Pas de permutation']], 'Si le défiant gagne')); }
    fields.push(segBtns('target', [[7, '7'], [11, '11'], [15, '15'], [21, '21']], 'Score cible'));
    if (group) fields.push(segBtns('tiebreak', [['h2h-diff-pf', 'Confrontation directe'], ['diff-pf-h2h', 'Différence d\'abord'], ['diff-pf', 'Différence, points']], 'Départage des égalités'));
    return `<section class="panel"><div class="row between"><h2>Nouvelle séance</h2>
      <div class="field-inline"><label for="sdate" class="small muted">Date</label><input type="date" id="sdate" value="${today()}"></div></div>
      <div class="format-grid" role="group" aria-label="Format de tournoi">${Object.entries(R.MODES).map(([k, v]) => {
        const on = draft.mode === k;
        return `<button type="button" class="format-card ${on ? 'on' : ''}" aria-pressed="${on}" data-action="draft" data-key="mode" data-value="${k}"><b>${v}</b><span>${FORMAT_DESC[k]}</span></button>`;
      }).join('')}</div>
      <div class="fields-grid">${fields.join('')}</div>
      <button type="button" class="btn primary big-cta" data-action="create-session">Suivant : faire l'appel <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></button>
      <p class="muted small">Chaque match validé compte pour l'Elo, mais les Elo ne changent qu'à la clôture de la séance.</p></section>`;
  }

  function setupUI(c, s) {
    const ranked = R.ranks(c);
    const warnings = R.placementWarnings(s);
    let placement;
    if (s.groups) {
      placement = `<p class="muted small">Proposition automatique dans l'ordre Elo (terrain/groupe 1 = meilleurs Elo). Ce placement est exactement celui qui servira à générer les matchs. Les déplacements ne modifient pas l'Elo.</p>
        <div class="grid">${s.groups.map((g, i) => `<div class="court"><h3>${s.mode === 'ladder' ? 'Terrain' : 'Groupe'} ${i + 1}${i + 1 > R.availableCourts(c, s).length ? ' <span class="badge">partage un terrain</span>' : ''}</h3>${
          g.map(id => `<div class="player"><span>${esc(nameOf(c, id))}</span><label class="sr-only" for="mv_${id}">Groupe de ${esc(nameOf(c, id))}</label><select id="mv_${id}" data-action="move-group" data-id="${id}">${
            s.groups.map((_, j) => `<option value="${j}" ${j === i ? 'selected' : ''}>${s.mode === 'ladder' ? 'T' : 'G'}${j + 1}</option>`).join('')}<option value="${s.groups.length}">Nouveau</option></select></div>`).join('')}</div>`).join('')}</div>`;
    } else {
      placement = `<p class="muted small">Ordre de départ proposé selon l'Elo (rang local). Utilisez ↑ ↓ pour l'ajuster ; l'Elo n'est pas modifié.</p>
        <ol class="order">${s.positions.map((id, i) => `<li class="player"><span>${i + 1}. ${esc(nameOf(c, id))}</span><span><button class="btn mini" data-action="shift" data-id="${id}" data-dir="-1" aria-label="Monter ${esc(nameOf(c, id))}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn mini" data-action="shift" data-id="${id}" data-dir="1" aria-label="Descendre ${esc(nameOf(c, id))}" ${i === s.positions.length - 1 ? 'disabled' : ''}>↓</button></span></li>`).join('')}</ol>`;
    }
    return `<section class="panel"><div class="row between"><h2>Séance ${s.seq} · Appel et terrains</h2><span class="badge">Validation obligatoire</span></div>
      <p class="muted">${esc(s.date)} · ${R.MODES[s.mode]} · ${s.positions.length} présents / ${c.students.length}</p>
      ${courtsStepper(c, s)}
      <div class="row between" style="margin-top:14px"><div><h3 style="margin:0">Appel</h3><span class="muted small">Touchez un élève pour le marquer absent</span></div>
        <div class="row"><span class="count-pill ok">${s.positions.length} présent${s.positions.length > 1 ? 's' : ''}</span><span class="count-pill ko">${s.absent.length} absent${s.absent.length > 1 ? 's' : ''}</span><button type="button" class="btn" data-action="all-present" ${s.absent.length ? '' : 'disabled'}>Tous présents</button></div></div>
      <div class="roll-grid">${ranked.map(p => { const a = s.absent.includes(p.id); return `<button type="button" class="roll-tile ${a ? 'absent' : ''}" aria-pressed="${a}" aria-label="${esc(p.name)}, ${a ? 'absent' : 'présent'}" data-action="toggle-absent" data-id="${p.id}"><span class="rt-top"><b>${esc(p.name)}</b><span class="rt-mark" aria-hidden="true">${a ? '×' : '✓'}</span></span><span class="rt-sub">${a ? 'Absent' : 'Elo ' + fmt(p.elo)}</span></button>`; }).join('')}</div>
      <h3 style="margin-top:20px">Placement</h3>${placement}
      ${warnings.length ? `<div class="notice warn">${warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="actions" style="margin-top:18px"><button class="btn primary big-cta" data-action="start-session" ${s.positions.length < 2 ? 'disabled' : ''}>✓ Valider l'appel et les terrains (${s.positions.length})</button>
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
    const score = m.done ? (m.forfeit ? 'forfait' : m.sa + ' – ' + m.sb) : '– · –';
    return `<div class="match st-${st}">
      <div class="name ${w && w === m.a ? 'win' : ''}">${nameA}</div>
      <div class="match-score" aria-label="Score">${esc(score)}</div>
      <div class="name ${w && w === m.b ? 'win' : ''}">${nameB}</div>
      <button class="btn ${m.done ? '' : 'primary'} match-btn" data-action="score-sheet" data-id="${m.id}" ${ready ? '' : 'disabled'}>${m.done ? 'Corriger' : 'Saisir le score'}</button>
      <div class="muted small meta">${esc(matchLabel(c, s, m))} · ${stateTxt}${m.invalidated ? ' · <span class="bad">résultat invalidé par une correction en amont, à rejouer</span>' : ''}
        ${ready ? `<details class="more"><summary>Autres actions</summary><div class="actions">
          <button class="btn" data-action="forfeit" data-id="${m.id}" data-loser="${m.a}">Forfait de ${esc(nameOf(c, m.a))}</button>
          <button class="btn" data-action="forfeit" data-id="${m.id}" data-loser="${m.b}">Forfait de ${esc(nameOf(c, m.b))}</button>
          <button class="btn" data-action="qr-match" data-id="${m.id}">QR de la feuille de match</button>
          ${m.done ? `<button class="btn" data-action="clear" data-id="${m.id}">Effacer le résultat</button>` : ''}
          ${s.mode === 'challenge' && !m.done ? `<button class="btn danger" data-action="remove-match" data-id="${m.id}">Supprimer ce défi</button>` : ''}</div></details>` : ''}
      </div></div>`;
  }

  /* ---------------- Terrains dessinés selon le sport de la classe ---------------- */
  // Tracés vus de dessus, aux proportions réglementaires (filet vertical au centre).
  const SPORTS_ART = {
    badminton: { surround: '#1d4f3d', pos: [26, 74], svg: '<svg viewBox="-12 -12 158 85" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><rect width="134" height="61" fill="#2f7d5b"/><g fill="none" stroke="#fff" stroke-width=".8"><rect width="134" height="61"/><path d="M0 4.6H134M0 56.4H134M47.2 0V61M86.8 0V61M7.6 0V61M126.4 0V61M0 30.5H47.2M86.8 30.5H134"/></g><path d="M67-4V65" stroke="#e6edf2" stroke-width="1.6" stroke-dasharray="1.2 .8"/><circle cx="67" cy="-4" r="1.4" fill="#e6edf2"/><circle cx="67" cy="65" r="1.4" fill="#e6edf2"/></svg>' },
    tt: { surround: '#7a3529', pos: [12, 88], svg: '<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><rect x="100" y="46" width="200" height="111" rx="2" fill="#1f4e8c" stroke="#fff" stroke-width="3"/><path d="M100 101.5H300" stroke="#fff" stroke-width="1.2"/><rect x="198" y="38" width="4" height="127" fill="#d9e2ea"/><rect x="196" y="34" width="8" height="8" rx="1.5" fill="#44525e"/><rect x="196" y="161" width="8" height="8" rx="1.5" fill="#44525e"/><rect x="110" y="157" width="6" height="18" fill="#2a2f35"/><rect x="284" y="157" width="6" height="18" fill="#2a2f35"/></svg>' },
    pickleball: { surround: '#1f4f78', pos: [26, 74], svg: '<svg viewBox="-12 -12 158 85" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><rect width="134" height="61" fill="#2c6fa3"/><rect x="45.7" width="42.6" height="61" fill="#3a8f6a"/><g fill="none" stroke="#fff" stroke-width=".8"><rect width="134" height="61"/><path d="M45.7 0V61M88.3 0V61M0 30.5H45.7M88.3 30.5H134"/></g><path d="M67-4V65" stroke="#e6edf2" stroke-width="1.6"/></svg>' },
    tennis: { surround: '#2f6e49', pos: [26, 74], svg: '<svg viewBox="-18 -16 273.7 141.7" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><rect width="237.7" height="109.7" fill="#2b5f9e"/><g fill="none" stroke="#fff" stroke-width="1.2"><rect width="237.7" height="109.7"/><path d="M0 13.7H237.7M0 96H237.7M54.85 13.7V96M182.85 13.7V96M54.85 54.85H182.85M0 54.85H3M234.7 54.85H237.7"/></g><path d="M118.85-6V115.7" stroke="#e6edf2" stroke-width="2.4"/></svg>' },
    padel: { surround: '#16325a', pos: [26, 74], svg: '<svg viewBox="-10 -10 220 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><rect width="200" height="100" fill="#2a5aa0"/><path d="M30.5 0V100M169.5 0V100M28.5 50H171.5" fill="none" stroke="#fff"/><rect x="-2.5" y="-2.5" width="205" height="105" fill="none" stroke="#cfe3ef" stroke-width="4" stroke-opacity=".85"/><path d="M40-4.5V-.5M80-4.5V-.5M120-4.5V-.5M160-4.5V-.5M40 100.5V104.5M80 100.5V104.5M120 100.5V104.5M160 100.5V104.5" stroke="#091522" stroke-width="1.4"/><path d="M100-4V104" stroke="#e6edf2" stroke-width="2"/></svg>' },
    generic: { surround: '#22384b', pos: [26, 74], svg: '<svg viewBox="-12 -12 158 85" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><rect width="134" height="61" fill="#35566f"/><rect width="134" height="61" fill="none" stroke="#fff" stroke-width=".8"/><path d="M67-4V65" stroke="#e6edf2" stroke-width="1.6"/></svg>' }
  };
  const SPORT_KEYS = { 'Badminton': 'badminton', 'Tennis de table': 'tt', 'Pickleball': 'pickleball', 'Tennis': 'tennis', 'Padel': 'padel' };
  const sportKey = c => SPORT_KEYS[c && c.sport] || 'generic';
  const initials = n => String(n || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  /**
   * Terrain dessiné avec les élèves placés dessus.
   * o = { left: [ids], right: [ids], state: 'playing'|'free'|'closed'|'group', big, clickable }
   * Joueur A à gauche du filet, joueur B à droite (au tennis de table : en bout de table).
   */
  function courtDrawing(c, o) {
    const key = sportKey(c), art = SPORTS_ART[key];
    const chip = (id, side) => {
      const n = nameOf(c, id);
      const label = o.clickable ? `<button type="button" class="cd-name" data-action="student" data-id="${id}">${esc(n)}</button>` : `<span class="cd-name">${esc(n)}</span>`;
      return `<span class="cd-player side-${side}"><span class="cd-dot" aria-hidden="true">${esc(initials(n))}</span>${label}</span>`;
    };
    const col = (ids, side, x) => ids.length ? `<div class="cd-side" style="left:${x}%">${ids.map(id => chip(id, side)).join('')}</div>` : '';
    const n = (o.left || []).length + (o.right || []).length;
    let overlay = '';
    if (o.state === 'free') overlay = '<div class="cd-overlay"><span class="cd-tag">Libre</span></div>';
    if (o.state === 'closed') overlay = '<div class="cd-overlay closed"><span class="cd-tag dashed">Fermé</span></div>';
    return `<div class="court-draw ${o.big ? 'big' : ''} ${n > 4 ? 'crowded' : ''} ${o.state === 'closed' ? 'is-closed' : ''}" data-sport="${key}" style="background:${art.surround}">
      <div class="cd-art">${art.svg}</div>
      ${o.state === 'closed' || o.state === 'free' ? '' : col(o.left || [], 'a', art.pos[0]) + col(o.right || [], 'b', art.pos[1])}
      ${overlay}</div>`;
  }

  // Remplaçants d'un groupe (poules, montante-descendante par groupes) qui attendent pendant ce match.
  // (sans les élèves de ce groupe qui jouent déjà sur un autre terrain).
  function benchFor(s, m) {
    if (!s.groups || m.group == null || !s.groups[m.group]) return [];
    const busy = new Set();
    s.matches.forEach(x => { if (x.court && !x.done) { busy.add(x.a); busy.add(x.b); } });
    return s.groups[m.group].filter(id => id !== m.a && id !== m.b && !busy.has(id));
  }

  function courtsStepper(c, s) {
    const n = R.totalCourts(c, s), open = R.availableCourts(c, s).length;
    return `<div class="row courts-stepper" role="group" aria-label="Terrains de la séance">
      <span class="small"><b>Terrains disponibles</b></span>
      <button class="btn mini" data-action="courts-step" data-delta="-1" aria-label="Retirer un terrain" ${n <= 1 ? 'disabled' : ''}>−</button>
      <b class="courts-count" aria-live="polite">${open}${open !== n ? ' / ' + n : ''}</b>
      <button class="btn mini" data-action="courts-step" data-delta="1" aria-label="Ajouter un terrain" ${n >= 30 ? 'disabled' : ''}>+</button>
    </div>`;
  }

  function courtsPanel(c, s) {
    const closed = new Set(s.closedCourts || []);
    const cards = [];
    for (let t = 1; t <= R.totalCourts(c, s); t++) {
      if (closed.has(t)) {
        cards.push(`<div class="court-card is-closed"><div class="cc-head"><h3>Terrain ${t}</h3><span class="badge cc-closed">Fermé</span></div>
          ${courtDrawing(c, { state: 'closed' })}
          <div class="cc-foot"><span class="muted small">Terrain fermé pour la séance</span><div class="actions"><button class="btn mini" data-action="court-toggle" data-court="${t}" data-closed="0">Rouvrir</button></div></div></div>`);
        continue;
      }
      const m = s.matches.find(x => x.court === t && !x.done);
      const bench = m ? benchFor(s, m) : [];
      cards.push(`<div class="court-card"><div class="cc-head"><h3>Terrain ${t}</h3><span class="badge ${m ? 'cc-on' : ''}">${m ? 'En cours' : 'Libre'}</span></div>
        ${m ? `<div class="cd-wrap">${courtDrawing(c, { left: [m.a], right: [m.b], state: 'playing' })}<button type="button" class="cd-hit" data-action="score-sheet" data-id="${m.id}" aria-label="Terrain ${t} : ${esc(nameOf(c, m.a))} contre ${esc(nameOf(c, m.b))}, saisir le score"></button></div>` : courtDrawing(c, { state: 'free' })}
        <div class="cc-foot">
          <span class="muted small">${m ? esc(matchLabel(c, s, m)) : 'En attente du prochain match de la file'}</span>
          ${bench.length ? `<div class="cc-bench"><span class="small muted">Sur le banc</span>${bench.map(id => `<span class="bench-chip">${esc(nameOf(c, id))}</span>`).join('')}</div>` : ''}
          <div class="actions">${m ? `<button class="btn primary" data-action="score-sheet" data-id="${m.id}">Saisir le score</button><button class="btn mini" data-action="qr-match" data-id="${m.id}" aria-label="QR code du match du terrain ${t}">QR</button>` : ''}
          <button class="btn mini court-close" data-action="court-toggle" data-court="${t}" data-closed="1" aria-label="Fermer le terrain ${t}">Fermer</button></div>
        </div></div>`);
    }
    const waiting = s.matches.filter(m => R.matchState(m) === 'waiting').length;
    return `<section class="panel"><div class="row between"><h2>Terrains de ${esc((c.sport || 'jeu').toLowerCase())}</h2>${courtsStepper(c, s)}</div>
      <p class="muted small">${waiting} match(s) en file d'attente · chaque élève est placé dans sa moitié de terrain ; les remplaçants du groupe attendent sur le banc. Un élève ne joue jamais deux matchs à la fois. Ajoutez, retirez ou fermez un terrain à tout moment (confirmation si un match en cours est concerné). Le dessin suit le sport de la classe (Réglages).</p>
      <div class="courts-grid">${cards.join('')}</div></section>`;
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
    if (!body && s.mode === 'pools') {
      const tb = R.TIEBREAKS[s.tiebreak] || R.TIEBREAKS['diff-pf'];
      body = s.groups.map((g, gi) => {
        const rk = R.rankGroup(s, g, m => m.group === gi);
        return `<h3 class="grouphead">Groupe ${gi + 1}</h3><div class="tablewrap"><table><thead><tr><th>Rg</th><th>Élève</th><th>V</th><th>D</th><th>Diff</th><th>Pts marqués</th><th>Départagé par</th></tr></thead><tbody>${
          rk.map(x => `<tr><td>${x.rank}</td><td>${esc(nameOf(c, x.id))}</td><td><b>${x.wins}</b></td><td>${x.losses}</td><td>${x.diff}</td><td>${x.pf}</td><td class="muted small">${esc(x.decidedLabel)}</td></tr>`).join('')}</tbody></table></div>`;
      }).join('') + `<p class="muted small">Classement de chaque poule : victoires, puis ${esc(tb.label.toLowerCase())}, puis ordre de départ. « Départagé par » indique le critère qui sépare un élève de celui classé juste devant. Distinct de l'Elo.</p>`;
      title = 'Classement des poules';
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
        <button class="btn" data-action="open-projection">📺 Mode projection</button>
        <label class="row small" style="gap:6px"><input type="checkbox" style="width:auto" data-action="proj-standings" ${s.projShowStandings ? 'checked' : ''}> Projeter aussi le classement de la séance</label>
        <button class="btn primary" data-action="scan-open">📷 Mode scan</button>
        <label class="row small" style="gap:6px"><input type="checkbox" style="width:auto" data-action="proj-qr" ${s.projQr !== false ? 'checked' : ''}> QR codes des matchs en projection</label>
      </div>
      ${s.mode === 'reclass' && R.canBuildClassement(s).ok ? reclassChooser(c, s) : ''}
      ${s.mode === 'pools' ? `<div class="notice pools-auto"><b>Poules en autonomie.</b> Chaque poule scanne son QR : la tablette affiche tous les matchs de la poule ; les élèves les jouent, saisissent les scores, puis présentent un seul QR de résultat au mode scan.
        <div class="actions" style="margin-top:8px">${s.groups.map((g, gi) => `<button class="btn" data-action="qr-pool" data-group="${gi}">QR poule ${gi + 1} <span class="muted small">(${g.length} élèves · ${R.groupMatches(s, gi).filter(m => m.done).length}/${R.groupMatches(s, gi).length})</span></button>`).join('')}</div></div>` : ''}
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

  /* ---------------- Saisie du score : grand panneau, sans clavier ---------------- */
  let ss = null; // { id, sa, sb }
  function openScoreSheet(id) {
    const c = cl(), s = R.activeSession(c), m = s && s.matches.find(x => x.id === id);
    if (!m || !m.a || !m.b) return;
    ss = { id, sa: m.done && !m.forfeit ? m.sa : 0, sb: m.done && !m.forfeit ? m.sb : 0 };
    renderScoreSheet();
    const dlg = $('scoreDialog');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  }
  function closeScoreSheet() { const d = $('scoreDialog'); ss = null; if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); } }
  function renderScoreSheet() {
    const c = cl(), s = R.activeSession(c), m = s && ss && s.matches.find(x => x.id === ss.id);
    if (!m) { closeScoreSheet(); return; }
    const target = s.target || 11, tie = ss.sa === ss.sb;
    const side = (k, id, dot) => { const v = ss[k], other = ss[k === 'sa' ? 'sb' : 'sa'], n = nameOf(c, id); return `<div class="ss-player ${v > other ? 'lead' : ''}">
      <div class="ss-name"><span class="ss-dot" style="background:${dot}" aria-hidden="true">${esc(initials(n))}</span>${esc(n)}</div>
      <div class="ss-score"><button type="button" class="btn ss-btn" data-action="ss-step" data-side="${k}" data-delta="-1" aria-label="Retirer un point à ${esc(n)}">−</button>
      <output aria-live="polite">${v}</output>
      <button type="button" class="btn primary ss-btn" data-action="ss-step" data-side="${k}" data-delta="1" aria-label="Ajouter un point à ${esc(n)}">+</button></div>
      <button type="button" class="btn ss-target" data-action="ss-target" data-side="${k}">${esc(n)} gagne : ${target}</button></div>`; };
    $('scoreDialog').innerHTML = `<div class="ss-box">
      <div class="ss-head"><div><div class="eyebrow">${m.court ? 'Terrain ' + m.court + ' · ' : ''}${esc(matchLabel(c, s, m))}</div>
        <h2 id="scoreTitle">Score cible ${target} · point décisif en cas d'égalité</h2></div>
        <button type="button" class="btn icon-btn" data-action="ss-close" aria-label="Fermer sans enregistrer">✕</button></div>
      <div class="ss-grid">${side('sa', m.a, '#f5c04a')}${side('sb', m.b, '#9ad7ff')}</div>
      <div class="ss-actions">${tie ? '<div class="ss-tie" role="status">Égalité : jouez un point décisif</div>' : `<button type="button" class="btn primary ss-validate" data-action="ss-validate">✓ Valider ${ss.sa} – ${ss.sb}</button>`}
        <details class="more ss-more"><summary class="btn">Plus…</summary><div class="actions">
          <button type="button" class="btn" data-action="ss-forfeit" data-loser="${m.a}">Forfait de ${esc(nameOf(c, m.a))}</button>
          <button type="button" class="btn" data-action="ss-forfeit" data-loser="${m.b}">Forfait de ${esc(nameOf(c, m.b))}</button>
          <button type="button" class="btn" data-action="qr-match" data-id="${m.id}">QR de la feuille de match</button>
          ${m.done ? '<button type="button" class="btn danger" data-action="ss-clear">Effacer le résultat</button>' : ''}</div></details></div></div>`;
  }

  /* ---------------- Classement et fiche ---------------- */
  function ficheHTML(c, p) {
    const closed = c.sessions.filter(s => s.status === 'closed');
    const ms = closed.flatMap(s => s.matches.map(m => Object.assign({ seq: s.seq }, m))).filter(m => m.done && (m.a === p.id || m.b === p.id));
    const rank = R.ranks(c).findIndex(x => x.id === p.id) + 1;
    return `<div class="dlg-head"><h2 id="studentTitle">Fiche individuelle · ${esc(p.name)}</h2><button class="btn mini" data-action="student-close" aria-label="Fermer la fiche">✕</button></div>
      <div class="grid"><div class="stat"><b>${fmt(p.elo)}</b><small>Elo actuel · ${rank}ᵉ / ${c.students.length}</small></div><div class="stat"><b>${p.wins} / ${p.played}</b><small>Matchs gagnés${p.played ? ' (' + fmt(p.wins / p.played * 100) + ' %)' : ''}</small></div>
      <div class="stat"><b>${p.for} / ${p.against}</b><small>Points marqués / encaissés</small></div><div class="stat"><b>${p.opponents.size}</b><small>Adversaires différents</small></div><div class="stat"><b>${p.absences}</b><small>Absences</small></div></div>
      <h3 style="margin-top:20px">Évolution de l'Elo</h3>
      ${lineChart({ id: 'eloChart', points: p.history.map(h => ({ v: h.elo, x: 'S' + h.seq, label: 'Séance ' + h.seq + (h.date ? ' · ' + h.date : '') + (h.absent ? ' · absent' : ''), hollow: h.absent })), baseline: Number.isFinite(c.initialElo) ? c.initialElo : 1000, baselineLabel: 'Elo initial', fmtVal: v => fmt(v), name: 'Elo' })}
      <h3 style="margin-top:20px">Évolution du rang dans la classe</h3>
      ${lineChart({ id: 'rankChart', points: p.history.map(h => ({ v: h.rank, x: 'S' + h.seq, label: 'Séance ' + h.seq + (h.date ? ' · ' + h.date : '') + (h.absent ? ' · absent' : ''), hollow: h.absent })), invert: true, integer: true, min: 1, max: c.students.length, fmtVal: v => v + 'ᵉ / ' + c.students.length, name: 'Rang' })}
      <h3 style="margin-top:20px">Évolution par séance (tableau)</h3><div class="tablewrap"><table><tr><th>Séance</th><th>Date</th><th>Variation</th><th>Elo final</th><th>Rang</th></tr>${
        p.history.map(h => `<tr><td>${h.seq}</td><td>${esc(h.date || '')}</td><td class="${h.delta >= 0 ? 'good' : 'bad'}">${h.absent ? 'absent' : (h.delta >= 0 ? '+' : '') + fmt(h.delta)}</td><td>${fmt(h.elo)}</td><td>${h.rank}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune séance clôturée</td></tr>'}</table></div>
      <h3 style="margin-top:20px">Matchs</h3><div class="tablewrap"><table><tr><th>Séance</th><th>Adversaire</th><th>Score</th><th>Résultat</th></tr>${
        ms.map(m => { const me = m.a === p.id; const opp = me ? m.b : m.a; const won = R.winnerOf(m) === p.id;
          return `<tr><td>${m.seq}</td><td>${esc(nameOf(c, opp))}</td><td>${m.forfeit ? 'forfait' : (me ? m.sa + ' – ' + m.sb : m.sb + ' – ' + m.sa)}</td><td class="${won ? 'good' : 'bad'}">${won ? 'Victoire' : 'Défaite'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">Aucun match dans les séances clôturées</td></tr>'}</table></div>`;
  }

  let ficheOpener = null;
  function openFiche(id) {
    const c = cl(), st = R.computeStats(c), p = st[id];
    if (!p) return;
    const dlg = $('studentDialog');
    ficheOpener = document.activeElement;
    dlg.innerHTML = `<div class="dlg-body">${ficheHTML(c, p)}</div>`;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    const close = dlg.querySelector('[data-action="student-close"]');
    if (close) close.focus();
  }
  function closeFiche() {
    const dlg = $('studentDialog');
    if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  }

  function ranking(c) {
    const r = R.ranks(c);
    return `${demoNotice(c)}<section class="panel"><h2>Classement général Elo</h2>${rankingTable(r, { note: 'Touchez le nom d\'un élève pour ouvrir sa fiche. Calculé uniquement à partir des séances clôturées, dans l\'ordre chronologique. Égalités départagées par ordre alphabétique (affiché de façon stable). Variation = dernière séance clôturée. Les forfaits et exemptions ne comptent pas pour l\'Elo.' })}</section>`;
  }

  /* ---------------- Groupes de travail (hors séance) ---------------- */
  function groupsView(c) {
    const wg = c.workGroups;
    const courts = wg ? wg.courts : c.courts;
    const mode = wg ? wg.mode : 'balanced';
    const absent = wg ? wg.absent : [];
    const ranked = R.ranks(c);
    const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
    const st = R.computeStats(c);
    let result = '<div class="empty">Choisissez le nombre de terrains puis « Répartir ».</div>';
    if (wg && wg.groups.length) {
      const stats = R.workGroupStats(c);
      result = `<div class="courts-grid">${wg.groups.map((g, i) => { const sorted = g.slice().sort((x, y) => rankOf.get(x) - rankOf.get(y)); return `<div class="court-card wg-card"><div class="cc-head"><h3>Terrain ${i + 1}</h3><span class="badge">${g.length} élève(s)</span></div>
          ${courtDrawing(c, { left: sorted.filter((_, k) => k % 2 === 0), right: sorted.filter((_, k) => k % 2 === 1), state: 'group', clickable: true })}
          <div class="cc-foot"><div class="muted small">Elo moyen ${fmt(stats.groups[i].avg)}</div>
          <details class="wg-move"><summary>Déplacer un élève</summary>
          ${g.slice().sort((x, y) => rankOf.get(x) - rankOf.get(y)).map(id => `<div class="player"><button class="btn linkish" data-action="student" data-id="${id}">${rankOf.get(id)}. ${esc(nameOf(c, id))}</button>
            <label class="sr-only" for="wg_${id}">Terrain de ${esc(nameOf(c, id))}</label><select id="wg_${id}" data-action="wg-move" data-id="${id}">${wg.groups.map((_, j) => `<option value="${j}" ${j === i ? 'selected' : ''}>T${j + 1}</option>`).join('')}</select></div>`).join('')}</details></div></div>`; }).join('')}</div>
        <p class="muted small">Écart entre l'Elo moyen le plus haut et le plus bas : <b>${fmt(stats.spread)}</b>${mode === 'balanced' ? ' (plus il est faible, plus les terrains sont de niveau comparable)' : ''}. Les déplacements manuels sont conservés jusqu'à la prochaine répartition. Les groupes ne modifient jamais l'Elo.</p>`;
    }
    return `${demoNotice(c)}<section class="panel"><h2>Groupes de travail</h2>
      <p class="muted">Répartit les élèves présents sur les terrains disponibles selon le classement Elo, sans créer de séance.</p>
      <div class="row">
        <div class="field" style="flex:0 0 auto"><span class="small"><b>Terrains disponibles</b></span>
          <div class="row" style="gap:8px"><button class="btn mini" data-action="wg-courts" data-delta="-1" aria-label="Un terrain de moins" ${courts <= 1 ? 'disabled' : ''}>−</button><b class="courts-count" aria-live="polite">${courts}</b><button class="btn mini" data-action="wg-courts" data-delta="1" aria-label="Un terrain de plus" ${courts >= 30 ? 'disabled' : ''}>+</button></div></div>
        <div class="field"><label for="wgMode">Répartition</label><select id="wgMode" data-action="wg-mode">
          <option value="balanced" ${mode === 'balanced' ? 'selected' : ''}>Équilibrée : même niveau moyen sur chaque terrain (serpentin)</option>
          <option value="level" ${mode === 'level' ? 'selected' : ''}>Par niveau : les mieux classés au terrain 1</option></select></div>
      </div>
      <details ${absent.length ? 'open' : ''}><summary>Appel (${ranked.length - absent.length} présent(s) / ${ranked.length})</summary><div class="grid" style="margin-top:8px">${
        ranked.map(p => `<label class="player"><span>${rankOf.get(p.id)}. ${esc(p.name)} · Elo ${fmt(st[p.id].elo)}</span><span><input type="checkbox" style="width:auto" data-action="wg-absent" data-id="${p.id}" ${absent.includes(p.id) ? 'checked' : ''}> Absent</span></label>`).join('')}</div></details>
      <div class="actions" style="margin-top:12px"><button class="btn primary" data-action="wg-build">${wg ? 'Répartir à nouveau' : 'Répartir'}</button>${wg ? '<button class="btn" data-action="print">Imprimer</button>' : ''}</div>
      <p class="muted small">Serpentin : 1ᵉʳ → T1, 2ᵉ → T2 … dernier terrain, puis retour en sens inverse, etc. Les effectifs diffèrent au plus d'un élève.</p></section>
      <section class="panel"><h2>Répartition</h2>${result}</section>`;
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
      <div class="field"><label for="sport">Sport (dessin des terrains)</label><select id="sport">${['Badminton', 'Tennis de table', 'Pickleball', 'Tennis', 'Padel', 'Autre'].map(v => `<option ${c.sport === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="courts">Nombre de terrains par défaut</label><input type="number" id="courts" min="1" max="30" value="${c.courts}"></div>
      <div class="field"><label for="k">Coefficient Elo K (par match)</label><input type="number" id="k" min="1" max="100" value="${c.k}"></div>
      <div class="field"><label for="initElo">Elo initial du cycle</label><input type="number" id="initElo" min="100" max="3000" value="${Number.isFinite(c.initialElo) ? c.initialElo : 1000}"></div></div>
      <button class="btn primary" data-action="save-settings">Enregistrer les réglages</button>
      <p class="muted small">K est mémorisé à la création de chaque séance : le modifier n'affecte pas les séances passées. ${anyClosed ? 'Modifier l\'Elo initial recalcule tout le cycle.' : ''} Le nombre de terrains par défaut s'applique aux prochaines séances ; pour la séance en cours, utilisez le réglage « Terrains disponibles » de l'onglet Séance.</p></section>
      <section class="panel"><h2>Tester cet appareil</h2><p class="muted small">Vérifie sur la tablette : stockage, fonctionnement hors connexion, caméra et lecture des QR, écran. À faire avant la première séance.</p>
      <button class="btn primary" data-action="tab" data-tab="diagnostic">Tester cet appareil</button></section>
      <section class="panel"><h2>Sauvegarde et transfert</h2>
      <p class="muted small">Dernière sauvegarde : <b>${db.lastExportAt ? new Date(db.lastExportAt).toLocaleString('fr-FR') : 'jamais'}</b>${R.unsavedSessions(db) ? ' · <span class="bad">' + R.unsavedSessions(db) + ' séance(s) clôturée(s) depuis</span>' : ''}.</p>
      <div class="actions"><button class="btn primary" data-action="export-json">Sauvegarder toutes les classes</button>
      <button class="btn" data-action="export-class">Exporter seulement « ${esc(c.name)} »</button>
      ${canShareFiles() ? '<button class="btn" data-action="share-backup">Partager la sauvegarde…</button>' : ''}
      <button class="btn" data-action="export-csv">Classement CSV</button>
      <label class="btn">Importer une sauvegarde<input type="file" id="importFile" accept="application/json,.json" style="display:none"></label></div>
      <p class="muted small">Pour passer sur un autre appareil : exportez la classe, envoyez le fichier (ENT, clé USB, partage), puis importez-le sur l'autre appareil. L'import <b>ajoute</b> les classes du fichier ; pour une classe déjà présente, vous choisissez de la remplacer, de garder les deux ou de l'ignorer. Les autres classes ne sont jamais touchées.</p></section>
      <section class="panel"><h2>QR codes des tablettes</h2>
      <div class="field"><label for="publicUrl">Adresse web de l'application (ouverte par les tablettes)</label><input id="publicUrl" type="url" placeholder="https://…" value="${esc(db.publicUrl || '')}"></div>
      <p class="muted small">Adresse utilisée : <b>${esc(publicBase() || 'aucune')}</b>. Laissez vide pour utiliser l'adresse de cette page${location.protocol === 'file:' ? ' — <span class="bad">ouverte en fichier local, elle n\'est pas accessible aux tablettes : indiquez l\'adresse Vercel</span>' : ''}. Lecture des QR par la caméra : ${scanBackend() === 'native' ? 'lecteur intégré du navigateur' : (scanBackend() === 'racket' ? 'lecteur de l\'application (fonctionne aussi sur iPad et Windows)' : '<span class="bad">indisponible</span>')}.</p>
      <button class="btn" data-action="save-url">Enregistrer l'adresse</button></section>
      <section class="panel"><h2>Gestion</h2><button class="btn danger" data-action="delete-class">Supprimer cette classe et ses données</button></section>`;
  }

  /* ---------------- Tester cet appareil ---------------- */
  function canShareFiles() {
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File(['{}'], 't.json', { type: 'application/json' })] })); } catch (e) { return false; }
  }

  function diagnostic() {
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    const row = (id, label, value) => `<div class="diag-row"><span class="diag-label">${label}</span><span class="diag-val" id="${id}">${value}</span></div>`;
    setTimeout(updateDiagnostic, 0);
    return `<section class="panel"><div class="row between"><h2>Tester cet appareil</h2><span class="chip">Version ${APP_VERSION}</span></div>
      ${row('dg-storage', 'Stockage des données', '…')}
      ${row('dg-persist', 'Protection contre l\'effacement', '…')}
      ${row('dg-offline', 'Fonctionnement hors connexion', '…')}
      ${row('dg-install', 'Application installée', installed ? '✓ Oui, ouverte depuis l\'écran d\'accueil' : '⚠ Non : sur iPad, Partager → « Sur l\'écran d\'accueil » ; sur Android, menu → « Installer l\'application ». Installée, l\'application garde mieux ses données.')}
      ${row('dg-qr', 'Lecture des QR par la caméra', scanBackend() === 'native' ? '✓ Lecteur intégré du navigateur' : (scanBackend() === 'racket' ? '✓ Lecteur de l\'application' : '⚠ Indisponible : saisie du code'))}
      ${row('dg-camera', 'Caméra', '<button type="button" class="btn" data-action="scan-test">Tester la caméra</button> <span class="muted small">Filmez un QR de l\'application (projection, autre tablette).</span>')}
      ${row('dg-screen', 'Écran', window.innerWidth + ' × ' + window.innerHeight + ' px · ' + (touch ? '✓ tactile' : 'sans écran tactile') + ' · ' + (window.innerWidth >= window.innerHeight ? 'paysage' : 'portrait'))}
      ${row('dg-url', 'Adresse pour les tablettes (QR)', publicBase() ? '✓ ' + esc(publicBase()) : '⚠ Aucune : indiquez l\'adresse web dans Réglages → QR codes')}
      <div class="actions" style="margin-top:12px"><button type="button" class="btn" data-action="persist">Protéger les données de l'appareil</button><button type="button" class="btn" data-action="tab" data-tab="settings">Retour aux réglages</button></div></section>
      <section class="panel"><h2>Protocole d'essai en classe (15 minutes)</h2>
      <ol class="protocol">
        <li>Ouvrir l'application <b>avec Internet</b>, l'installer sur l'écran d'accueil, puis vérifier ici « hors connexion : prête ».</li>
        <li>Créer une <b>classe exemple</b> (24 élèves, 2 séances) et ouvrir le classement : graphiques et fiches s'affichent.</li>
        <li>Couper le Wi-Fi, fermer puis rouvrir l'application : elle doit s'ouvrir et retrouver les données.</li>
        <li>Lancer une séance « Poules classiques » sur 4 terrains : faire l'appel en touchant les tuiles, valider.</li>
        <li>Toucher un terrain, saisir un score avec « X gagne : 11 » et « + », valider : le terrain passe au match suivant.</li>
        <li>Afficher le <b>QR d'une poule</b>, le scanner avec une tablette élève, jouer deux matchs, terminer la poule.</li>
        <li>Sur l'appareil du professeur, <b>mode scan</b> : filmer le QR de résultat de la tablette ; les résultats s'enregistrent. Noter la distance et la lumière qui fonctionnent.</li>
        <li>Ouvrir la projection (si vidéoprojecteur) : lisibilité depuis le fond du gymnase.</li>
        <li>Clôturer la séance, puis <b>sauvegarder</b> (bouton en haut) et vérifier le fichier.</li>
        <li>Noter ce qui a gêné (boutons trop petits, lenteur, reflets) pour l'ajuster.</li>
      </ol></section>`;
  }

  async function updateDiagnostic() {
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    // Stockage : écriture/lecture réelles, puis espace disponible
    let storage;
    try {
      localStorage.setItem('racket_eps_test', 'ok');
      const okRW = localStorage.getItem('racket_eps_test') === 'ok';
      localStorage.removeItem('racket_eps_test');
      storage = okRW ? '✓ Enregistrement local opérationnel' : '⚠ Lecture impossible';
    } catch (e) { storage = '⚠ Stockage indisponible (navigation privée ?) : les données seraient perdues'; }
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const used = JSON.stringify(db).length;
        storage += ` · données : ${(used / 1024).toFixed(0)} Ko` + (est.quota ? ` · espace disponible : ${(est.quota / 1048576).toFixed(0)} Mo` : '');
      }
    } catch (e) { /* ignore */ }
    set('dg-storage', storage);
    try {
      const p = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
      set('dg-persist', p === null ? 'Information indisponible sur ce navigateur' : (p ? '✓ Données protégées (le navigateur ne les effacera pas pour libérer de la place)' : '⚠ Non protégées : touchez « Protéger les données » ou installez l\'application'));
    } catch (e) { set('dg-persist', 'Information indisponible'); }
    if (!offline.supported) set('dg-offline', location.protocol === 'file:' ? '⚠ Ouverte en fichier local : le mode hors connexion fonctionne avec l\'adresse web (https)' : '⚠ Non pris en charge par ce navigateur');
    else {
      let cached = false;
      try { cached = (await caches.keys()).some(k => k.indexOf('racket-eps-app') === 0); } catch (e) { /* ignore */ }
      set('dg-offline', cached && navigator.serviceWorker.controller ? '✓ Prête : l\'application s\'ouvre sans réseau' : (cached ? '✓ Copie locale enregistrée ; rechargez une fois la page pour l\'activer' : '… Préparation en cours (gardez la page ouverte avec Internet)'));
    }
  }

  /* ---------------- Graphiques d'évolution (SVG natif, une série, survol + clavier) ---------------- */
  const CHART = { line: '#2a9d80', grid: '#213a4f', axis: '#96aabd', text: '#c7d6e2', surface: '#102436' };

  function niceTicks(lo, hi, count, integer) {
    const span = hi - lo || 1;
    let step = Math.pow(10, Math.floor(Math.log10(span / count)));
    [1, 2, 5, 10].some(m => { if (span / (step * m) <= count) { step *= m; return true; } return false; });
    if (integer) step = Math.max(1, Math.round(step));
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }

  function lineChart(o) {
    const pts = o.points;
    if (pts.length < 2) return `<p class="muted small">Graphique disponible à partir de 2 séances clôturées (voir le tableau ci-dessous).</p>`;
    const W = 640, H = 230, L = 52, Rm = 70, T = 14, B = 30;
    let lo = o.min != null ? o.min : Math.min(...pts.map(p => p.v), o.baseline != null ? o.baseline : Infinity);
    let hi = o.max != null ? o.max : Math.max(...pts.map(p => p.v), o.baseline != null ? o.baseline : -Infinity);
    if (o.min == null) { const pad = Math.max(8, (hi - lo) * 0.12); lo -= pad; hi += pad; }
    if (hi === lo) hi = lo + 1;
    const X = i => L + (pts.length === 1 ? 0 : i * (W - L - Rm) / (pts.length - 1));
    const Y = v => o.invert ? T + (v - lo) / (hi - lo) * (H - T - B) : H - B - (v - lo) / (hi - lo) * (H - T - B);
    const ticks = niceTicks(lo, hi, 4, o.integer);
    if (o.min != null && !ticks.includes(o.min)) ticks.unshift(o.min); // ex. la 1re place toujours graduée
    const every = Math.ceil(pts.length / 12);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    const data = esc(JSON.stringify(pts.map((p, i) => ({ x: X(i), y: Y(p.v), label: p.label, value: o.fmtVal(p.v) }))));
    return `<figure class="chart" id="${o.id}" tabindex="0" data-points="${data}" aria-label="${esc(o.name)} par séance : ${pts.map(p => p.x + ' ' + o.fmtVal(p.v)).join(', ')}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">
        ${ticks.map(t => `<line x1="${L}" x2="${W - Rm}" y1="${Y(t)}" y2="${Y(t)}" stroke="${CHART.grid}" stroke-width="1"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end" fill="${CHART.axis}" font-size="11">${o.integer ? t : Math.round(t)}</text>`).join('')}
        ${o.baseline != null ? `<line x1="${L}" x2="${W - Rm}" y1="${Y(o.baseline)}" y2="${Y(o.baseline)}" stroke="${CHART.axis}" stroke-width="1" stroke-dasharray="4 4"/><text x="${W - Rm + 6}" y="${Y(o.baseline) + 4}" fill="${CHART.axis}" font-size="11">${esc(o.baselineLabel)}</text>` : ''}
        ${pts.map((p, i) => i % every === 0 || i === pts.length - 1 ? `<text x="${X(i)}" y="${H - 10}" text-anchor="middle" fill="${CHART.axis}" font-size="11">${esc(p.x)}</text>` : '').join('')}
        <path d="${d}" fill="none" stroke="${CHART.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.v)}" r="4" fill="${p.hollow ? CHART.surface : CHART.line}" stroke="${p.hollow ? CHART.line : CHART.surface}" stroke-width="2"/>`).join('')}
        <text x="${X(pts.length - 1) + 10}" y="${Y(last.v) + 4}" fill="${CHART.text}" font-size="12" font-weight="700">${esc(o.fmtVal(last.v))}</text>
        <line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="${CHART.axis}" stroke-width="1" visibility="hidden"/>
        <rect class="hit" x="${L - 20}" y="0" width="${W - L - Rm + 40}" height="${H}" fill="transparent"/>
      </svg>
      <div class="tip" hidden><b class="tip-v"></b><span class="tip-l"></span></div>
      <figcaption class="muted small">${o.invert ? 'Le haut du graphique correspond à la 1ʳᵉ place. ' : ''}Points creux : séance où l'élève était absent. Survolez ou utilisez les flèches du clavier pour lire chaque valeur.</figcaption>
    </figure>`;
  }

  function showTip(fig, idx) {
    const pts = JSON.parse(fig.dataset.points);
    idx = Math.max(0, Math.min(pts.length - 1, idx));
    fig.dataset.idx = idx;
    const p = pts[idx], svg = fig.querySelector('svg'), box = svg.getBoundingClientRect(), scale = box.width / svg.viewBox.baseVal.width;
    const xh = fig.querySelector('.xhair');
    xh.setAttribute('x1', p.x); xh.setAttribute('x2', p.x); xh.setAttribute('visibility', 'visible');
    const tip = fig.querySelector('.tip');
    tip.querySelector('.tip-v').textContent = p.value;
    tip.querySelector('.tip-l').textContent = p.label;
    tip.hidden = false;
    const left = Math.min(Math.max(0, p.x * scale - 70), box.width - 150);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, p.y * scale - 58) + 'px';
  }
  function hideTip(fig) { fig.querySelector('.tip').hidden = true; fig.querySelector('.xhair').setAttribute('visibility', 'hidden'); }

  document.addEventListener('pointermove', e => {
    const fig = e.target.closest && e.target.closest('figure.chart');
    if (!fig) return;
    const pts = JSON.parse(fig.dataset.points), svg = fig.querySelector('svg'), box = svg.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width * svg.viewBox.baseVal.width;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i; });
    showTip(fig, best);
  });
  document.addEventListener('pointerout', e => { const fig = e.target.closest && e.target.closest('figure.chart'); if (fig && !fig.contains(e.relatedTarget)) hideTip(fig); });
  document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('figure.chart')) showTip(e.target, JSON.parse(e.target.dataset.points).length - 1); });
  document.addEventListener('focusout', e => { if (e.target.matches && e.target.matches('figure.chart')) hideTip(e.target); });

  /* ---------------- Mode projection (lecture seule, à afficher sur un second écran) ---------------- */
  function renderProjection() {
    document.body.classList.add('projection');
    const c = cl(), s = c && R.activeSession(c);
    let html;
    if (!s || s.status !== 'playing') {
      html = `<div class="proj-empty">${c ? esc(c.name) + ' — ' : ''}aucune séance en cours</div>`;
    } else {
      const name = id => esc(nameOf(c, id));
      const courts = [];
      for (const t of R.availableCourts(c, s)) {
        const m = s.matches.find(x => x.court === t && !x.done);
        const qr = m && s.projQr !== false && s.qrToken && publicBase() ? qrSVG(sheetURL(c, s, m), 150) : null;
        const bench = m ? benchFor(s, m) : [];
        courts.push(`<div class="proj-court ${m ? 'busy' : ''}"><div class="proj-row"><div class="proj-t">Terrain ${t}</div>${qr ? `<div class="proj-qr" aria-label="QR code de la feuille de match">${qr}</div>` : ''}</div>
          ${m ? courtDrawing(c, { left: [m.a], right: [m.b], state: 'playing', big: true }) : courtDrawing(c, { state: 'free', big: true })}
          ${bench.length ? `<div class="proj-bench">Sur le banc : ${bench.map(name).join(', ')}</div>` : ''}</div>`);
      }
      const queue = s.matches.map((m, i) => ({ m, i })).filter(x => R.matchState(x.m) === 'waiting').sort((a, b) => (a.m.round - b.m.round) || (a.i - b.i)).slice(0, 8).map(x => x.m);
      const roundInfo = ['swiss', 'ladder'].includes(s.mode) ? ` · ${s.mode === 'ladder' ? 'rotation' : 'ronde'} ${s.round}/${s.rounds}` : (s.mode === 'reclass' ? ' · ' + (s.phase === 'classement' ? 'tableaux de classement' : 'brassage') : '');
      const done = s.matches.filter(m => m.done).length;
      let extra = '';
      if (s.mode === 'ladder') {
        const moves = s.moves.filter(mv => mv.round === s.round);
        extra = `<h2>Placement de la rotation ${s.round}</h2><div class="proj-groups">${s.groups.map((g, i) => `<div><b>T${i + 1}</b> ${g.map(id => { const mv = moves.find(x => x.id === id); return name(id) + (mv ? (mv.to < mv.from ? ' ↑' : ' ↓') : ''); }).join(' · ')}</div>`).join('')}</div>`;
      }
      if (s.projShowStandings) {
        if (s.mode === 'pools') extra += `<h2>Classement des poules</h2><div class="proj-groups">${s.groups.map((g, gi) => `<div><b>Groupe ${gi + 1}</b> ${R.rankGroup(s, g, m => m.group === gi).map(x => x.rank + '. ' + name(x.id) + ' (' + x.wins + ' V)').join(' · ')}</div>`).join('')}</div>`;
        else if (s.mode === 'challenge') extra += `<h2>Rang local</h2><div class="proj-groups"><div>${R.challengeOrder(s).map((id, i) => (i + 1) + '. ' + name(id)).join(' · ')}</div></div>`;
        else if (s.mode === 'reclass' && s.phase === 'classement') { const pl = R.reclassPlaces(s); extra += `<h2>Places attribuées</h2><div class="proj-groups"><div>${s.positions.filter(id => pl.has(id)).sort((a, b) => pl.get(a) - pl.get(b)).map(id => pl.get(id) + '. ' + name(id)).join(' · ') || '—'}</div></div>`; }
        else if (s.mode !== 'ladder') { const st = s.mode === 'reclass' ? R.brassageRanking(s) : R.sessionStandings(c, s); extra += `<h2>Classement de la séance</h2><div class="proj-groups"><div>${st.map(x => x.rank + '. ' + name(x.id) + ' (' + x.points + ' pt' + (x.points > 1 ? 's' : '') + ')').join(' · ')}</div></div>`; }
      }
      html = `<header class="proj-head"><div>${esc(R.MODES[s.mode])}${roundInfo}</div><div class="proj-prog">${done} / ${s.matches.length} matchs</div></header>
        <div class="proj-courts">${courts.join('')}</div>
        ${s.mode === 'pools' && s.projQr !== false && s.qrToken && publicBase() ? `<h2>QR des poules — jouez tous vos matchs puis présentez le résultat</h2><div class="proj-pools">${s.groups.map((g, gi) => {
          const svg = qrSVG(poolSheetURL(c, s, gi), 170);
          return `<div class="proj-pool">${svg ? `<div class="proj-qr">${svg}</div>` : ''}<div><div class="proj-t">Poule ${gi + 1}</div><div class="proj-pool-names">${g.map(name).join(' · ')}</div></div></div>`;
        }).join('')}</div>` : `<h2>À suivre</h2>${queue.length ? `<ol class="proj-queue">${queue.map(m => `<li>${name(m.a)} – ${name(m.b)}</li>`).join('')}</ol>` : '<p class="proj-free">Aucun match en attente</p>'}`}
        ${extra}`;
    }
    $('view').innerHTML = html + `<div class="proj-tools"><button class="btn" data-action="proj-fullscreen">Plein écran (F)</button><button class="btn" data-action="proj-close">Fermer</button></div>`;
  }

  /* ---------------- QR codes : génération, feuille de match (tablette), mode scan ---------------- */
  function publicBase() {
    if (db && db.publicUrl) return db.publicUrl.split('#')[0];
    return /^https?:$/.test(location.protocol) ? location.href.split('#')[0] : '';
  }
  function sheetURL(c, s, m) { return publicBase() + '#f=' + R.encodeSheet(R.sheetData(c, s, m)); }

  // QR en SVG (générateur maison qr.js) ; null en cas d'échec (texte trop long).
  function qrSVG(text, size) {
    if (!window.RacketQR) return null;
    try { return window.RacketQR.toSVG(text, size); } catch (e) { return null; }
  }

  function poolSheetURL(c, s, gi) { return publicBase() + '#p=' + R.encodeSheet(R.poolSheetData(c, s, gi)); }

  function showQRForPool(gi) {
    const c = cl(), s = R.activeSession(c);
    if (!s || !s.groups || !s.groups[gi]) return;
    if (!s.qrToken) { R.ensureQrToken(s); save(); }
    const dlg = $('qrDialog'), base = publicBase();
    const url = base ? poolSheetURL(c, s, gi) : '';
    const svg = url ? qrSVG(url, 340) : null;
    dlg.innerHTML = `<div class="qr-box"><h2 id="qrTitle">Poule ${gi + 1}</h2>
      <p class="small">${s.groups[gi].map(id => esc(nameOf(c, id))).join(' · ')} — ${R.groupMatches(s, gi).length} matchs</p>
      ${!base ? `<p class="bad">L'application est ouverte en fichier local : indiquez son adresse web (Réglages → QR codes) pour que les tablettes puissent ouvrir la feuille de poule.</p>`
        : (svg ? `<div class="qr-img">${svg}</div><p class="muted small">La tablette affiche tous les matchs de la poule. Les élèves les jouent, saisissent les scores, puis présentent un seul QR de résultat au mode scan.</p>` : `<p class="bad">QR code impossible à générer.</p>`)}
      ${url ? `<p class="small qr-link"><a href="${esc(url)}" target="_blank" rel="noopener">Ouvrir la feuille de poule</a></p>` : ''}
      <div class="actions"><button class="btn primary" data-action="qr-close">Fermer</button></div></div>`;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  /* --- Feuille de poule sur la tablette (#p=…) : tous les matchs de la poule --- */
  let pool = null;
  function poolKey(d) { return 'racket_eps_poule_' + d.s + '_' + d.g; }
  function loadPool() {
    let d;
    try { d = R.decodePoolSheet(location.hash.slice(3)); } catch (e) { return { error: e.message }; }
    let st = { res: d.pairs.map(() => ({ sa: 0, sb: 0, forfeit: null, done: false })), finished: false };
    try {
      const saved = JSON.parse(localStorage.getItem(poolKey(d)) || 'null');
      if (saved && Array.isArray(saved.res) && saved.res.length === d.pairs.length) st = saved;
    } catch (e) { /* ignore */ }
    return { d, st };
  }
  function savePool() { try { localStorage.setItem(poolKey(pool.d), JSON.stringify(pool.st)); } catch (e) { /* ignore */ } }
  function poolResults() {
    return pool.st.res.map(r => (!r.done ? null : (r.forfeit ? { forfeit: r.forfeit } : { sa: r.sa, sb: r.sb })));
  }

  function renderPoolSheet() {
    document.body.classList.add('sheet-mode');
    if (!pool) pool = loadPool();
    if (pool.error) { $('view').innerHTML = `<section class="panel"><h2>Feuille de poule illisible</h2><p>${esc(pool.error)} Rescannez le QR code de la poule.</p></section>`; return; }
    const { d, st } = pool;
    const done = st.res.filter(r => r.done).length;
    // Mini-classement en direct (victoires) pour motiver les élèves
    const wins = d.p.map(() => 0);
    st.res.forEach((r, i) => {
      if (!r.done) return;
      const [a, b] = d.pairs[i];
      const aWins = r.forfeit ? r.forfeit === 'b' : r.sa > r.sb;
      wins[aWins ? a : b]++;
    });
    const order = d.p.map((n, i) => ({ n, w: wins[i] })).sort((x, y) => y.w - x.w);
    const head = `<div class="sheet-head">Séance ${esc(d.n)} · Poule ${d.g + 1} · score cible ${esc(d.t)}</div>`;
    if (st.finished) {
      let code = '', err = '';
      try { code = R.poolResultCode(d, poolResults()); } catch (e) { err = e.message; }
      const svg = code ? qrSVG(code, 300) : null;
      $('view').innerHTML = `<section class="panel sheet">${head}<h2>Résultats de la poule à faire valider</h2>
        ${err ? `<p class="bad">${esc(err)}</p>` : `${svg ? `<div class="qr-img">${svg}</div>` : ''}<p class="sheet-code" aria-label="Code de résultat de la poule">${esc(code)}</p>
        <p class="muted">Présentez ce QR code au professeur (mode scan) : tous les résultats de la poule seront enregistrés d'un coup.</p>`}
        <div class="tablewrap"><table><thead><tr><th>Match</th><th>Résultat</th></tr></thead><tbody>${d.pairs.map(([a, b], i) => {
          const r = st.res[i];
          const txt = !r.done ? 'non joué' : (r.forfeit ? 'forfait de ' + (r.forfeit === 'a' ? d.p[a] : d.p[b]) : r.sa + ' – ' + r.sb);
          return `<tr><td>${esc(d.p[a])} – ${esc(d.p[b])}</td><td>${esc(txt)}</td></tr>`;
        }).join('')}</tbody></table></div>
        <button class="btn sheet-finish" data-action="pool-edit">Modifier des scores</button></section>`;
      return;
    }
    const cards = d.pairs.map(([a, b], i) => {
      const r = st.res[i];
      if (r.done) {
        const txt = r.forfeit ? 'Forfait de ' + (r.forfeit === 'a' ? d.p[a] : d.p[b]) : d.p[a] + ' ' + r.sa + ' – ' + r.sb + ' ' + d.p[b];
        return `<div class="pool-match done"><div class="pm-head"><b>Match ${i + 1}</b><span class="badge pm-ok">✓ Terminé</span></div>
          <div class="pm-result">${esc(txt)}</div>
          <button class="btn" data-action="pool-reopen" data-i="${i}">Modifier</button></div>`;
      }
      const row = (side, idx, val) => `<div class="pm-row"><span class="pm-name">${esc(d.p[idx])}</span>
        <span class="pm-score"><button class="btn pm-btn" data-action="pool-step" data-i="${i}" data-side="${side}" data-delta="-1" aria-label="Retirer un point à ${esc(d.p[idx])}">−</button>
        <output aria-live="polite">${val}</output>
        <button class="btn pm-btn primary" data-action="pool-step" data-i="${i}" data-side="${side}" data-delta="1" aria-label="Ajouter un point à ${esc(d.p[idx])}">+</button></span></div>`;
      return `<div class="pool-match"><div class="pm-head"><b>Match ${i + 1}</b><span class="badge">À jouer</span></div>
        ${row('a', a, r.sa)}${row('b', b, r.sb)}
        <p class="bad pm-err" id="pmErr${i}" role="alert"></p>
        <div class="actions"><button class="btn primary pm-validate" data-action="pool-validate" data-i="${i}">Valider ce match</button>
        <details class="more"><summary>Forfait</summary><div class="actions">
          <button class="btn" data-action="pool-forfeit" data-i="${i}" data-side="a">Forfait de ${esc(d.p[a])}</button>
          <button class="btn" data-action="pool-forfeit" data-i="${i}" data-side="b">Forfait de ${esc(d.p[b])}</button></div></details></div></div>`;
    }).join('');
    $('view').innerHTML = `<section class="panel sheet pool-sheet">${head}
      <div class="row between"><h2 style="margin:0">Tous les matchs de la poule</h2><span class="badge">${done} / ${d.pairs.length} terminés</span></div>
      <div class="pool-rank" aria-label="Victoires dans la poule">${order.map(x => `<span class="bench-chip">${esc(x.n)} · ${x.w} V</span>`).join('')}</div>
      <div class="pool-grid">${cards}</div>
      <button class="btn primary sheet-finish" data-action="pool-finish" ${done ? '' : 'disabled'}>Terminer la poule et afficher le QR de résultat</button>
      <p class="muted small">Les scores ne sont enregistrés qu'après le scan par le professeur. Cette page garde vos scores si elle se recharge.</p></section>`;
  }

  function showQRForMatch(id) {
    const c = cl(), s = R.activeSession(c), m = s && s.matches.find(x => x.id === id);
    if (!m) return;
    if (!s.qrToken) { R.ensureQrToken(s); save(); }
    const dlg = $('qrDialog');
    const base = publicBase();
    const url = base ? sheetURL(c, s, m) : '';
    const svg = url ? qrSVG(url, 320) : null;
    dlg.innerHTML = `<div class="qr-box"><h2 id="qrTitle">${m.court ? 'Terrain ' + m.court + ' · ' : ''}${esc(nameOf(c, m.a))} contre ${esc(nameOf(c, m.b))}</h2>
      ${!base ? `<p class="bad">L'application est ouverte en fichier local : indiquez son adresse web (Réglages → QR codes) pour que les tablettes puissent ouvrir la feuille de match.</p>`
        : (svg ? `<div class="qr-img">${svg}</div><p class="muted small">Scannez avec l'appareil photo de la tablette : la feuille de match s'ouvre, puis le résultat s'affiche en QR à présenter au mode scan.</p>`
          : `<p class="bad">QR code impossible à générer. Lien de la feuille de match :</p>`)}
      ${url ? `<p class="small qr-link"><a href="${esc(url)}" target="_blank" rel="noopener">Ouvrir la feuille de match</a></p>` : ''}
      <div class="actions"><button class="btn primary" data-action="qr-close">Fermer</button></div></div>`;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  /* --- Feuille de match sur la tablette de l'élève (#f=…) : aucune donnée de la classe --- */
  let sheet = null;
  function sheetKey(d) { return 'racket_eps_feuille_' + d.s + '_' + d.m; }
  function loadSheet() {
    let d;
    try { d = R.decodeSheet(location.hash.slice(3)); } catch (e) { return { error: e.message }; }
    let st = { sa: 0, sb: 0, finished: null };
    try { st = Object.assign(st, JSON.parse(localStorage.getItem(sheetKey(d)) || '{}')); } catch (e) { /* ignore */ }
    return { d, st };
  }
  function saveSheet() { try { localStorage.setItem(sheetKey(sheet.d), JSON.stringify(sheet.st)); } catch (e) { /* ignore */ } }

  function renderSheet() {
    document.body.classList.add('sheet-mode');
    if (!sheet) sheet = loadSheet();
    if (sheet.error) { $('view').innerHTML = `<section class="panel"><h2>Feuille de match illisible</h2><p>${esc(sheet.error)} Rescannez le QR code du match.</p></section>`; return; }
    const { d, st } = sheet;
    const head = `<div class="sheet-head">Séance ${esc(d.n)}${d.t ? ' · Terrain ' + esc(d.t) : ''} · score cible ${esc(d.g)}</div>`;
    if (st.finished) {
      let code = '', err = '';
      try { code = R.resultCode(d, st.finished); } catch (e) { err = e.message; }
      const svg = code ? qrSVG(code, 280) : null;
      const label = st.finished.forfeit ? 'Forfait de ' + (st.finished.forfeit === 'a' ? d.a : d.b) : d.a + ' ' + st.finished.sa + ' – ' + st.finished.sb + ' ' + d.b;
      $('view').innerHTML = `<section class="panel sheet">${head}<h2>Résultat à faire valider</h2><p class="sheet-result">${esc(label)}</p>
        ${err ? `<p class="bad">${esc(err)}</p>` : `${svg ? `<div class="qr-img">${svg}</div>` : ''}<p class="sheet-code" aria-label="Code de résultat">${esc(code)}</p>
        <p class="muted">Présentez ce QR code au professeur (mode scan), ou dictez-lui le code ci-dessus.</p>`}
        <button class="btn" data-action="sheet-edit">Modifier le score</button></section>`;
      return;
    }
    const row = (side, name, val) => `<div class="sheet-player"><div class="sheet-name">${esc(name)}</div>
      <div class="sheet-score"><button class="btn sheet-btn" data-action="sheet-step" data-side="${side}" data-delta="-1" aria-label="Retirer un point à ${esc(name)}">−</button>
      <output aria-live="polite" aria-label="Score de ${esc(name)}">${val}</output>
      <button class="btn sheet-btn primary" data-action="sheet-step" data-side="${side}" data-delta="1" aria-label="Ajouter un point à ${esc(name)}">+</button></div></div>`;
    $('view').innerHTML = `<section class="panel sheet">${head}${row('a', d.a, st.sa)}${row('b', d.b, st.sb)}
      <p class="bad" id="sheetErr" role="alert"></p>
      <button class="btn primary sheet-finish" data-action="sheet-finish">Terminer le match</button>
      <details class="more"><summary>Forfait</summary><div class="actions">
        <button class="btn" data-action="sheet-forfeit" data-side="a">Forfait de ${esc(d.a)}</button>
        <button class="btn" data-action="sheet-forfeit" data-side="b">Forfait de ${esc(d.b)}</button></div></details>
      <p class="muted small">Le score n'est enregistré qu'après le scan par le professeur.</p></section>`;
  }

  /* --- Mode scan (appareil de l'enseignant) : petite fenêtre avec aperçu caméra --- */
  const scan = { panel: null, stream: null, timer: null, busy: false, last: '', lastAt: 0, detector: null, auto: true };
  // Lecture caméra : lecteur QR intégré au navigateur (BarcodeDetector) ; sinon saisie du code.
  // Lecture caméra : lecteur intégré du navigateur s'il existe, sinon lecteur maison (qrdecode.js).
  function scanBackend() {
    if (typeof window.BarcodeDetector === 'function') return 'native';
    return window.RacketQRDecode ? 'racket' : 'none';
  }
  function beep(ok) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08;
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.12 : 0.3));
    } catch (e) { /* ignore */ }
    if (!ok && navigator.vibrate) navigator.vibrate(200);
  }
  function scanStatus(msg, kind) {
    const el = scan.panel && scan.panel.querySelector('.scan-status');
    if (el) { el.textContent = msg; el.className = 'scan-status ' + (kind || ''); }
  }
  function scanResultCard(html) {
    const el = scan.panel && scan.panel.querySelector('.scan-result');
    if (el) el.innerHTML = html;
  }

  async function openScan() {
    if (scan.panel) return;
    const p = document.createElement('div');
    p.className = 'scan-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Mode scan des résultats');
    p.innerHTML = `<div class="row between"><b>📷 Mode scan</b><button class="btn mini" data-action="scan-close" aria-label="Fermer le mode scan">✕</button></div>
      <video playsinline muted autoplay></video>
      <div class="scan-status" role="status" aria-live="polite">Démarrage de la caméra…</div>
      <form class="row scan-form" data-form="scan-code"><label class="sr-only" for="scanCode">Code de résultat</label><input id="scanCode" placeholder="ou saisir le code RE1.…" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn mini" type="submit">OK</button></form>
      <label class="row small" style="gap:6px"><input type="checkbox" style="width:auto" data-action="scan-auto" ${scan.auto ? 'checked' : ''}> Enregistrer dès la lecture</label>
      <div class="scan-result"></div>`;
    document.body.appendChild(p);
    scan.panel = p;
    const backend = scanBackend();
    if (backend === 'none') { scanStatus('Lecture automatique non disponible sur ce navigateur : saisissez le code affiché sous le QR de la tablette.', 'warn'); p.querySelector('video').hidden = true; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { scanStatus('Caméra inaccessible (page non sécurisée ?) : saisissez le code.', 'warn'); p.querySelector('video').hidden = true; return; }
    try {
      scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) {
      scanStatus('Caméra refusée ou absente : autorisez-la, ou saisissez le code.', 'warn');
      p.querySelector('video').hidden = true;
      return;
    }
    if (!scan.panel) { scan.stream.getTracks().forEach(t => t.stop()); return; }
    const video = p.querySelector('video');
    video.srcObject = scan.stream;
    if (backend === 'native') { try { scan.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { scan.detector = null; } }
    scanStatus('Présentez le QR code de résultat de la tablette.', '');
    scan.timer = setInterval(async () => {
      if (scan.busy || !video.videoWidth) return;
      scan.busy = true;
      try {
        let text = null;
        if (scan.detector) {
          const codes = await scan.detector.detect(video);
          if (codes && codes.length) text = codes[0].rawValue;
        }
        if (!text && window.RacketQRDecode) {
          // Image réduite à 640 px de large au plus : assez pour lire, rapide sur tablette.
          const cw = Math.min(640, video.videoWidth), ch = Math.round(video.videoHeight * cw / video.videoWidth);
          scan.canvas = scan.canvas || document.createElement('canvas');
          scan.canvas.width = cw; scan.canvas.height = ch;
          const ctx = scan.canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, cw, ch);
          text = window.RacketQRDecode.decode(ctx.getImageData(0, 0, cw, ch));
        }
        if (text && (text !== scan.last || Date.now() - scan.lastAt > 4000)) { scan.last = text; scan.lastAt = Date.now(); handleScanned(text); }
      } catch (e) { /* image suivante */ }
      scan.busy = false;
    }, 300);
  }

  function closeScan() {
    if (scan.timer) clearInterval(scan.timer);
    if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
    if (scan.panel) scan.panel.remove();
    Object.assign(scan, { panel: null, stream: null, timer: null, detector: null, busy: false });
  }

  function describeInput(c, m, input) {
    return input.forfeit ? 'Forfait de ' + nameOf(c, input.forfeit) + ' (' + nameOf(c, m.a) + ' – ' + nameOf(c, m.b) + ')'
      : nameOf(c, m.a) + ' ' + input.sa + ' – ' + input.sb + ' ' + nameOf(c, m.b);
  }

  let pendingScan = null;
  function handleScanned(text, force) {
    if (scan.test) { beep(true); scanStatus('✓ QR lu : ' + String(text).slice(0, 60) + (String(text).length > 60 ? '…' : ''), 'ok'); return; }
    const c = cl(), s = c && R.activeSession(c);
    if (!scan.auto && !force) {
      if (String(text).trim().toUpperCase().indexOf('RP1.') === 0) {
        const pp = R.parsePoolResultCode(text);
        if (!pp.ok) { scanStatus(pp.error, 'err'); beep(false); return; }
        pendingScan = text;
        scanResultCard(`<div class="notice">Poule ${pp.g + 1} : ${pp.items.filter(x => x !== '-').length} résultat(s) sur ${pp.items.length}<div class="actions"><button class="btn primary mini" data-action="scan-confirm">Enregistrer</button><button class="btn mini" data-action="scan-ignore">Ignorer</button></div></div>`);
        scanStatus('Code de poule lu : vérifiez puis enregistrez.', '');
        return;
      }
      const p = R.parseResultCode(text);
      if (!p.ok) { scanStatus(p.error, 'err'); beep(false); return; }
      pendingScan = text;
      const m = s && s.matches.find(x => R.shortId(x.id) === p.mid);
      scanResultCard(`<div class="notice">${m ? esc(describeInput(c, m, p.forfeit ? { forfeit: p.y === 'a' ? m.a : m.b } : { sa: +p.x, sb: +p.y })) : 'Code lu'}<div class="actions"><button class="btn primary mini" data-action="scan-confirm">Enregistrer</button><button class="btn mini" data-action="scan-ignore">Ignorer</button></div></div>`);
      scanStatus('Code lu : vérifiez puis enregistrez.', '');
      return;
    }
    let res = R.applyAnyCode(c, s, text);
    if (!res.ok && res.needsConfirm) {
      if (!confirm(res.error)) { scanStatus('Résultat existant conservé.', ''); return; }
      res = R.applyAnyCode(c, s, text, { confirm: true });
    }
    if (!res.ok && res.needsConfirm) {
      // conséquences en aval (reclassement)
      if (!confirm(res.error + '\n\nConfirmer ?')) return;
      res = R.applyAnyCode(c, s, text, { confirm: true });
    }
    if (!res.ok) { scanStatus(res.error, 'err'); beep(false); return; }
    if (res.kind === 'pool') {
      if (!res.recorded) { scanStatus('Poule ' + (res.pool + 1) + ' : déjà enregistrée, rien ne change.', ''); return; }
      save(); render(); beep(true);
      scanStatus('✓ Poule ' + (res.pool + 1) + ' enregistrée', 'ok');
      scanResultCard(`<div class="notice">✓ Poule ${res.pool + 1} : ${res.recorded} résultat(s) enregistré(s)${res.unchanged ? ', ' + res.unchanged + ' déjà saisi(s)' : ''}${res.skipped ? ', ' + res.skipped + ' non joué(s)' : ''}.</div>`);
      return;
    }
    if (res.already) { scanStatus('Déjà enregistré : ' + describeInput(c, res.match, res.input), ''); return; }
    save(); render();
    beep(true);
    scanStatus('✓ Enregistré', 'ok');
    scanResultCard(`<div class="notice">✓ ${esc(describeInput(c, res.match, res.input))}<div class="actions"><button class="btn mini" data-action="scan-undo" data-id="${res.match.id}">Annuler cette saisie</button></div></div>`);
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
    'student': el => openFiche(el.dataset.id),
    'student-close': () => closeFiche(),
    'wg-courts': el => {
      const c = cl(), cur = c.workGroups ? c.workGroups.courts : c.courts;
      act(() => R.buildWorkGroups(c, { courts: cur + Number(el.dataset.delta) }));
    },
    'wg-build': () => act(() => R.buildWorkGroups(cl(), {}), 'Élèves répartis'),
    'print': () => window.print(),
    'add-class': () => {
      const name = prompt('Nom de la classe (ex. 3e B)');
      if (!name || !name.trim()) return;
      const c = { id: R.uid(), name: name.trim(), sport: 'Badminton', courts: 4, students: [], sessions: [], k: 32, initialElo: 1000 };
      db.classes.push(c); db.active = c.id; tab = 'students';
      save(); render();
    },
    'demo-class': () => {
      const n = prompt('Classe exemple : nombre d\'élèves fictifs (4 à 40)', '24');
      if (n == null) return;
      const k = prompt('Nombre de séances déjà jouées à simuler (0 à 12) — 0 pour une classe vierge', '3');
      if (k == null) return;
      const nn = Number(n), kk = Number(k);
      if (!(Number.isInteger(nn) && nn >= 4 && nn <= 40) || !(Number.isInteger(kk) && kk >= 0 && kk <= 12)) return toast('Valeurs invalides (4 à 40 élèves, 0 à 12 séances).', true);
      const c = R.createDemoClass({ students: nn, sessions: kk, seed: 'exemple-' + Date.now(), name: 'Classe exemple (fictive)' + (db.classes.some(x => x.demo) ? ' ' + (db.classes.filter(x => x.demo).length + 1) : '') });
      db.classes.push(c); db.active = c.id; tab = kk ? 'ranking' : 'dashboard';
      save(); render();
      toast('Classe exemple créée : ' + nn + ' élèves fictifs' + (kk ? ', ' + kk + ' séance(s) simulée(s)' : ''));
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
      const c = cl();
      act(() => R.createSession(c, Object.assign({}, draft, { date: $('sdate') ? $('sdate').value : today() })));
    },
    'draft': el => {
      const v = el.dataset.value;
      draft[el.dataset.key] = /^\d+$/.test(v) ? Number(v) : v;
      if (el.dataset.key === 'mode') draft.rounds = 4;
      render();
    },
    'draft-step': el => {
      const k = el.dataset.key;
      draft[k] = Math.max(Number(el.dataset.min), Math.min(Number(el.dataset.max), draft[k] + Number(el.dataset.delta)));
      render();
    },
    'toggle-absent': el => {
      const c = cl(), s = R.activeSession(c);
      act(() => R.setAbsent(c, s, el.dataset.id, !s.absent.includes(el.dataset.id)));
    },
    'all-present': () => {
      const c = cl(), s = R.activeSession(c);
      s.absent.slice().forEach(id => R.setAbsent(c, s, id, false));
      save(); render();
    },
    'score-sheet': el => openScoreSheet(el.dataset.id),
    'ss-step': el => { ss[el.dataset.side] = Math.max(0, Math.min(99, ss[el.dataset.side] + Number(el.dataset.delta))); renderScoreSheet(); },
    'ss-target': el => { ss[el.dataset.side] = R.activeSession(cl()).target || 11; renderScoreSheet(); },
    'ss-close': () => closeScoreSheet(),
    'ss-validate': () => {
      const c = cl(), s = R.activeSession(c), id = ss.id, v = { sa: ss.sa, sb: ss.sb };
      const r = act(o => R.recordResult(c, s, id, v, o), 'Score enregistré');
      if (r && r.ok) closeScoreSheet();
    },
    'ss-forfeit': el => {
      const c = cl(), s = R.activeSession(c), id = ss.id;
      if (!confirm('Enregistrer un forfait de ' + nameOf(c, el.dataset.loser) + ' ? Un forfait ne compte pas pour l\'Elo ni pour les points.')) return;
      const r = act(o => R.recordResult(c, s, id, { forfeit: el.dataset.loser }, o), 'Forfait enregistré');
      if (r && r.ok) closeScoreSheet();
    },
    'ss-clear': () => {
      if (!confirm('Effacer ce résultat ?')) return;
      const c = cl(), s = R.activeSession(c), id = ss.id;
      const r = act(o => R.clearResult(c, s, id, o), 'Résultat effacé');
      if (r && r.ok) closeScoreSheet();
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
      const r = act(() => R.closeSession(c, s), 'Séance clôturée — pensez à sauvegarder (bouton en haut)');
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
      save(); render(); toast('Réglages enregistrés');
    },
    'courts-step': el => {
      const c = cl(), s = R.activeSession(c);
      act(o => R.setSessionCourts(c, s, R.totalCourts(c, s) + Number(el.dataset.delta), o), 'Terrains : ' + (R.totalCourts(c, s) + Number(el.dataset.delta)));
    },
    'court-toggle': el => {
      const c = cl(), s = R.activeSession(c), closed = el.dataset.closed === '1';
      act(o => R.setCourtClosed(c, s, Number(el.dataset.court), closed, o), 'Terrain ' + el.dataset.court + (closed ? ' fermé' : ' rouvert'));
    },
    'qr-match': el => showQRForMatch(el.dataset.id),
    'qr-pool': el => showQRForPool(Number(el.dataset.group)),
    'pool-step': el => {
      const r = pool.st.res[Number(el.dataset.i)], k = el.dataset.side === 'a' ? 'sa' : 'sb';
      r[k] = Math.max(0, Math.min(999, r[k] + Number(el.dataset.delta)));
      savePool(); renderPoolSheet();
    },
    'pool-validate': el => {
      const i = Number(el.dataset.i), r = pool.st.res[i];
      const err = R.validateScore(r.sa, r.sb);
      if (err) { $('pmErr' + i).textContent = err; return; }
      r.forfeit = null; r.done = true; savePool(); renderPoolSheet();
    },
    'pool-forfeit': el => {
      const i = Number(el.dataset.i), [a, b] = pool.d.pairs[i];
      const who = el.dataset.side === 'a' ? pool.d.p[a] : pool.d.p[b];
      if (!confirm('Déclarer le forfait de ' + who + ' pour ce match ?')) return;
      Object.assign(pool.st.res[i], { forfeit: el.dataset.side, done: true }); savePool(); renderPoolSheet();
    },
    'pool-reopen': el => { const r = pool.st.res[Number(el.dataset.i)]; r.done = false; r.forfeit = null; savePool(); renderPoolSheet(); },
    'pool-finish': () => {
      const left = pool.st.res.filter(r => !r.done).length;
      if (left && !confirm(left + ' match(s) non joué(s) : ils ne seront pas transmis. Afficher quand même le QR de résultat ?')) return;
      pool.st.finished = true; savePool(); renderPoolSheet(); window.scrollTo(0, 0);
    },
    'pool-edit': () => { pool.st.finished = false; savePool(); renderPoolSheet(); },
    'qr-close': () => { const d = $('qrDialog'); if (d.close) d.close(); else d.removeAttribute('open'); },
    'scan-open': () => openScan(),
    'scan-close': () => { closeScan(); scan.test = false; },
    'scan-confirm': () => { if (pendingScan) { const t = pendingScan; pendingScan = null; scanResultCard(''); handleScanned(t, true); } },
    'scan-ignore': () => { pendingScan = null; scanResultCard(''); scanStatus('Code ignoré.', ''); },
    'scan-undo': el => {
      const c = cl(), s = R.activeSession(c);
      const r = R.clearResult(c, s, el.dataset.id, { confirm: true });
      if (!r.ok) return toast(r.error, true);
      save(); render(); scanResultCard(''); scanStatus('Saisie annulée.', '');
    },
    'save-url': () => {
      const v = $('publicUrl').value.trim();
      if (v && !/^https?:\/\//i.test(v)) return toast('L\'adresse doit commencer par https:// ou http://', true);
      db.publicUrl = v || null; save(); render(); toast('Adresse enregistrée');
    },
    'sheet-step': el => {
      const k = el.dataset.side === 'a' ? 'sa' : 'sb';
      sheet.st[k] = Math.max(0, Math.min(999, sheet.st[k] + Number(el.dataset.delta)));
      saveSheet(); renderSheet();
    },
    'sheet-finish': () => {
      const err = R.validateScore(sheet.st.sa, sheet.st.sb);
      if (err) { $('sheetErr').textContent = err; return; }
      if (!confirm('Terminer le match sur le score ' + sheet.d.a + ' ' + sheet.st.sa + ' – ' + sheet.st.sb + ' ' + sheet.d.b + ' ?')) return;
      sheet.st.finished = { sa: sheet.st.sa, sb: sheet.st.sb }; saveSheet(); renderSheet();
    },
    'sheet-forfeit': el => {
      const who = el.dataset.side === 'a' ? sheet.d.a : sheet.d.b;
      if (!confirm('Déclarer le forfait de ' + who + ' ?')) return;
      sheet.st.finished = { forfeit: el.dataset.side }; saveSheet(); renderSheet();
    },
    'sheet-edit': () => { sheet.st.finished = null; saveSheet(); renderSheet(); },
    'open-projection': () => {
      const w = window.open(location.href.split('#')[0] + '#projection', 'racket-projection');
      if (!w) toast('Fenêtre bloquée : autorisez les fenêtres surgissantes, ou ouvrez cette page avec #projection à la fin de l\'adresse.', true);
    },
    'proj-fullscreen': () => { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); },
    'proj-close': () => { window.close(); setTimeout(() => { location.hash = ''; location.reload(); }, 150); },
    'export-json': () => {
      download('racket-eps-sauvegarde-' + today() + '.json', JSON.stringify(db, null, 2), 'application/json');
      R.markExported(db); save(); render(); toast('Sauvegarde téléchargée');
    },
    'export-class': () => {
      const c = cl();
      download('racket-eps-' + c.name.replace(/[^a-z0-9]+/gi, '-') + '-' + today() + '.json', JSON.stringify(R.exportClass(db, c.id), null, 2), 'application/json');
      toast('Classe exportée');
    },
    'share-backup': async () => {
      const file = new File([JSON.stringify(db, null, 2)], 'racket-eps-sauvegarde-' + today() + '.json', { type: 'application/json' });
      try {
        await navigator.share({ files: [file], title: 'Sauvegarde Racket EPS' });
        R.markExported(db); save(); render(); toast('Sauvegarde partagée');
      } catch (e) { if (e && e.name !== 'AbortError') toast('Partage impossible : ' + e.message, true); }
    },
    'persist': async () => {
      try {
        const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
        toast(ok ? 'Données protégées sur cet appareil' : 'Le navigateur a refusé : installez l\'application sur l\'écran d\'accueil', !ok);
      } catch (e) { toast('Protection indisponible sur ce navigateur', true); }
      updateDiagnostic();
    },
    'scan-test': () => { closeScan(); scan.test = true; openScan(); },
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
    if (el.id === 'partition') { partitionKey = el.value; render(); return; }
    if (el.id === 'importFile') { importJSON(el); return; }
    const c = cl();
    if (el.dataset.action === 'wg-mode') { act(() => R.buildWorkGroups(c, { mode: el.value })); return; }
    if (el.dataset.action === 'wg-absent') {
      const prev = c.workGroups ? c.workGroups.absent : [];
      const absent = prev.filter(x => x !== el.dataset.id).concat(el.checked ? [el.dataset.id] : []);
      act(() => R.buildWorkGroups(c, { absent }));
      return;
    }
    if (el.dataset.action === 'wg-move') { act(() => R.moveWorkGroup(c, el.dataset.id, Number(el.value))); return; }
    if (el.dataset.action === 'proj-qr') { const s = R.activeSession(c); s.projQr = el.checked; save(); return; }
    if (el.dataset.action === 'scan-auto') { scan.auto = el.checked; return; }
    if (el.dataset.action === 'proj-standings') { const s = R.activeSession(c); s.projShowStandings = el.checked; save(); return; }
    if (el.dataset.action === 'move-group') { const s = R.activeSession(c); act(() => R.moveToGroup(s, el.dataset.id, Number(el.value))); }
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('figure.chart') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      showTip(e.target, Number(e.target.dataset.idx || 0) + (e.key === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (projection && (e.key === 'f' || e.key === 'F')) { handlers['proj-fullscreen'](); return; }
    if (e.key !== 'Enter') return;
    if (e.target.id === 'newStudent') handlers['add-student']();

  });

  $('studentDialog').addEventListener('click', e => { if (e.target.id === 'studentDialog') closeFiche(); });
  $('scoreDialog').addEventListener('click', e => { if (e.target.id === 'scoreDialog') closeScoreSheet(); });
  $('scoreDialog').addEventListener('close', () => { ss = null; });
  $('studentDialog').addEventListener('close', () => { if (ficheOpener && ficheOpener.focus && document.contains(ficheOpener)) ficheOpener.focus(); ficheOpener = null; });

  document.addEventListener('submit', e => {
    if (e.target.dataset && e.target.dataset.form === 'scan-code') {
      e.preventDefault();
      const input = e.target.querySelector('input');
      if (input.value.trim()) { handleScanned(input.value.trim()); input.value = ''; }
    }
  });

  async function importJSON(el) {
    const file = el.files[0];
    el.value = '';
    if (!file) return;
    try {
      const incoming = R.parseDB(await file.text());
      const plan = R.planImport(db, incoming);
      if (!plan.length) return toast('Ce fichier ne contient aucune classe.', true);
      const choices = {};
      for (const p of plan) {
        if (!p.exists) continue;
        if (confirm('La classe « ' + p.name + ' » existe déjà sur cet appareil (' + p.localSessions + ' séance(s) ; fichier : ' + p.sessions + ' séance(s)' + (p.incomingNewer ? ', plus récent' : '') + ').\n\nOK = la remplacer par celle du fichier\nAnnuler = autres choix')) choices[p.id] = 'replace';
        else choices[p.id] = confirm('Garder les deux (la classe du fichier sera importée comme copie) ?\n\nOK = garder les deux\nAnnuler = ignorer cette classe') ? 'copy' : 'skip';
      }
      try { localStorage.setItem(KEY_BAK, JSON.stringify(db)); } catch (e) { /* ignore */ }
      const res = R.applyImport(db, incoming, choices);
      db = res.db;
      if (!cl()) db.active = db.classes[0] ? db.classes[0].id : null;
      save(); render();
      const r = res.report;
      toast('Import : ' + [r.added && r.added + ' ajoutée(s)', r.replaced && r.replaced + ' remplacée(s)', r.copied && r.copied + ' copiée(s)', r.skipped && r.skipped + ' ignorée(s)'].filter(Boolean).join(', '));
    } catch (e) { toast('Import impossible : ' + e.message, true); }
  }

  if (projection) {
    // Lecture seule : relit la sauvegarde dès qu'elle change (autre fenêtre ou autre onglet).
    let last = null;
    const refresh = () => {
      let raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { return; }
      if (raw === last) return;
      last = raw;
      try { db = raw ? R.parseDB(raw) : R.emptyDB(); } catch (e) { return; }
      render();
    };
    setInterval(refresh, 1500);
    window.addEventListener('storage', e => { if (e.key === KEY) refresh(); });
  }
  window.addEventListener('hashchange', () => location.reload());

  window.addEventListener('storage', e => {
    if (projection || sheetMode) return;
    if (e.key === KEY) { storageError = 'Les données ont été modifiées dans un autre onglet : rechargez la page avant de continuer.'; render(); }
  });

  /* ---------------- Hors connexion (application installable) ---------------- */
  const APP_VERSION = '2.3.0';
  const offline = { supported: 'serviceWorker' in navigator && /^https?:$/.test(location.protocol), ready: false, error: null };
  if (offline.supported) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      offline.ready = !!(reg.active || navigator.serviceWorker.controller);
      navigator.serviceWorker.ready.then(() => { offline.ready = true; });
    }).catch(e => { offline.error = e.message; });
  }

  db = load();
  if (db.active && !cl()) db.active = db.classes[0] ? db.classes[0].id : null;
  render();
  window.__racket = { getDB: () => db };
})();
