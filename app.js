/*
 * Tournoi EPS — interface (DOM). Toute la logique de tournoi est dans engine.js ;
 * ce fichier ne fait qu'afficher l'état et appeler le moteur.
 */
(function () {
  'use strict';
  const E = window.TournoiEngine;

  /* ------------------------------------------------------------------ *
   * Persistance locale (localStorage, schéma versionné, sauvegarde de secours)
   * ------------------------------------------------------------------ */
  const KEY_INDEX = 'tournoiEPS.index';
  const KEY_UI = 'tournoiEPS.ui';
  const keyT = id => 'tournoiEPS.t.' + id;
  const keyBak = id => 'tournoiEPS.bak.' + id;

  const Store = {
    ok: (function () {
      try { const k = '__test__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; }
    })(),
    memory: new Map(),
    get(key) { if (!this.ok) return this.memory.get(key) || null; return localStorage.getItem(key); },
    set(key, value) { if (!this.ok) { this.memory.set(key, value); return; } localStorage.setItem(key, value); },
    del(key) { if (!this.ok) { this.memory.delete(key); return; } localStorage.removeItem(key); },
    list() {
      try { return JSON.parse(this.get(KEY_INDEX) || '[]'); } catch (e) { return []; }
    },
    load(id) {
      const raw = this.get(keyT(id));
      if (!raw) return null;
      try { return E.deserialize(raw); }
      catch (e) {
        const bak = this.get(keyBak(id));
        if (bak) {
          try { const s = E.deserialize(bak); toast('Sauvegarde principale illisible : version de secours restaurée.', true); return s; } catch (e2) { /* ignore */ }
        }
        toast('Tournoi illisible : ' + e.message, true);
        return null;
      }
    },
    save(state) {
      try {
        const prev = this.get(keyT(state.tournament.id));
        if (prev) this.set(keyBak(state.tournament.id), prev);
        this.set(keyT(state.tournament.id), E.serialize(state));
        const idx = this.list().filter(x => x.id !== state.tournament.id);
        idx.unshift({ id: state.tournament.id, name: state.tournament.name, date: state.tournament.date, updatedAt: Date.now() });
        this.set(KEY_INDEX, JSON.stringify(idx));
        ui.storageError = null;
        return true;
      } catch (e) {
        ui.storageError = 'Sauvegarde locale impossible (' + (e && e.name === 'QuotaExceededError' ? 'espace de stockage plein' : e.message) + '). Exportez le tournoi en JSON pour ne rien perdre.';
        return false;
      }
    },
    remove(id) {
      this.del(keyT(id)); this.del(keyBak(id));
      this.set(KEY_INDEX, JSON.stringify(this.list().filter(x => x.id !== id)));
    }
  };

  /* ------------------------------------------------------------------ *
   * État de l'interface
   * ------------------------------------------------------------------ */
  let state = null;
  const ui = {
    tab: 'config', division: null, zoom: 1, partitionKey: null, customSizes: '',
    dialogMatchId: null, storageError: null, externalChange: false, gym: false
  };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY_UI) || '{}'), { dialogMatchId: null, storageError: null, externalChange: false }); } catch (e) { /* ignore */ }

  const TABS = [
    { id: 'config', label: 'Configuration' },
    { id: 'swiss', label: 'Brassage' },
    { id: 'brackets', label: 'Tableaux' },
    { id: 'courts', label: 'Terrains' },
    { id: 'standings', label: 'Classement' }
  ];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pname = id => { const p = state.players.find(x => x.id === id); return p ? p.name : '?'; };
  const courtLabel = c => 'Terrain ' + E.courtNumber(c);
  const courtShort = c => 'T' + E.courtNumber(c);
  const fmt = x => (Math.round(x * 100) / 100).toString().replace('.', ',');

  function saveUI() {
    try { localStorage.setItem(KEY_UI, JSON.stringify({ tab: ui.tab, division: ui.division, zoom: ui.zoom, currentId: state && state.tournament.id, gym: ui.gym })); } catch (e) { /* ignore */ }
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('#live');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, isError ? 6000 : 2500);
  }

  /** Applique le résultat d'une opération du moteur ; gère la confirmation des conséquences. */
  function run(op, successMsg) {
    let res = op({});
    if (!res.ok && res.needsConfirm) {
      if (!window.confirm(res.error + '\n\nConfirmer la modification ?')) return false;
      res = op({ confirm: true });
    }
    if (!res.ok) { toast(res.error, true); return false; }
    commit(res.state);
    if (successMsg) toast(successMsg);
    return res;
  }

  function commit(newState) {
    state = newState;
    Store.save(state);
    saveUI();
    render();
  }

  /* ------------------------------------------------------------------ *
   * Rendu général
   * ------------------------------------------------------------------ */
  function render() {
    renderSwitcher();
    renderTabs();
    renderBanner();
    const view = $('#view');
    const keep = $('.bracket-scroll');
    const scroll = keep ? [keep.scrollLeft, keep.scrollTop] : null;
    view.classList.toggle('gym', ui.tab === 'courts' && ui.gym);
    const renderers = { config: renderConfig, swiss: renderSwiss, brackets: renderBrackets, courts: renderCourts, standings: renderStandings };
    view.innerHTML = renderers[ui.tab]();
    const sc = $('.bracket-scroll');
    if (sc && scroll) { sc.scrollLeft = scroll[0]; sc.scrollTop = scroll[1]; }
    if (ui.dialogMatchId && $('#matchDialog').open) renderDialog();
  }

  function renderSwitcher() {
    const sel = $('#tournamentSelect');
    const list = Store.list();
    if (!list.some(x => x.id === state.tournament.id)) list.unshift({ id: state.tournament.id, name: state.tournament.name, date: state.tournament.date });
    sel.innerHTML = list.map(x => `<option value="${esc(x.id)}" ${x.id === state.tournament.id ? 'selected' : ''}>${esc(x.name)} — ${esc(x.date || '')}</option>`).join('');
  }

  function renderTabs() {
    const ready = state.matches.filter(m => m.status === 'in_progress').length;
    $('#tabs').innerHTML = TABS.map(t => {
      const badge = t.id === 'courts' && ready ? `<span class="badge" aria-label="${ready} matchs en cours">${ready}</span>` : '';
      return `<button type="button" class="tab" role="tab" id="tab-${t.id}" aria-controls="view" aria-selected="${ui.tab === t.id}" data-action="tab" data-tab="${t.id}">${t.label}${badge}</button>`;
    }).join('');
  }

  function renderBanner() {
    const b = $('#banner');
    const msgs = [];
    if (!Store.ok) msgs.push('<span>Le stockage local est indisponible (navigation privée ?) : les données seront perdues à la fermeture. Exportez régulièrement en JSON.</span>');
    if (ui.storageError) msgs.push(`<span>${esc(ui.storageError)}</span> <button class="btn btn-small" data-action="export-json">Exporter maintenant</button>`);
    if (ui.externalChange) msgs.push('<span>Ce tournoi a été modifié dans un autre onglet.</span> <button class="btn btn-small" data-action="reload-external">Recharger</button>');
    b.hidden = !msgs.length;
    b.innerHTML = msgs.join(' ');
  }

  const PHASES = { setup: 'Configuration', swiss: 'Brassage', finals: 'Tableaux de classement', done: 'Terminé' };

  /* ------------------------------------------------------------------ *
   * Onglet Configuration
   * ------------------------------------------------------------------ */
  function renderConfig() {
    const t = state.tournament, st = t.settings;
    const started = t.phase !== 'setup';
    const lockNote = started ? '<small>Verrouillé après le début (réinitialisation possible plus bas).</small>' : '';
    const sports = E.SPORTS.map(s => `<option ${s === t.sport ? 'selected' : ''}>${esc(s)}</option>`).join('');
    return `
      <section class="card">
        <div class="card-head"><h2>Tournoi</h2><span class="chip">Phase : ${PHASES[t.phase]}</span></div>
        <div class="grid">
          <label class="field"><span>Nom du tournoi</span><input type="text" data-info="name" value="${esc(t.name)}" maxlength="80"></label>
          <label class="field"><span>Sport</span><select data-info="sport">${sports}</select></label>
          <label class="field"><span>Date</span><input type="date" data-info="date" value="${esc(t.date)}"></label>
          <div class="field">
            <label for="seedInput">Graine du tirage (reproductible)</label>
            <div class="inline"><input id="seedInput" type="text" data-info="seed" value="${esc(t.seed)}" ${started ? 'disabled' : ''} style="flex:1">
            <button type="button" class="btn btn-small" data-action="new-seed" ${started ? 'disabled' : ''}>Nouvelle</button></div>
            ${lockNote}
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Règles et terrains</h2>
        <div class="grid">
          <div class="field"><label for="courtsInput">Nombre de terrains</label>
            <div class="stepper"><button type="button" class="btn btn-icon" data-action="step" data-setting="courts" data-delta="-1" aria-label="Un terrain de moins">−</button>
            <input id="courtsInput" type="number" min="1" max="40" inputmode="numeric" data-setting="courts" value="${st.courts}">
            <button type="button" class="btn btn-icon" data-action="step" data-setting="courts" data-delta="1" aria-label="Un terrain de plus">+</button></div>
            <small>Jamais plus d'un match par terrain ni par joueur à la fois.</small></div>
          <div class="field"><label for="roundsInput">Rondes de brassage</label>
            <div class="stepper"><button type="button" class="btn btn-icon" data-action="step" data-setting="swissRounds" data-delta="-1" aria-label="Une ronde de moins">−</button>
            <input id="roundsInput" type="number" min="0" max="12" inputmode="numeric" data-setting="swissRounds" value="${st.swissRounds}" ${t.phase === 'finals' || t.phase === 'done' ? 'disabled' : ''}>
            <button type="button" class="btn btn-icon" data-action="step" data-setting="swissRounds" data-delta="1" aria-label="Une ronde de plus">+</button></div>
            <small>0 = tableaux directs (têtes de série ou tirage).</small></div>
          <label class="field"><span>Format des matchs</span>
            <select data-setting="matchFormat">
              <option value="temps" ${st.matchFormat === 'temps' ? 'selected' : ''}>Durée limitée</option>
              <option value="score" ${st.matchFormat === 'score' ? 'selected' : ''}>Score cible</option>
            </select></label>
          ${st.matchFormat === 'temps'
            ? `<label class="field"><span>Durée d'un match (min)</span><input type="number" min="1" max="120" inputmode="numeric" data-setting="matchMinutes" value="${st.matchMinutes}"></label>`
            : `<label class="field"><span>Score cible (points)</span><input type="number" min="1" max="99" inputmode="numeric" data-setting="targetScore" value="${st.targetScore}"></label>
               <label class="field"><span>Durée estimée d'un match (min)</span><input type="number" min="1" max="120" inputmode="numeric" data-setting="matchMinutes" value="${st.matchMinutes}"></label>`}
        </div>
        <label class="check"><input type="checkbox" data-setting="useSeeds" ${st.useSeeds ? 'checked' : ''} ${started ? 'disabled' : ''}>
          <span><b>Têtes de série</b> : l'ordre de la liste des joueurs est le classement initial (1ʳᵉ ligne = tête de série n°1). Sinon, tirage aléatoire reproductible.</span></label>
        <label class="check"><input type="checkbox" data-setting="allowDrawsSwiss" ${st.allowDrawsSwiss ? 'checked' : ''} ${started ? 'disabled' : ''}>
          <span><b>Matchs nuls autorisés au brassage</b> (½ point). Toujours interdits dans les tableaux : jouer un point décisif.</span></label>
        <label class="field"><span>Exemption (effectif impair)</span>
          <select data-setting="byePoints" ${started ? 'disabled' : ''}>
            <option value="1" ${st.byePoints ? 'selected' : ''}>1 point de match (sans victoire ni points marqués)</option>
            <option value="0" ${!st.byePoints ? 'selected' : ''}>0 point de match</option>
          </select></label>
        <label class="check"><input type="checkbox" data-setting="autoAssign" ${st.autoAssign ? 'checked' : ''}>
          <span><b>Affectation automatique des terrains</b> dès qu'un terrain se libère.</span></label>
      </section>

      ${renderPlayersCard()}
      ${renderRecap()}

      <section class="card danger no-print">
        <h2>Zone sensible</h2>
        <p class="muted small">Ces actions demandent une confirmation. Pensez à exporter une sauvegarde JSON avant.</p>
        <div class="btn-row">
          <button type="button" class="btn btn-danger" data-action="reset-matches" ${t.phase === 'setup' ? 'disabled' : ''}>Réinitialiser les matchs (garder les joueurs)</button>
          <button type="button" class="btn btn-danger" data-action="delete-tournament">Supprimer ce tournoi</button>
        </div>
      </section>`;
  }

  function renderPlayersCard() {
    const t = state.tournament;
    if (t.phase === 'setup') {
      const text = state.players.map(p => p.name).join('\n');
      return `
      <section class="card">
        <div class="card-head"><h2>Joueurs (${state.players.length})</h2>
          <div class="btn-row">
            <label class="btn btn-small" for="csvInput">Importer un CSV</label>
            <input type="file" id="csvInput" accept=".csv,.txt,text/csv,text/plain" hidden>
            <button type="button" class="btn btn-small" data-action="demo-players">Joueurs fictifs…</button>
          </div></div>
        <label class="field"><span>Un joueur par ligne (collage multiligne possible)${t.settings.useSeeds ? ' — ordre = têtes de série' : ''}</span>
          <textarea id="playersText" spellcheck="false" autocomplete="off" placeholder="Prénom N.&#10;Prénom N.&#10;…">${esc(text)}</textarea></label>
        <p id="playersCheck" class="small" aria-live="polite">${esc(playersCheckText(text))}</p>
        <div class="btn-row"><button type="button" class="btn btn-primary" data-action="save-players">Enregistrer la liste</button>
        <span class="muted small">CSV : première colonne, séparateur ; , ou tabulation.</span></div>
      </section>`;
    }
    const canAdd = t.phase === 'swiss' && E.swissRoundsComplete(state);
    const rows = state.players.map(p => `
      <tr class="${p.withdrawn ? 'withdrawn' : ''}">
        <td class="num">${p.initialSeed}</td><td>${esc(p.name)}${p.late ? ' <span class="chip">retardataire</span>' : ''}</td>
        <td>${p.withdrawn ? 'Retiré (forfait général)' : 'Actif'}</td>
        <td><div class="inline">
          <button type="button" class="btn btn-small" data-action="rename" data-id="${p.id}">Renommer</button>
          <button type="button" class="btn btn-small ${p.withdrawn ? '' : 'btn-danger'}" data-action="withdraw" data-id="${p.id}" data-value="${p.withdrawn ? 0 : 1}">${p.withdrawn ? 'Réintégrer' : 'Retirer'}</button>
        </div></td>
      </tr>`).join('');
    return `
      <section class="card">
        <div class="card-head"><h2>Joueurs (${state.players.length})</h2></div>
        <p class="muted small">La liste est verrouillée. « Retirer » = abandon : ses matchs non joués sont perdus par forfait, il garde une place dans le classement final.</p>
        <div class="table-wrap"><table><thead><tr><th class="num">N°</th><th>Nom</th><th>État</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="btn-row">
          <label class="sr-only" for="lateName">Nom du retardataire</label>
          <input type="text" id="lateName" placeholder="Retardataire (entre deux rondes)" ${canAdd ? '' : 'disabled'} style="max-width:320px">
          <button type="button" class="btn" data-action="add-late" ${canAdd ? '' : 'disabled'}>Ajouter</button>
          ${canAdd ? '' : '<span class="muted small">Ajout possible uniquement pendant le brassage, entre deux rondes.</span>'}
        </div>
      </section>`;
  }

  function playersCheckText(text) {
    const a = E.analyzeNames(text);
    const parts = [a.names.length + ' joueur(s)'];
    if (a.empty) parts.push(a.empty + ' ligne(s) vide(s) ignorée(s)');
    if (a.errors.length) parts.push('⚠ ' + a.errors.join(' '));
    else parts.push('✓ liste valide');
    return parts.join(' — ');
  }

  function renderRecap() {
    const t = state.tournament, st = t.settings;
    const n = state.players.length;
    if (n < 2) return `<section class="card"><h2>Récapitulatif</h2><p class="muted">Ajoutez au moins 2 joueurs.</p></section>`;
    const perRound = Math.floor(n / 2);
    const props = E.proposePartitions(n);
    const rec = props[0];
    const est = E.estimateSchedule(n, st.courts, st.swissRounds, rec ? rec.sizes : null, st.matchMinutes);
    const waveSwiss = Math.ceil(perRound / st.courts);
    const startBtn = t.phase === 'setup'
      ? `<button type="button" class="btn btn-primary btn-big" data-action="start">${st.swissRounds ? 'Démarrer le brassage' : 'Passer directement aux tableaux'}</button>`
      : `<button type="button" class="btn btn-big" data-action="tab" data-tab="${t.phase === 'swiss' ? 'swiss' : 'brackets'}">Aller à la phase en cours →</button>`;
    return `
      <section class="card">
        <h2>Récapitulatif</h2>
        <div class="kpis">
          <div class="kpi"><b>${n}</b><span>joueurs</span></div>
          <div class="kpi"><b>${st.courts}</b><span>terrains</span></div>
          <div class="kpi"><b>${st.swissRounds}</b><span>rondes de brassage</span></div>
          <div class="kpi"><b>${perRound}</b><span>matchs par ronde${n % 2 ? ' + 1 exemption' : ''}</span></div>
          <div class="kpi"><b>${waveSwiss}</b><span>vague(s) par ronde</span></div>
          <div class="kpi"><b>${rec ? rec.total : '—'}</b><span>matchs de classement (${rec ? rec.sizes.join(' + ') : '—'})</span></div>
          <div class="kpi"><b>≈ ${est.minutes} min</b><span>${est.waves} vagues × (${st.matchMinutes} min + 2 min de rotation)</span></div>
        </div>
        ${n > 2 * st.courts ? `<p class="muted small">${n - 2 * Math.min(st.courts, perRound)} joueur(s) en attente à chaque vague : prévoyez un rôle (arbitrage, marque, observation).</p>` : ''}
        ${rec && rec.warnings.length ? `<div class="notice small"><b>Divisions recommandées : ${rec.sizes.join(' + ')}</b> (choix définitif après le brassage)<ul>${rec.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        <div class="btn-row">${startBtn}</div>
      </section>`;
  }

  /* ------------------------------------------------------------------ *
   * Cartes de match (brassage, poules, terrains)
   * ------------------------------------------------------------------ */
  function statusText(m) {
    if (m.isBye) return 'Exemption';
    if (m.result) {
      if (m.result.type === 'forfait') return m.result.auto ? 'Forfait (joueur retiré)' : 'Victoire par forfait';
      return m.result.draw ? 'Match nul' : 'Terminé';
    }
    if (m.courtId) return 'En cours — ' + courtLabel(m.courtId) + (m.invalidated ? ' (à rejouer)' : '');
    if (m.invalidated) return 'Résultat invalidé — à rejouer';
    if (m.status === 'ready') return 'Prêt — en attente d\'un terrain';
    return 'En attente des matchs sources';
  }

  function sourceText(m, side) {
    const src = side === 'A' ? m.sourceA : m.sourceB;
    if (!src) return 'À déterminer';
    const sm = state.matches.find(x => x.id === src.matchId);
    return 'En attente du ' + (src.take === 'winner' ? 'vainqueur' : 'perdant') + ' de M' + (sm ? sm.number : '?');
  }

  function scoreText(m) {
    if (!m.result || m.isBye) return '';
    if (m.result.type === 'forfait') return 'forfait';
    return m.result.scoreA + ' – ' + m.result.scoreB;
  }

  function matchCard(m, opts) {
    opts = opts || {};
    if (m.isBye) {
      return `<div class="match-card st-bye"><span class="court-badge">—</span><span class="players"><span><b>${esc(pname(m.playerAId))}</b></span><span class="state-label">Exempt cette ronde</span></span><span></span></div>`;
    }
    const w = m.result && m.result.winnerId;
    const a = m.playerAId ? esc(pname(m.playerAId)) : `<i>${esc(sourceText(m, 'A'))}</i>`;
    const b = m.playerBId ? esc(pname(m.playerBId)) : `<i>${esc(sourceText(m, 'B'))}</i>`;
    const prefix = opts.prefix ? esc(opts.prefix) + ' · ' : '';
    return `<button type="button" class="match-card st-${m.status}" data-action="open-match" data-id="${m.id}">
      <span class="court-badge ${m.courtId && !m.result ? 'on' : ''}">${m.courtId && !m.result ? courtShort(m.courtId) : (m.result ? '✓' : '—')}</span>
      <span class="players">
        <span class="${w && w === m.playerAId ? 'win' : ''}">${a}</span>
        <span class="${w && w === m.playerBId ? 'win' : ''}">${b}</span>
        <span class="state-label">${prefix}${esc(statusText(m))}</span>
      </span>
      <span class="score">${esc(scoreText(m))}</span>
    </button>`;
  }

  /* ------------------------------------------------------------------ *
   * Onglet Brassage
   * ------------------------------------------------------------------ */
  function renderSwiss() {
    const t = state.tournament;
    if (t.phase === 'setup') return `<section class="card"><h2>Brassage</h2><p>Le tournoi n'a pas commencé.</p><button class="btn btn-primary" data-action="tab" data-tab="config">Aller à la configuration</button></section>`;
    if (!state.rounds.length) return `<section class="card"><h2>Brassage</h2><p>Aucune ronde de brassage : formez directement les divisions.</p><button class="btn btn-primary" data-action="tab" data-tab="brackets">Aller aux tableaux</button></section>`;
    const total = t.settings.swissRounds;
    const can = E.canGenerateNextRound(state);
    const canFreeze = E.canFreezeDivisions(state);
    const current = state.rounds[state.rounds.length - 1];
    const cur = E.roundMatches(state, current).filter(m => !m.isBye);
    const done = cur.filter(m => m.result).length;
    let action = '';
    if (can.ok) action = `<button type="button" class="btn btn-primary btn-big" data-action="next-round">Générer la ronde ${state.rounds.length + 1}</button>`;
    else if (canFreeze.ok) action = `<button type="button" class="btn btn-primary btn-big" data-action="tab" data-tab="brackets">Brassage terminé : former les divisions →</button>`;
    else if (t.phase === 'finals' || t.phase === 'done') action = '<span class="chip">Têtes de série figées</span>';
    const rounds = state.rounds.slice().reverse().map(r => {
      const ms = E.roundMatches(state, r);
      const played = ms.filter(m => m.result && !m.isBye).length, count = ms.filter(m => !m.isBye).length;
      const body = `<div class="match-list">${ms.map(m => matchCard(m)).join('')}</div>
        ${r.repeats ? `<p class="small notice">${r.repeats} rencontre(s) répétée(s) inévitable(s) dans cette ronde.</p>` : ''}
        ${r.optimal === false ? '<p class="small notice">Recherche d\'appariement interrompue (effectif très grand) : meilleure solution trouvée conservée.</p>' : ''}`;
      if (r === current) return `<section class="card"><div class="card-head"><h2>Ronde ${r.number} / ${total}</h2><span class="chip">${played}/${count} matchs terminés</span></div>${body}</section>`;
      return `<details class="card"><summary>Ronde ${r.number} — ${played}/${count} terminés</summary>${body}</details>`;
    }).join('');
    return `
      <section class="card">
        <div class="card-head"><h2>Brassage — ronde ${current.number} sur ${total}</h2><span class="chip">${done}/${cur.length} matchs de la ronde terminés</span></div>
        <p class="muted small">Touchez un match pour saisir ou corriger le score. La ronde suivante est calculée quand toute la ronde est terminée.</p>
        <div class="btn-row">${action}
          <button type="button" class="btn" data-action="tab" data-tab="courts">Vue terrains</button></div>
      </section>
      ${rounds}
      ${renderSwissStandings()}`;
  }

  function renderSwissStandings(title) {
    const st = E.swissStandings(state);
    const rows = st.map(s => `
      <tr class="${s.withdrawn ? 'withdrawn' : ''}">
        <td class="num">${s.rank}</td><td>${esc(s.name)}</td>
        <td class="num"><b>${fmt(s.matchPoints)}</b></td><td class="num">${s.played}</td><td class="num">${s.wins}</td>
        <td class="num">${s.draws}</td><td class="num">${s.losses}</td><td class="num">${s.byes}</td>
        <td class="num">${s.pointsFor}</td><td class="num">${s.pointsAgainst}</td><td class="num">${s.diff > 0 ? '+' : ''}${s.diff}</td>
        <td class="num">${fmt(s.avgDiff)}</td><td class="num">${fmt(s.oppStrength)}</td>
        <td>${esc(s.opponents.map(pname).join(', '))}</td>
        <td class="small muted">${s.decidedBy ? esc(s.decidedBy) : ''}</td>
      </tr>`).join('');
    return `
      <section class="card">
        <h2>${title || 'Classement provisoire du brassage'}</h2>
        <p class="muted small">Départage : ${E.CRITERIA.map((c, i) => (i + 1) + '. ' + c.label).join(' ; ')}. Les moyennes sont calculées par match avec score ; une exemption n'est ni une victoire ni des points marqués.</p>
        <div class="table-wrap"><table>
          <thead><tr><th class="num">Rg</th><th>Joueur</th><th class="num" title="Points de match">Pts</th><th class="num" title="Matchs joués">J</th><th class="num" title="Victoires">V</th><th class="num" title="Nuls">N</th><th class="num" title="Défaites">D</th><th class="num" title="Exemptions">Ex</th><th class="num" title="Points marqués">PM</th><th class="num" title="Points encaissés">PE</th><th class="num">Diff</th><th class="num" title="Différence moyenne par match">Moy.</th><th class="num" title="Force des adversaires">Adv.</th><th>Adversaires rencontrés</th><th>Départagé du précédent par</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </section>`;
  }

  /* ------------------------------------------------------------------ *
   * Onglet Tableaux
   * ------------------------------------------------------------------ */
  function renderBrackets() {
    const t = state.tournament;
    if (t.phase === 'setup') return `<section class="card"><h2>Tableaux</h2><p>Le tournoi n'a pas commencé.</p></section>`;
    if (!state.divisions.length) return renderPartitionChooser();
    if (!ui.division || !state.divisions.some(d => d.id === ui.division)) ui.division = state.divisions[0].id;
    const d = state.divisions.find(x => x.id === ui.division);
    const fs = E.finalStandings(state);
    const assignedDiv = fs.rows.filter(r => r.divisionId === d.id && r.rank != null).length;
    const tabs = state.divisions.map(x => `<button type="button" class="btn btn-small" aria-pressed="${x.id === d.id}" data-action="division" data-id="${x.id}">${x.format === 'pool' ? 'Poule' : 'Tableau'} ${esc(x.name)} (places ${x.globalRankStart}-${x.globalRankStart + x.size - 1})</button>`).join('');
    const pure = state.divisions.every(x => x.format === 'bracket');
    return `
      <section class="card">
        <div class="card-head"><h2>Phase de classement</h2><span class="chip">Places attribuées : ${fs.assigned} / ${fs.total}</span></div>
        ${pure ? '' : '<p class="notice small">Format mixte : au moins une division se joue en poule. Ce n\'est plus un tableau intégral pur pour ces joueurs.</p>'}
        ${state.divisions.length > 1 ? '<p class="muted small">Rappel : les frontières de divisions sont fixées par le brassage. Un joueur d\'une division ne peut pas finir devant un joueur d\'une division supérieure.</p>' : ''}
        <div class="division-tabs" role="group" aria-label="Choix de la division">${tabs}</div>
      </section>
      <section class="card fullscreen-target" id="divisionPanel">
        <div class="card-head"><h2>${d.format === 'pool' ? 'Poule' : 'Tableau'} ${esc(d.name)} — places ${d.globalRankStart} à ${d.globalRankStart + d.size - 1}</h2>
          <span class="chip">${assignedDiv} / ${d.size} places attribuées</span></div>
        ${d.format === 'bracket' ? renderBracketView(d) : renderPoolView(d)}
      </section>
      <section class="card no-print">
        <h2>Correction du brassage</h2>
        <p class="muted small">Pour corriger un résultat du brassage, il faut rouvrir le brassage : <b>tous les tableaux et leurs résultats seront supprimés</b>.</p>
        <button type="button" class="btn btn-danger" data-action="reopen-swiss">Rouvrir le brassage…</button>
      </section>`;
  }

  function currentPartition(n) {
    const props = E.proposePartitions(n, 6);
    let sizes = null, custom = false;
    if (ui.partitionKey === 'custom') {
      custom = true;
      sizes = ui.customSizes.split(/[^0-9]+/).filter(Boolean).map(Number);
    } else {
      const p = props.find(x => x.sizes.join('+') === ui.partitionKey) || props[0];
      sizes = p ? p.sizes : null;
    }
    return { props, sizes, custom };
  }

  function renderPartitionChooser() {
    const can = E.canFreezeDivisions(state);
    const n = state.players.length;
    if (!can.ok) {
      return `<section class="card"><h2>Tableaux</h2><p>${esc(can.reason)}</p><button class="btn" data-action="tab" data-tab="swiss">Retour au brassage</button></section>`;
    }
    const { props, sizes, custom } = currentPartition(n);
    const st = state.tournament.settings;
    const selKey = custom ? 'custom' : (sizes ? sizes.join('+') : '');
    const options = props.map(p => {
      const key = p.sizes.join('+');
      const est = E.estimateSchedule(n, st.courts, 0, p.sizes, st.matchMinutes);
      return `<label class="partition">
        <input type="radio" name="partition" value="${key}" data-action="partition" ${key === selKey ? 'checked' : ''}>
        <span><b>${p.divisions.map(d => d.size).join(' + ')}</b> ${p.recommended ? '<span class="chip win">recommandé</span>' : ''} ${p.pure ? '' : '<span class="chip loss">avec poule</span>'}
          <span class="div-chips">${p.divisions.map(d => `<span class="chip">${d.name} : places ${d.rankStart}-${d.rankEnd} · ${d.format === 'pool' ? 'poule' : 'tableau'} · ${d.matchesPerPlayer} match(s)/joueur</span>`).join('')}</span>
          <span class="small">${p.total} matchs de classement · ≈ ${est.minutes} min sur ${st.courts} terrain(s) (${est.finalWaves} vagues)</span>
        </span></label>`;
    }).join('');
    let preview = '', valid = false, warnings = [];
    if (sizes && sizes.length) {
      const v = E.validatePartition(sizes, n);
      if (!v.ok) preview = `<p class="error-text">${esc(v.error)}</p>`;
      else {
        valid = true;
        const desc = E.describePartition(sizes);
        warnings = desc.warnings;
        const order = E.seedingOrder(state);
        let off = 0;
        preview = `<div class="preview-cols">${desc.divisions.map(d => {
          const ids = order.slice(off, off + d.size); off += d.size;
          return `<div><h3>${d.format === 'pool' ? 'Poule' : 'Tableau'} ${d.name} (places ${d.rankStart}-${d.rankEnd})</h3><ol start="${d.rankStart}">${ids.map(id => `<li>${esc(pname(id))}</li>`).join('')}</ol></div>`;
        }).join('')}</div>`;
      }
    }
    return `
      <section class="card">
        <h2>Former les divisions de classement</h2>
        <p>Les joueurs sont répartis dans l'ordre du classement de brassage. Dans chaque division, un tableau intégral (ou une poule pour 3, 5 ou 6 joueurs) attribue <b>chaque place exactement une fois</b>.</p>
        ${options}
        <label class="partition"><input type="radio" name="partition" value="custom" data-action="partition" ${custom ? 'checked' : ''}>
          <span><b>Répartition personnalisée</b><br><span class="small muted">Tailles séparées par des virgules, dans l'ordre (ex. 16, 8). Tableau : 2, 4, 8, 16, 32, 64 · poule : 3, 5, 6.</span>
          <input type="text" id="customSizes" value="${esc(ui.customSizes)}" placeholder="ex. 8, 8, 8" inputmode="numeric" style="margin-top:6px;max-width:260px"></span></label>
      </section>
      <section class="card">
        <h2>Aperçu</h2>
        ${warnings.length ? `<div class="notice small"><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${preview}
        <div class="btn-row"><button type="button" class="btn btn-primary btn-big" data-action="freeze" ${valid ? '' : 'disabled'}>Figer les têtes de série et générer les tableaux</button></div>
      </section>
      ${renderSwissStandings('Résultats du brassage (base des têtes de série)')}`;
  }

  function renderPoolView(d) {
    const ms = state.matches.filter(m => m.divisionId === d.id);
    const pr = E.poolRanking(state, d);
    const cell = (a, b) => {
      if (a === b) return '<td class="num muted">×</td>';
      const m = ms.find(x => (x.playerAId === a && x.playerBId === b) || (x.playerAId === b && x.playerBId === a));
      if (!m || !m.result) return '<td class="num muted">·</td>';
      if (m.result.type === 'forfait') return `<td class="num">${m.result.winnerId === a ? 'V' : 'D'} (f)</td>`;
      const sa = m.playerAId === a ? m.result.scoreA : m.result.scoreB, sb = m.playerAId === a ? m.result.scoreB : m.result.scoreA;
      return `<td class="num">${sa > sb ? '<b>' + sa + '–' + sb + '</b>' : sa + '–' + sb}</td>`;
    };
    const grid = `<div class="table-wrap"><table><thead><tr><th>Joueur</th>${d.playerIds.map((id, i) => `<th class="num" title="${esc(pname(id))}">${i + 1}</th>`).join('')}</tr></thead>
      <tbody>${d.playerIds.map((a, i) => `<tr><td>${i + 1}. ${esc(pname(a))}</td>${d.playerIds.map(b => cell(a, b)).join('')}</tr>`).join('')}</tbody></table></div>`;
    const ranking = `<div class="table-wrap"><table><thead><tr><th class="num">Place</th><th>Joueur</th><th class="num">V</th><th class="num">D</th><th class="num">Diff</th></tr></thead>
      <tbody>${pr.rows.map((r, i) => `<tr><td class="num">${pr.complete ? d.globalRankStart + i : '—'}</td><td>${esc(pname(r.playerId))}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num">${r.pf - r.pa}</td></tr>`).join('')}</tbody></table></div>`;
    return `<p class="muted small">Poule (tous contre tous) : classement par victoires, puis confrontations entre ex aequo, différence de points, points marqués, rang du brassage. Les places sont attribuées quand tous les matchs sont joués.</p>
      ${grid}<h3 style="margin-top:12px">Matchs</h3><div class="match-list">${ms.map(m => matchCard(m, { prefix: 'M' + m.number })).join('')}</div>
      <h3 style="margin-top:12px">Classement de la poule ${pr.complete ? '' : '(provisoire)'}</h3>${ranking}`;
  }

  /* --- Arbre SVG du tableau intégral --- */
  const SVG_COLORS = { initial: '#1d4ed8', upper: '#15803d', lower: '#c2410c', text: '#111827', muted: '#4b5567', bg: '#ffffff', done: '#f0fdf4' };

  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function renderBracketView(d) {
    return `
      <div class="legend" aria-label="Légende">
        <span><span class="box" style="border-color:${SVG_COLORS.initial}"></span>Premier tour</span>
        <span><span class="sw w"></span>Gagnants (trait plein, « V »)</span>
        <span><span class="sw l"></span>Perdants (pointillés, « P »)</span>
        <span><span class="box" style="border-color:${SVG_COLORS.upper}"></span>Branche haute</span>
        <span><span class="box" style="border-color:${SVG_COLORS.lower};border-style:dashed"></span>Branche basse</span>
      </div>
      <div class="bracket-tools">
        <button type="button" class="btn btn-icon" data-action="zoom" data-delta="-0.15" aria-label="Dézoomer">−</button>
        <span class="small" aria-live="polite">${Math.round(ui.zoom * 100)} %</span>
        <button type="button" class="btn btn-icon" data-action="zoom" data-delta="0.15" aria-label="Zoomer">+</button>
        <button type="button" class="btn btn-small" data-action="zoom-fit">Ajuster</button>
        <button type="button" class="btn btn-small" data-action="zoom-reset">100 % / recentrer</button>
        <button type="button" class="btn btn-small" data-action="fullscreen">Plein écran</button>
        <button type="button" class="btn btn-small" data-action="export-svg">SVG</button>
        <button type="button" class="btn btn-small" data-action="export-png">PNG</button>
        <button type="button" class="btn btn-small" data-action="print-landscape">Imprimer</button>
      </div>
      <div class="bracket-scroll" id="bracketScroll">${bracketSVG(d)}</div>
      <p class="muted small">Touchez un match (ou Tab puis Entrée) pour saisir ou corriger son résultat. Les joueurs des tours suivants sont calculés à partir des résultats réels.</p>`;
  }

  function bracketSVG(d) {
    const ms = state.matches.filter(m => m.divisionId === d.id);
    const W = 232, H = 104, CG = 64, RG = 16, TOP = 44, LEFT = 16;
    const cols = Math.max.apply(null, ms.map(m => m.depth)) + 1;
    const rows = Math.max.apply(null, ms.map(m => m.row)) + 1;
    const width = LEFT * 2 + cols * W + (cols - 1) * CG;
    const height = TOP + rows * (H + RG) + 8;
    const x = depth => LEFT + depth * (W + CG);
    const y = row => TOP + row * (H + RG);
    const byId = new Map(ms.map(m => [m.id, m]));
    const total = d.size;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Tableau ${esc(d.name)}, places ${d.globalRankStart} à ${d.globalRankStart + total - 1}" viewBox="0 0 ${width} ${height}" width="${Math.round(width * ui.zoom)}" height="${Math.round(height * ui.zoom)}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif">
      <style>
        .t{font-size:13px;fill:${SVG_COLORS.text}} .h{font-size:12px;font-weight:700} .m{font-size:11.5px;fill:${SVG_COLORS.muted}}
        .w{font-weight:700} .i{font-style:italic;fill:${SVG_COLORS.muted};font-size:11.5px} .s{font-size:14px;font-weight:700;fill:${SVG_COLORS.text}}
        .col{font-size:13px;font-weight:700;fill:${SVG_COLORS.muted}} .el{font-size:11px;font-weight:700}
      </style>
      <rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc"/>`;
    for (let c = 0; c < cols; c++) {
      const label = c === 0 ? 'Tour 1 — places ' + d.globalRankStart + '-' + (d.globalRankStart + total - 1) : (c === cols - 1 ? 'Matchs de places' : 'Tour ' + (c + 1) + ' — classement');
      out += `<text class="col" x="${x(c)}" y="26">${esc(label)}</text>`;
    }
    // Arêtes
    ms.forEach(m => {
      [['A', m.sourceA], ['B', m.sourceB]].forEach(([side, src]) => {
        if (!src) return;
        const s = byId.get(src.matchId);
        if (!s) return;
        const x1 = x(s.depth) + W, y1 = y(s.row) + H / 2;
        const x2 = x(m.depth), y2 = y(m.row) + (side === 'A' ? H * 0.38 : H * 0.66);
        const mx = (x1 + x2) / 2;
        const win = src.take === 'winner';
        const color = win ? SVG_COLORS.upper : SVG_COLORS.lower;
        out += `<path d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2.5" ${win ? '' : 'stroke-dasharray="7 5"'} opacity="0.9"><title>${win ? 'Vainqueur' : 'Perdant'} de M${s.number} → M${m.number}</title></path>`;
        out += `<text class="el" x="${x1 + 4}" y="${y1 + (win ? -5 : 14)}" fill="${color}">${win ? 'V' : 'P'}</text>`;
      });
    });
    // Nœuds
    ms.forEach(m => {
      const nx = x(m.depth), ny = y(m.row);
      const color = SVG_COLORS[m.branch] || SVG_COLORS.initial;
      const dashed = m.branch === 'lower' ? 'stroke-dasharray="8 4"' : '';
      const w = m.result && m.result.winnerId;
      const fill = m.result ? SVG_COLORS.done : (m.invalidated ? '#fff7ed' : SVG_COLORS.bg);
      const nameA = m.playerAId ? truncate(pname(m.playerAId), 22) : truncate(sourceText(m, 'A'), 30);
      const nameB = m.playerBId ? truncate(pname(m.playerBId), 22) : truncate(sourceText(m, 'B'), 30);
      const sA = m.result && m.result.type === 'score' ? m.result.scoreA : (m.result && m.result.type === 'forfait' ? (m.result.loserId === m.playerAId ? 'F' : '') : '');
      const sB = m.result && m.result.type === 'score' ? m.result.scoreB : (m.result && m.result.type === 'forfait' ? (m.result.loserId === m.playerBId ? 'F' : '') : '');
      let foot = statusText(m);
      if (m.placementFinal && m.result) foot = m.targetRanks[0] + 'ᵉ ' + truncate(pname(m.result.winnerId), 12) + ' · ' + (m.targetRanks[0] + 1) + 'ᵉ ' + truncate(pname(m.result.loserId), 12);
      const head = 'M' + m.number + ' · ' + (m.depth === 0 ? m.label + ' · ' : '') + (m.placementFinal ? 'Places ' + m.targetRanks[0] + '-' + m.targetRanks[1] : 'Places ' + m.targetRanks[0] + '-' + m.targetRanks[1]);
      const court = m.courtId && !m.result ? courtShort(m.courtId) : '';
      const aria = `Match ${m.number}, places ${m.targetRanks[0]} à ${m.targetRanks[1]}. ${m.playerAId ? pname(m.playerAId) : sourceText(m, 'A')} contre ${m.playerBId ? pname(m.playerBId) : sourceText(m, 'B')}. ${scoreText(m)}. ${statusText(m)}${court ? ', ' + courtLabel(m.courtId) : ''}${w ? '. Vainqueur : ' + pname(w) : ''}.`;
      out += `<g class="node" data-action="open-match" data-id="${m.id}" tabindex="0" role="button" aria-label="${esc(aria)}" transform="translate(${nx},${ny})">
        <rect class="frame" x="0" y="0" width="${W}" height="${H}" rx="10" fill="${fill}" stroke="${color}" stroke-width="2.5" ${dashed}/>
        <rect x="0" y="0" width="${W}" height="22" rx="10" fill="${color}"/><rect x="0" y="12" width="${W}" height="10" fill="${color}"/>
        <text class="h" x="8" y="15" fill="#fff">${esc(head)}</text>
        ${court ? `<text class="h" x="${W - 8}" y="15" fill="#fff" text-anchor="end">${esc(court)}</text>` : ''}
        <text class="${m.playerAId ? 't' : 'i'} ${w && w === m.playerAId ? 'w' : ''}" x="8" y="42">${w && w === m.playerAId ? '▶ ' : ''}${esc(nameA)}</text>
        <text class="s" x="${W - 8}" y="42" text-anchor="end">${esc(sA)}</text>
        <line x1="8" x2="${W - 8}" y1="52" y2="52" stroke="#e5e7eb"/>
        <text class="${m.playerBId ? 't' : 'i'} ${w && w === m.playerBId ? 'w' : ''}" x="8" y="68">${w && w === m.playerBId ? '▶ ' : ''}${esc(nameB)}</text>
        <text class="s" x="${W - 8}" y="68" text-anchor="end">${esc(sB)}</text>
        <text class="m" x="8" y="${H - 10}">${esc(truncate(foot, 38))}</text>
      </g>`;
    });
    out += '</svg>';
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Onglet Terrains (vue gymnase)
   * ------------------------------------------------------------------ */
  function matchPrefix(m) {
    if (m.phase === 'swiss') return 'Ronde ' + ((state.rounds.find(r => r.id === m.roundId) || {}).number || '');
    const d = state.divisions.find(x => x.id === m.divisionId);
    return (d ? d.name : '') + '·M' + m.number + ' (places ' + m.targetRanks[0] + '-' + m.targetRanks[1] + ')';
  }

  function renderCourts() {
    const t = state.tournament;
    const courts = E.courtIds(state);
    const active = new Map(state.matches.filter(m => m.courtId && !m.result).map(m => [m.courtId, m]));
    const queue = E.readyQueue(state);
    const busy = E.busyPlayerIds(state);
    const free = E.freeCourtIds(state);
    const pending = state.matches.filter(m => m.status === 'pending').length;
    const cards = courts.map(c => {
      const m = active.get(c);
      if (!m) return `<div class="court-card"><h3>${courtLabel(c)}</h3><p class="free">Libre</p></div>`;
      return `<div class="court-card busy"><h3>${courtLabel(c)}</h3>
        <div class="vs">${esc(pname(m.playerAId))}<span class="sep">contre</span>${esc(pname(m.playerBId))}</div>
        <span class="muted small">${esc(matchPrefix(m))}</span>
        <button type="button" class="btn btn-primary btn-big" data-action="open-match" data-id="${m.id}">Saisir le score</button></div>`;
    }).join('');
    const q = queue.map((m, i) => {
      const blocked = busy.has(m.playerAId) || busy.has(m.playerBId);
      return `<li><span><span class="who">${i + 1}. ${esc(pname(m.playerAId))} – ${esc(pname(m.playerBId))}</span><br><span class="small muted">${esc(matchPrefix(m))}${blocked ? ' · un joueur est encore sur un terrain' : ''}</span></span>
        ${free.length && !blocked ? `<button type="button" class="btn btn-small" data-action="assign" data-id="${m.id}" data-court="${free[0]}">Lancer sur ${courtShort(free[0])}</button>` : `<button type="button" class="btn btn-small" data-action="open-match" data-id="${m.id}">Détails</button>`}</li>`;
    }).join('');
    const waiting = state.players.filter(p => !p.withdrawn && !busy.has(p.id)).map(p => esc(p.name));
    const fs = state.divisions.length ? E.finalStandings(state) : null;
    return `
      <section class="card">
        <div class="card-head"><h2>${esc(t.name)} — ${PHASES[t.phase]}</h2>
          ${fs ? `<span class="chip">Places attribuées : ${fs.assigned} / ${fs.total}</span>` : ''}</div>
        <div class="btn-row no-print">
          <button type="button" class="btn" data-action="auto-assign" ${free.length && queue.length ? '' : 'disabled'}>Affecter les terrains libres</button>
          <button type="button" class="btn" data-action="gym-toggle" aria-pressed="${ui.gym}">${ui.gym ? 'Texte normal' : 'Grand texte'}</button>
          <button type="button" class="btn" data-action="fullscreen-courts">Plein écran</button>
          ${E.canGenerateNextRound(state).ok ? '<button type="button" class="btn btn-primary" data-action="next-round">Générer la ronde suivante</button>' : ''}
        </div>
      </section>
      <div class="courts-grid fullscreen-target" id="courtsGrid">${cards}</div>
      <section class="card" style="margin-top:14px">
        <h2>Prochains matchs (${queue.length})</h2>
        ${queue.length ? `<ol class="queue">${q}</ol>` : `<p class="muted">Aucun match prêt${pending ? ' — ' + pending + ' match(s) attendent le résultat de leurs matchs sources' : ''}.</p>`}
      </section>
      <section class="card"><h2>Joueurs au repos (${waiting.length})</h2><p class="small">${waiting.join(', ') || '—'}</p></section>`;
  }

  /* ------------------------------------------------------------------ *
   * Onglet Classement
   * ------------------------------------------------------------------ */
  function renderStandings() {
    const exportBtns = `<div class="btn-row no-print">
      <button type="button" class="btn" data-action="export-csv">Classement CSV</button>
      <button type="button" class="btn" data-action="export-results">Résultats CSV</button>
      <button type="button" class="btn" data-action="export-json">Sauvegarde JSON</button>
      <button type="button" class="btn" data-action="print">Imprimer / PDF</button></div>`;
    const t = state.tournament;
    const stats = new Map(E.playerStats(state).map(s => [s.playerId, s]));
    if (!state.divisions.length) {
      return `<section class="card"><h2>Classement</h2><p class="muted">Le classement final sera disponible après les tableaux. En attendant : classement provisoire du brassage.</p>${exportBtns}</section>${state.players.length ? renderSwissStandings() : ''}`;
    }
    const fs = E.finalStandings(state);
    const chk = fs.complete ? E.checkFinalRanking(state) : null;
    let lastDiv = null;
    const rows = fs.rows.map(r => {
      const s = stats.get(r.playerId);
      const sep = lastDiv && lastDiv !== r.divisionId ? 'div-sep' : '';
      lastDiv = r.divisionId;
      const path = r.path.map(p => `<span class="chip ${p.won ? 'win' : 'loss'}" title="${esc(p.label)}">${p.won ? 'V' : 'P'} M${p.number}${p.forfeit ? ' (f)' : ''}</span>`).join(' ');
      return `<tr class="${sep} ${r.withdrawn ? 'withdrawn' : ''}"><td class="num"><b>${r.rank == null ? '—' : r.rank}</b></td><td>${esc(r.name)}</td><td>${esc(r.divisionName)}</td>
        <td class="num">${r.swissRank || '—'}</td><td>${path}</td><td class="num">${s.played}</td><td class="num">${s.wins}</td><td class="num">${s.losses}</td><td class="num">${s.byes}</td><td class="num">${s.pf - s.pa}</td></tr>`;
    }).join('');
    return `
      <section class="card">
        <div class="card-head"><h1 style="font-size:1.3rem;margin:0">${esc(t.name)} — classement final</h1><span class="chip">${fs.assigned} / ${fs.total} places attribuées</span></div>
        <p class="small muted">${esc(t.sport)} · ${esc(t.date)} · ${state.players.length} joueurs · divisions ${state.divisions.map(d => d.name + ' (' + d.size + ')').join(', ')}</p>
        ${chk ? (chk.ok ? '<p class="ok-text">✓ Classement complet : places 1 à ' + fs.total + ', chacune attribuée une seule fois.</p>' : '<p class="error-text">Incohérence détectée : ' + esc(chk.errors.join(' ')) + '</p>') : '<p class="muted">Classement en cours : les places s\'affichent au fur et à mesure des matchs de places.</p>'}
        <p class="small muted">La <b>place finale</b> provient des tableaux ; le <b>rang de brassage</b> n'a servi qu'à former les divisions. Un tableau intégral donne un rang pour chacun, pas une mesure parfaite du niveau sportif (taux de victoires et place finale sont deux choses différentes).</p>
        ${exportBtns}
        <div class="table-wrap"><table>
          <thead><tr><th class="num">Place</th><th>Joueur</th><th>Div.</th><th class="num">Rang brassage</th><th>Parcours en tableau</th><th class="num">Matchs</th><th class="num">V</th><th class="num">D</th><th class="num">Ex</th><th class="num">Diff</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </section>`;
  }

  /* ------------------------------------------------------------------ *
   * Dialogue de saisie / correction d'un match
   * ------------------------------------------------------------------ */
  function openMatch(id) {
    const m = state.matches.find(x => x.id === id);
    if (!m || m.isBye) return;
    ui.dialogMatchId = id;
    renderDialog();
    const dlg = $('#matchDialog');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    const first = dlg.querySelector('input[name="scoreA"]') || dlg.querySelector('button');
    if (first) first.focus();
  }

  function closeDialog() {
    const dlg = $('#matchDialog');
    ui.dialogMatchId = null;
    if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  }

  function renderDialog() {
    const m = state.matches.find(x => x.id === ui.dialogMatchId);
    const dlg = $('#matchDialog');
    if (!m) { closeDialog(); return; }
    const ready = m.playerAId && m.playerBId;
    const title = m.phase === 'swiss' ? matchPrefix(m) + ' — match ' + m.number : 'Division ' + matchPrefix(m);
    const r = m.result && m.result.type === 'score' ? m.result : null;
    const st = state.tournament.settings;
    const free = E.freeCourtIds(state);
    const courtOptions = E.courtIds(state).map(c => `<option value="${c}" ${m.courtId === c ? 'selected' : ''} ${!free.includes(c) && m.courtId !== c ? 'disabled' : ''}>${courtLabel(c)}${!free.includes(c) && m.courtId !== c ? ' (occupé)' : ''}</option>`).join('');
    const scoreRow = (side, id, val) => `
      <div class="score-row">
        <label for="score${side}">${esc(pname(id))}</label>
        <div class="score-input">
          <button type="button" class="btn" data-action="score-step" data-side="${side}" data-delta="-1" aria-label="Retirer un point à ${esc(pname(id))}">−</button>
          <input id="score${side}" name="score${side}" type="number" inputmode="numeric" min="0" max="999" value="${val == null ? '' : val}" autocomplete="off">
          <button type="button" class="btn" data-action="score-step" data-side="${side}" data-delta="1" aria-label="Ajouter un point à ${esc(pname(id))}">+</button>
        </div>
      </div>`;
    dlg.innerHTML = `
      <form class="dlg" id="matchForm" novalidate>
        <div class="dlg-head"><div><h2 id="matchDialogTitle">${esc(title)}</h2>
          <p class="small muted">${esc(statusText(m))}${m.targetRanks ? ' · places en jeu : ' + m.targetRanks[0] + ' à ' + m.targetRanks[1] : ''}${st.matchFormat === 'score' ? ' · score cible ' + st.targetScore : ' · ' + st.matchMinutes + ' min'}</p></div>
          <button type="button" class="btn btn-icon" data-action="close-dialog" aria-label="Fermer">✕</button></div>
        ${m.invalidated && !m.result ? `<p class="notice small">Résultat précédent invalidé suite à la correction d'un match amont${m.invalidated.previous && m.invalidated.previous.type === 'score' ? ' (ancien score : ' + m.invalidated.previous.scoreA + '–' + m.invalidated.previous.scoreB + ')' : ''}. Les joueurs ont pu changer : faites rejouer ce match.</p>` : ''}
        ${m.sourceA || m.sourceB ? `<p class="small muted">Prérequis : ${esc(sourceText(Object.assign({}, m, { playerAId: null }), 'A').replace('En attente du ', ''))} et ${esc(sourceText(Object.assign({}, m, { playerBId: null }), 'B').replace('En attente du ', ''))}.</p>` : ''}
        ${ready ? `
          ${scoreRow('A', m.playerAId, r ? r.scoreA : null)}
          ${scoreRow('B', m.playerBId, r ? r.scoreB : null)}
          <p class="error-text" id="scoreError" role="alert"></p>
          <button type="submit" class="btn btn-primary btn-big">${m.result ? 'Corriger le résultat' : 'Valider le score'}</button>
          <details><summary>Forfait, effacement</summary>
            <div class="btn-row">
              <button type="button" class="btn btn-danger" data-action="forfeit" data-id="${m.playerAId}">Forfait de ${esc(pname(m.playerAId))}</button>
              <button type="button" class="btn btn-danger" data-action="forfeit" data-id="${m.playerBId}">Forfait de ${esc(pname(m.playerBId))}</button>
              ${m.result ? '<button type="button" class="btn btn-danger" data-action="clear-result">Effacer le résultat</button>' : ''}
            </div>
          </details>
          ${!m.result ? `<div class="inline"><label for="courtSelect" class="small"><b>Terrain</b></label>
            <select id="courtSelect" style="max-width:200px"><option value="">— aucun —</option>${courtOptions}</select>
            <button type="button" class="btn btn-small" data-action="dialog-assign">Affecter</button>
            ${m.courtId ? '<button type="button" class="btn btn-small" data-action="dialog-unassign">Libérer le terrain</button>' : ''}</div>` : ''}
        ` : `<p>Ce match attend le résultat de ses matchs sources. Aucun adversaire n'est désigné à l'avance.</p>`}
      </form>`;
  }

  function submitScore() {
    const m = state.matches.find(x => x.id === ui.dialogMatchId);
    const a = $('#scoreA').value.trim(), b = $('#scoreB').value.trim();
    const err = E.validateScore(state, m, a === '' ? '' : Number(a), b === '' ? '' : Number(b));
    if (err) { $('#scoreError').textContent = err; return; }
    const res = run(o => E.setResult(state, m.id, { scoreA: Number(a), scoreB: Number(b) }, o), 'Score enregistré');
    if (res) closeDialog();
  }

  /* ------------------------------------------------------------------ *
   * Exports
   * ------------------------------------------------------------------ */
  function slug(s) { return E.nameKey(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tournoi'; }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function currentSVGString() {
    const svg = $('#bracketScroll svg');
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    const vb = svg.viewBox.baseVal;
    clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  function exportPNG() {
    const svgText = currentSVGString();
    if (!svgText) return;
    const svg = $('#bracketScroll svg');
    const vb = svg.viewBox.baseVal;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = vb.width * scale; canvas.height = vb.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => { if (b) download(slug(state.tournament.name) + '-tableau-' + ui.division + '.png', b); else toast('Export PNG impossible dans ce navigateur.', true); }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Export PNG impossible : utilisez l\'export SVG.', true); };
    img.src = url;
  }

  function printLandscape() {
    const style = document.createElement('style');
    style.textContent = '@page { size: landscape; }';
    document.head.appendChild(style);
    window.print();
    setTimeout(() => style.remove(), 1000);
  }

  function requestFs(el) {
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('Plein écran indisponible.', true));
    else toast('Plein écran indisponible sur cet appareil.', true);
  }

  /* ------------------------------------------------------------------ *
   * Gestion des tournois
   * ------------------------------------------------------------------ */
  function newTournament() {
    state = E.createTournament({ name: 'Tournoi du ' + new Date().toLocaleDateString('fr-FR') });
    ui.tab = 'config'; ui.division = null; ui.partitionKey = null;
    commit(state);
  }

  function switchTournament(id) {
    const s = Store.load(id);
    if (!s) { toast('Impossible de charger ce tournoi.', true); render(); return; }
    state = s; ui.division = null; ui.partitionKey = null; ui.externalChange = false;
    saveUI(); render();
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let s;
      try { s = E.deserialize(String(reader.result)); }
      catch (e) { toast('Import impossible : ' + e.message, true); return; }
      const exists = Store.list().some(x => x.id === s.tournament.id);
      if (exists && !window.confirm('Un tournoi avec le même identifiant existe déjà (« ' + s.tournament.name + ' »).\nOK = le remplacer par le fichier importé ; Annuler = importer comme copie.')) {
        s.tournament.id = s.tournament.id + '-copie-' + Date.now().toString(36);
        s.tournament.name += ' (copie)';
      }
      state = s; ui.division = null; ui.partitionKey = null;
      commit(state);
      toast('Tournoi importé.');
    };
    reader.onerror = () => toast('Lecture du fichier impossible.', true);
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * Événements (délégation)
   * ------------------------------------------------------------------ */
  const actions = {
    'tab': el => { ui.tab = el.dataset.tab; saveUI(); render(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); },
    'new-tournament': () => newTournament(),
    'new-seed': () => run(() => E.updateInfo(state, { seed: E.randomSeed() }), 'Nouvelle graine'),
    'step': el => {
      const key = el.dataset.setting;
      run(() => E.updateSettings(state, { [key]: state.tournament.settings[key] + Number(el.dataset.delta) }));
    },
    'save-players': () => {
      const text = $('#playersText').value;
      run(() => E.setPlayers(state, text), 'Liste enregistrée');
    },
    'demo-players': () => {
      const n = Number(window.prompt('Nombre de joueurs fictifs à générer (2 à 64) :', '24'));
      if (!(n >= 2 && n <= 64)) return;
      if (state.players.length && !window.confirm('Remplacer la liste actuelle par ' + n + ' joueurs fictifs ?')) return;
      const names = Array.from({ length: n }, (_, i) => 'Joueur ' + String(i + 1).padStart(2, '0'));
      run(() => E.setPlayers(state, names), n + ' joueurs fictifs ajoutés');
    },
    'start': () => {
      const res = run(() => E.startTournament(state), 'Tournoi démarré');
      if (res) { ui.tab = state.rounds.length ? 'swiss' : 'brackets'; saveUI(); render(); }
    },
    'next-round': () => run(() => E.generateNextSwissRound(state), 'Nouvelle ronde générée'),
    'open-match': el => openMatch(el.dataset.id),
    'close-dialog': () => closeDialog(),
    'score-step': el => {
      const input = $('#score' + el.dataset.side);
      input.value = Math.max(0, (Number(input.value) || 0) + Number(el.dataset.delta));
    },
    'forfeit': el => {
      if (!window.confirm('Déclarer ' + pname(el.dataset.id) + ' forfait pour ce match ?')) return;
      if (run(o => E.setResult(state, ui.dialogMatchId, { forfeitBy: el.dataset.id }, o), 'Forfait enregistré')) closeDialog();
    },
    'clear-result': () => {
      if (!window.confirm('Effacer le résultat de ce match ?')) return;
      if (run(o => E.clearResult(state, ui.dialogMatchId, o), 'Résultat effacé')) closeDialog();
    },
    'dialog-assign': () => {
      const c = $('#courtSelect').value;
      if (!c) { run(() => E.unassignCourt(state, ui.dialogMatchId)); return; }
      run(() => E.assignCourt(state, ui.dialogMatchId, c), 'Match lancé sur ' + courtLabel(c));
    },
    'dialog-unassign': () => run(() => E.unassignCourt(state, ui.dialogMatchId), 'Terrain libéré'),
    'assign': el => run(() => E.assignCourt(state, el.dataset.id, el.dataset.court), 'Match lancé'),
    'auto-assign': () => run(() => E.autoAssignCourts(state), 'Terrains affectés'),
    'gym-toggle': () => { ui.gym = !ui.gym; saveUI(); render(); },
    'fullscreen-courts': () => requestFs($('#view')),
    'division': el => { ui.division = el.dataset.id; saveUI(); render(); },
    'partition': el => { ui.partitionKey = el.value; render(); },
    'freeze': () => {
      const { sizes } = currentPartition(state.players.length);
      const desc = E.describePartition(sizes);
      const msg = 'Figer les têtes de série ?\n\nDivisions : ' + desc.divisions.map(d => d.name + ' = places ' + d.rankStart + '-' + d.rankEnd + ' (' + (d.format === 'pool' ? 'poule' : 'tableau') + ')').join(', ') +
        '\n' + desc.total + ' matchs de classement.\n\n' + desc.warnings.join('\n') + '\n\nLe brassage ne pourra plus être modifié sans supprimer les tableaux.';
      if (!window.confirm(msg)) return;
      const res = run(() => E.freezeDivisions(state, sizes), 'Tableaux générés');
      if (res) { ui.division = state.divisions[0].id; saveUI(); render(); }
    },
    'reopen-swiss': () => {
      const played = state.matches.filter(m => m.phase === 'final' && m.result).length;
      if (!window.confirm('Rouvrir le brassage supprimera les ' + state.divisions.length + ' division(s) et ' + played + ' résultat(s) de tableau. Continuer ?')) return;
      run(() => E.reopenSwiss(state), 'Brassage rouvert');
    },
    'zoom': el => { ui.zoom = Math.min(2.5, Math.max(0.3, Math.round((ui.zoom + Number(el.dataset.delta)) * 100) / 100)); saveUI(); render(); },
    'zoom-fit': () => {
      const sc = $('#bracketScroll'), svg = sc && sc.querySelector('svg');
      if (!svg) return;
      ui.zoom = Math.max(0.3, Math.min(2.5, Math.floor((sc.clientWidth - 4) / svg.viewBox.baseVal.width * 100) / 100));
      saveUI(); render();
    },
    'zoom-reset': () => { ui.zoom = 1; saveUI(); render(); const sc = $('#bracketScroll'); if (sc) { sc.scrollLeft = 0; sc.scrollTop = 0; } },
    'fullscreen': () => requestFs($('#bracketScroll')),
    'export-svg': () => { const s = currentSVGString(); if (s) download(slug(state.tournament.name) + '-tableau-' + ui.division + '.svg', s, 'image/svg+xml'); },
    'export-png': () => exportPNG(),
    'print-landscape': () => printLandscape(),
    'print': () => window.print(),
    'export-csv': () => download(slug(state.tournament.name) + '-classement.csv', E.standingsCSV(state), 'text/csv;charset=utf-8'),
    'export-results': () => download(slug(state.tournament.name) + '-resultats.csv', E.resultsCSV(state), 'text/csv;charset=utf-8'),
    'export-json': () => download(slug(state.tournament.name) + '-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(state, null, 1), 'application/json'),
    'reset-matches': () => {
      if (!window.confirm('Supprimer TOUS les matchs, rondes et tableaux de ce tournoi ? Les joueurs et paramètres sont conservés.')) return;
      if (window.prompt('Pour confirmer, tapez REINITIALISER') !== 'REINITIALISER') { toast('Réinitialisation annulée.'); return; }
      run(() => E.resetMatches(state), 'Matchs réinitialisés');
    },
    'delete-tournament': () => {
      if (!window.confirm('Supprimer définitivement le tournoi « ' + state.tournament.name + ' » de cet appareil ?')) return;
      if (window.prompt('Pour confirmer, tapez SUPPRIMER') !== 'SUPPRIMER') { toast('Suppression annulée.'); return; }
      Store.remove(state.tournament.id);
      const rest = Store.list();
      if (rest.length) switchTournament(rest[0].id); else newTournament();
      toast('Tournoi supprimé.');
    },
    'withdraw': el => {
      const w = el.dataset.value === '1';
      if (w && !window.confirm('Retirer ' + pname(el.dataset.id) + ' du tournoi ? Ses matchs non joués seront perdus par forfait.')) return;
      run(() => E.setWithdrawn(state, el.dataset.id, w), w ? 'Joueur retiré' : 'Joueur réintégré');
    },
    'rename': el => {
      const n = window.prompt('Nouveau nom :', pname(el.dataset.id));
      if (n == null) return;
      run(() => E.renamePlayer(state, el.dataset.id, n), 'Joueur renommé');
    },
    'add-late': () => {
      const input = $('#lateName');
      if (run(() => E.addLatePlayer(state, input.value), 'Joueur ajouté')) { /* rendu effectué */ }
    },
    'reload-external': () => { ui.externalChange = false; switchTournament(state.tournament.id); }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || (el.tagName === 'INPUT' && el.type === 'radio')) return; // les boutons radio sont gérés par 'change'
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('g.node[data-action]')) {
      e.preventDefault();
      openMatch(e.target.dataset.id);
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'tournamentSelect') { switchTournament(el.value); return; }
    if (el.id === 'importInput') { if (el.files[0]) importJSON(el.files[0]); el.value = ''; return; }
    if (el.id === 'csvInput') {
      const f = el.files[0]; el.value = '';
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const names = E.parseCSVNames(String(reader.result));
        const ta = $('#playersText');
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + names.join('\n');
        $('#playersCheck').textContent = playersCheckText(ta.value) + ' — ' + names.length + ' nom(s) importé(s), pensez à enregistrer.';
      };
      reader.readAsText(f);
      return;
    }
    if (el.dataset.action === 'partition') { ui.partitionKey = el.value; render(); return; }
    if (el.id === 'customSizes') { ui.customSizes = el.value; ui.partitionKey = 'custom'; render(); return; }
    if (el.dataset.info) { run(() => E.updateInfo(state, { [el.dataset.info]: el.value })); return; }
    if (el.dataset.setting) {
      const v = el.type === 'checkbox' ? el.checked : el.value;
      run(() => E.updateSettings(state, { [el.dataset.setting]: v }));
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'playersText') $('#playersCheck').textContent = playersCheckText(e.target.value);
  });

  document.addEventListener('submit', e => {
    if (e.target.id === 'matchForm') { e.preventDefault(); submitScore(); }
  });

  $('#matchDialog').addEventListener('close', () => { ui.dialogMatchId = null; });
  $('#matchDialog').addEventListener('click', e => { if (e.target.id === 'matchDialog') closeDialog(); });

  window.addEventListener('storage', e => {
    if (state && e.key === keyT(state.tournament.id)) { ui.externalChange = true; renderBanner(); }
    if (e.key === KEY_INDEX) renderSwitcher();
  });

  /* ------------------------------------------------------------------ *
   * Démarrage
   * ------------------------------------------------------------------ */
  (function init() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY_UI) || '{}'); } catch (e) { /* ignore */ }
    const list = Store.list();
    const id = saved.currentId && list.some(x => x.id === saved.currentId) ? saved.currentId : (list[0] && list[0].id);
    state = id ? Store.load(id) : null;
    if (!state) { newTournament(); return; }
    if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'config';
    render();
  })();

  // Exposé pour les tests de parcours (lecture seule).
  window.__tournoi = { getState: () => state };
})();
