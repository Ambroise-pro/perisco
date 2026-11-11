/*
 * Parcours navigateur (Playwright, non inclus) : node tests/e2e/parcours.js [dossier-captures]
 * Scénario CLAUDE.md : créer une classe → appel → valider les terrains → matchs → scores →
 * clôture → Elo → séance suivante ; rechargement ; migration d'une sauvegarde V1.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');

const FILE = 'file://' + path.resolve(__dirname, '../../index.html');
const OUT = process.argv[2] || path.resolve(__dirname, 'captures');
fs.mkdirSync(OUT, { recursive: true });
const check = (cond, msg) => { if (!cond) throw new Error('ÉCHEC : ' + msg); console.log('  ✓ ' + msg); };

async function noConflict(page) {
  return page.evaluate(() => {
    const db = window.__racket.getDB();
    const c = db.classes.find(x => x.id === db.active);
    const s = c.sessions.find(x => x.status !== 'closed');
    if (!s) return true;
    const act = s.matches.filter(m => m.court && !m.done);
    const pl = act.flatMap(m => [m.a, m.b]), ct = act.map(m => m.court);
    const avail = window.RacketEngine.availableCourts(c, s);
    return new Set(pl).size === pl.length && new Set(ct).size === ct.length && ct.every(t => avail.includes(t));
  });
}

async function playAll(page, counter) {
  for (let guard = 0; guard < 400; guard++) {
    if (!(await noConflict(page))) throw new Error('ÉCHEC : conflit de terrain ou d\'élève');
    const row = await page.$('.match.st-playing');
    if (!row) return;
    // Saisie au toucher : « X gagne : 11 » puis le score du perdant avec « + », puis Valider
    const i = counter.n++;
    await (await row.$('[data-action="score-sheet"]')).click();
    await page.waitForSelector('#scoreDialog[open] .ss-player');
    const win = i % 2 ? 'sa' : 'sb', lose = i % 2 ? 'sb' : 'sa';
    await page.click('#scoreDialog [data-action="ss-target"][data-side="' + win + '"]');
    for (let k = 0; k < i % 9; k++) await page.click('#scoreDialog [data-action="ss-step"][data-side="' + lose + '"][data-delta="1"]');
    await page.click('#scoreDialog [data-action="ss-validate"]');
    await page.waitForFunction(() => !document.querySelector('#scoreDialog').open);
  }
}

async function scenario(browser, label, ctxOpts) {
  console.log('\n— Parcours ' + label);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('3e Test') : d.accept());
  await page.goto(FILE);
  await page.click('[data-action="add-class"]');
  await page.fill('#bulk', Array.from({ length: 12 }, (_, i) => 'Élève ' + (i + 1)).join('\n'));
  await page.click('[data-action="bulk-students"]');
  check(await page.evaluate(() => window.__racket.getDB().classes[0].students.length) === 12, 'classe créée avec 12 élèves');

  // Séance 1 : poules
  await page.click('[data-tab="session"]');
  await page.click('[data-action="draft"][data-key="mode"][data-value="pools"]');
  await page.click('[data-action="create-session"]');
  await page.click('[data-action="toggle-absent"] >> nth=11');
  const present = await page.evaluate(() => window.__racket.getDB().classes[0].sessions[0].positions.length);
  check(present === 11, 'appel : 1 absent, 11 présents');
  const groups = await page.evaluate(() => window.__racket.getDB().classes[0].sessions[0].groups.map(g => g.length));
  check(Math.max(...groups) - Math.min(...groups) <= 1, 'groupes équilibrés proposés : ' + groups.join('+'));
  await page.click('[data-action="placement-opt"][data-key="distribution"][data-value="balanced"]');
  const bal = await page.evaluate(() => { const c = window.__racket.getDB().classes[0]; return c.sessions[0].distribution; });
  await page.click('[data-action="placement-opt"][data-key="distribution"][data-value="level"]');
  const lvl = await page.evaluate(() => { const c = window.__racket.getDB().classes[0], s = c.sessions[0], R = window.RacketEngine; return s.distribution === 'level' && JSON.stringify(s.groups.flat()) === JSON.stringify(R.presentIds(c, s)); });
  check(bal === 'balanced' && lvl && /Elo moy\./.test(await page.textContent('#view')), 'poules réparties automatiquement par niveau Elo (ou équilibrées), Elo moyen affiché');
  await page.screenshot({ path: path.join(OUT, label + '-1-appel.png'), fullPage: true });
  await page.click('[data-action="start-session"]');
  await page.click('[data-action="regroup-session"]');
  check(await page.evaluate(() => window.__racket.getDB().classes[0].sessions[0].status) === 'setup', 'poules refaites par niveau Elo avant tout résultat');
  await page.click('[data-action="start-session"]');
  const playing = await page.$$eval('.match.st-playing', n => n.length);
  check(playing > 0 && playing <= 4, `${playing} match(s) en cours sur 4 terrains maximum`);
  const cardStakes = await page.$$eval('.match .stake', n => n.map(x => x.textContent));
  const nCards = await page.$$eval('.match', n => n.length);
  check(cardStakes.length === nCards * 2 && cardStakes.every(t => /V \+\d+/.test(t) && /D −\d+/.test(t)), 'cartes de match : enjeu Elo affiché pour les 2 joueurs (' + nCards + ' cartes)');
  await page.screenshot({ path: path.join(OUT, label + '-2-seance.png'), fullPage: true });
  check(/Classement des poules/.test(await page.textContent('#view')) && /Départagé par/.test(await page.textContent('#view')), 'classement par poule avec critère de départage affiché');

  // Mode projection : seconde fenêtre en lecture seule, mise à jour en direct, sans Elo
  const proj = await ctx.newPage();
  await proj.goto(FILE + '#projection');
  await proj.waitForSelector('.proj-pool-card');
  const projPools = await proj.evaluate(() => {
    const s = window.__racket.getDB().classes[0].sessions[0], names = window.__racket.getDB().classes[0].students.reduce((o, p) => (o[p.id] = p.name, o), {});
    const cards = [...document.querySelectorAll('.proj-pool-card')];
    return cards.length === s.groups.length && s.groups.every((g, i) => g.every(id => cards[i].querySelector('.ppc-players').textContent.includes(names[id])));
  });
  check(projPools, 'projection poules : chaque poule affichée avec tous ses joueurs (pas le premier match)');
  check(!/Elo/i.test(await proj.innerText('body')), 'projection : aucune donnée Elo affichée');
  const projBefore = await proj.textContent('.proj-prog');
  // Toucher le terrain 1 ouvre la saisie du score (sans clavier)
  await page.click('.court-card .cd-hit >> nth=0');
  await page.waitForSelector('#scoreDialog[open] .ss-player');
  check(await page.$('#scoreDialog .ss-tie') !== null, 'saisie : validation bloquée tant que le score est à égalité');
  const ssStakes = await page.$$eval('#scoreDialog .stake', n => n.map(x => x.textContent));
  check(ssStakes.length === 2 && ssStakes.every(t => /Elo \d+/.test(t) && /Victoire \+\d+/.test(t) && /Défaite −\d+/.test(t)), 'saisie : Elo des joueurs et gain/perte possibles affichés (' + ssStakes[0] + ')');
  await page.click('#scoreDialog [data-action="ss-target"][data-side="sa"]');
  for (let k = 0; k < 4; k++) await page.click('#scoreDialog [data-action="ss-step"][data-side="sb"][data-delta="1"]');
  check((await page.textContent('#scoreDialog .ss-validate')).includes('11 – 4'), 'saisie au toucher : 11 – 4 sans clavier');
  if (label === 'ordinateur') await page.screenshot({ path: path.join(OUT, 'saisie-score.png') });
  await page.click('#scoreDialog [data-action="ss-validate"]');
  check(/[+−]\d+ à la clôture/.test(await page.textContent('#view')), 'carte d\'un match terminé : variation Elo obtenue affichée');
  await page.screenshot({ path: path.join(OUT, label + '-cartes-enjeu.png'), fullPage: true });
  await page.waitForFunction(() => !document.querySelector('#scoreDialog').open);
  await proj.waitForFunction(b => document.querySelector('.proj-prog').textContent !== b, projBefore, { timeout: 5000 });
  check(true, 'projection mise à jour automatiquement après une saisie (' + (await proj.textContent('.proj-prog')) + ')');
  check(/Poule 1/.test(await proj.textContent('.proj-pool-card')), 'projection : cartes de poule lisibles');
  if (label === 'ordinateur') await proj.screenshot({ path: path.join(OUT, label + '-projection.png') });
  await proj.close();
  const counter = { n: 0 };
  await playAll(page, counter);
  check(await page.evaluate(() => window.__racket.getDB().classes[0].sessions[0].matches.every(m => m.done)), 'tous les matchs de poule saisis, sans conflit');
  await page.click('[data-action="close-session"]');
  const elo = await page.evaluate(() => {
    const c = window.__racket.getDB().classes[0];
    return { sum: c.students.length, ranked: document.querySelectorAll('#view table tbody tr').length };
  });
  check(elo.ranked >= 12, 'classement Elo affiché après clôture');
  const st = await page.evaluate(() => {
    const db = window.__racket.getDB(), c = db.classes[0];
    const R = window.RacketEngine, s = R.computeStats(c);
    const absentId = c.sessions[0].absent[0];
    return { total: Object.values(s).reduce((a, p) => a + p.elo, 0), absent: s[absentId].elo, changed: Object.values(s).some(p => p.elo !== 1000) };
  });
  check(Math.abs(st.total - 12000) < 1e-6 && st.changed, 'Elo recalculé, somme conservée (12 000)');
  check(st.absent === 1000, 'l\'absent conserve son Elo');
  await page.click('[data-tab="dashboard"]');
  check(await page.$('.backup-reminder') !== null && await page.getAttribute('.top [data-action="export-json"]', 'data-count') === '1', 'rappel de sauvegarde : 1 séance clôturée non sauvegardée (accueil et pastille)');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.click('.backup-reminder [data-action="export-json"]')]);
  check(/\.json$/.test(bk.suggestedFilename()) && await page.$('.backup-reminder') === null, 'sauvegarde téléchargée, le rappel disparaît');

  // Séance 2 : ronde suisse, proposition selon l'Elo
  await page.click('[data-tab="session"]');
  await page.click('[data-action="draft"][data-key="mode"][data-value="swiss"]');
  await page.click('[data-action="draft-step"][data-key="rounds"][data-delta="-1"]');
  await page.click('[data-action="draft-step"][data-key="rounds"][data-delta="-1"]');
  check(await page.textContent('.row-step b') === '2', 'nouvelle séance réglée sans clavier (ronde suisse, 2 rondes)');
  await page.click('[data-action="create-session"]');
  const ordered = await page.evaluate(() => {
    const c = window.__racket.getDB().classes[0], R = window.RacketEngine;
    return JSON.stringify(c.sessions[1].positions) === JSON.stringify(R.ranks(c).map(p => p.id));
  });
  check(ordered, 'séance suivante : placement proposé dans l\'ordre Elo');
  await page.click('[data-action="shift"][data-dir="1"] >> nth=0');
  await page.click('[data-action="start-session"]');
  await playAll(page, counter);
  await page.click('[data-action="next-round"]');
  await playAll(page, counter);
  await page.screenshot({ path: path.join(OUT, label + '-3-suisse.png'), fullPage: true });
  await page.click('[data-action="close-session"]');
  check(await page.evaluate(() => window.__racket.getDB().classes[0].sessions.every(s => s.status === 'closed')), 'deux séances clôturées');

  // Rouvrir puis annuler la correction : la séance n'est pas perdue
  await page.click('[data-tab="history"]');
  await page.click('[data-action="reopen"] >> nth=1');
  await page.click('[data-action="cancel-session"]');
  check(await page.evaluate(() => window.__racket.getDB().classes[0].sessions.length === 2 && window.__racket.getDB().classes[0].sessions.every(s => s.status === 'closed')), 'annuler une correction restaure la séance (plus de perte de données)');

  // Rechargement
  const before = await page.evaluate(() => JSON.stringify(window.__racket.getDB()));
  await page.reload();
  check(before === await page.evaluate(() => JSON.stringify(window.__racket.getDB())), 'données identiques après rechargement');

  // Fiche élève
  await page.click('[data-tab="ranking"]');
  await page.screenshot({ path: path.join(OUT, label + '-4-classement.png'), fullPage: true });
  await page.click('#view [data-action="student"] >> nth=0');
  await page.waitForSelector('#studentDialog[open]');
  check(/Évolution par séance/.test(await page.textContent('#studentDialog')), 'fiche élève ouverte dans une fenêtre (pop-up)');
  check(await page.$$eval('#eloChart circle', n => n.length) === 2 && await page.$$eval('#rankChart circle', n => n.length) === 2, 'graphiques Elo et rang : un point par séance clôturée');
  await page.hover('#eloChart svg', { position: { x: 30, y: 60 } });
  await page.waitForSelector('#eloChart .tip:not([hidden])');
  check(/Séance 1/.test(await page.textContent('#eloChart .tip')), 'survol du graphique : info-bulle de la séance la plus proche');
  await page.focus('#rankChart');
  await page.keyboard.press('ArrowLeft');
  check(/Séance 1/.test(await page.textContent('#rankChart .tip')), 'graphique utilisable au clavier (flèches)');
  await page.screenshot({ path: path.join(OUT, label + '-5-graphiques.png'), fullPage: false });
  await page.keyboard.press('Escape');
  check(!(await page.$('#studentDialog[open]')), 'fiche fermée avec Échap');

  for (const t of ['dashboard', 'students', 'session', 'ranking', 'history', 'settings']) {
    await page.click(`[data-tab="${t}"]`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 1, `onglet ${t} : pas de débordement horizontal`);
  }
  check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await ctx.close();
}

async function migration(browser) {
  console.log('\n— Migration d\'une sauvegarde V1');
  const v1 = {
    classes: [{ id: 'c', name: '4e A', sport: 'Badminton', courts: 2, k: 32,
      students: ['a', 'b', 'c', 'd', 'e', 'f'].map(x => ({ id: x, name: 'Élève ' + x.toUpperCase() })),
      sessions: [{ id: 's', seq: 1, date: '2026-01-01', mode: 'pools', status: 'playing', absent: [], positions: ['a', 'b', 'c', 'd', 'e', 'f'], round: 1, rounds: 3, groupSize: 3, k: 32,
        matches: [['a', 'b', 1], ['a', 'c', 1], ['b', 'c', 1], ['d', 'e', 2], ['d', 'f', 2], ['e', 'f', 2]].map(([a, b, t], i) => ({ id: 'm' + i, a, b, sa: null, sb: null, done: false, round: 1, court: t })) }] }],
    active: 'c'
  };
  const ctx = await browser.newContext();
  await ctx.addInitScript(data => { if (!localStorage.getItem('racket_eps_v1')) localStorage.setItem('racket_eps_v1', data); }, JSON.stringify(v1));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(FILE);
  await page.click('[data-tab="session"]');
  check(await page.$$eval('.match.st-playing', n => n.length) === 2, 'V1 migrée : 2 matchs en cours sur 2 terrains (au lieu de 6 attribués d\'avance)');
  check(await noConflict(page), 'aucun conflit après migration');
  await playAll(page, { n: 0 });
  await page.click('[data-action="close-session"]');
  check(await page.evaluate(() => window.__racket.getDB().schemaVersion === 2 && window.__racket.getDB().classes[0].sessions[0].status === 'closed'), 'séance V1 terminée et clôturée, schéma 2');
  check(errors.length === 0, 'aucune erreur JavaScript');
  await ctx.close();
}

async function demoClass(browser) {
  console.log('\n— Classe exemple');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const answers = ['24', '4'];
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(answers.shift()) : d.accept());
  await page.goto(FILE);
  await page.click('.top [data-action="demo-class"]');
  const info = await page.evaluate(() => { const c = window.__racket.getDB().classes[0]; return { n: c.students.length, s: c.sessions.length, demo: c.demo, closed: c.sessions.every(x => x.status === 'closed') }; });
  check(info.demo && info.n === 24 && info.s === 4 && info.closed, 'classe exemple : 24 élèves fictifs, 4 séances simulées clôturées');
  check(/données fictives/.test(await page.innerText('#view')), 'classe signalée comme fictive');
  await page.click('#view [data-action="student"] >> nth=0');
  await page.waitForSelector('#studentDialog[open]');
  check(await page.$$eval('#studentDialog #eloChart circle', n => n.length) === 4, 'fiche en pop-up : graphiques alimentés par les séances simulées');
  // Elo saisi à la main depuis la fiche (boutons, sans clavier)
  const elo0 = await page.evaluate(() => { const c = window.__racket.getDB().classes[0], id = document.querySelector('#studentDialog [data-action="elo-edit"]').dataset.id; return { id, elo: Math.round(window.RacketEngine.computeStats(c)[id].elo) }; });
  await page.click('#studentDialog [data-action="elo-edit"]');
  await page.click('#studentDialog [data-action="elo-step"][data-delta="50"]');
  await page.click('#studentDialog [data-action="elo-step"][data-delta="50"]');
  await page.click('#studentDialog [data-action="elo-step"][data-delta="-10"]');
  await page.click('#studentDialog [data-action="elo-save"]');
  const elo1 = await page.evaluate(id => Math.round(window.RacketEngine.computeStats(window.__racket.getDB().classes[0])[id].elo), elo0.id);
  check(elo1 === elo0.elo + 90 && /Fixé à/.test(await page.textContent('#studentDialog')), 'Elo fixé à la main depuis la fiche (+50 +50 −10 → +90), ajustement visible');
  await page.screenshot({ path: path.join(OUT, 'elo-manuel-fiche.png') });
  await page.click('#studentDialog [data-action="elo-remove"]');
  const elo2 = await page.evaluate(id => Math.round(window.RacketEngine.computeStats(window.__racket.getDB().classes[0])[id].elo), elo0.id);
  check(elo2 === elo0.elo, 'ajustement annulé : retour à l\'Elo calculé');
  await page.click('[data-action="student-close"]');
  // AFL : marquer depuis la fiche puis filtrer (élèves et classement)
  await page.click('#view [data-action="student"] >> nth=0');
  await page.waitForSelector('#studentDialog[open]');
  await page.click('#studentDialog [data-action="afl-open"][data-afl="AFL1"]');
  await page.waitForSelector('#aflDialog[open]');
  await page.click('#aflDialog [data-action="afl-degree"][data-value="3"]');
  await page.fill('#aflNote', 'Varie les trajectoires, gagne des points en fond de court');
  await page.screenshot({ path: path.join(OUT, 'afl-evaluation.png') });
  await page.click('#aflDialog [data-action="afl-save"]');
  const aflTxt = await page.textContent('#studentDialog .afl-fiche');
  check(await page.$('#studentDialog .afl-chip.on[data-afl="AFL1"]') !== null && /degré 3/.test(aflTxt) && /Varie les trajectoires/.test(aflTxt), 'fiche : AFL1 évalué au degré 3 avec une note justificative');
  await page.click('[data-action="student-close"]');
  await page.click('[data-tab="students"]');
  await page.click('.listrow .afl-chip:not(.on)[data-action="afl-open"][data-afl="AFL1"] >> nth=0');
  await page.click('#aflDialog [data-action="afl-degree"][data-value="2"]');
  await page.click('#aflDialog [data-action="afl-save"]');
  await page.click('[data-action="afl-mode"][data-value="done"]');
  const nDone = await page.$$eval('.listrow', n => n.length);
  await page.click('[data-action="afl-mode"][data-value="todo"]');
  const nTodo = await page.$$eval('.listrow', n => n.length);
  check(nDone === 2 && nTodo === 22, 'élèves filtrés par AFL1 : ' + nDone + ' évalués, ' + nTodo + ' à évaluer');
  await page.click('[data-tab="ranking"]');
  const rankRows = await page.$$eval('#view tbody tr', n => n.length);
  check(rankRows === 22 && /À évaluer \(22\)/.test(await page.textContent('.afl-bar')), 'classement filtré « à évaluer » (rangs conservés)');
  await page.screenshot({ path: path.join(OUT, 'afl-filtre.png') });
  await page.click('[data-action="afl-mode"][data-value="all"]');
  check(await page.$('.top [data-action="fullscreen"]') !== null, 'bouton plein écran dans l\'en-tête');
  // Modifier plusieurs Elo depuis le classement
  await page.click('[data-action="elo-bulk-edit"]');
  await page.click('[data-action="elo-bulk-step"][data-delta="10"] >> nth=1');
  await page.click('[data-action="elo-bulk-step"][data-delta="-10"] >> nth=2');
  await page.click('[data-action="elo-bulk-save"]');
  const adj = await page.evaluate(() => (window.__racket.getDB().classes[0].eloAdjustments || []).length);
  check(adj === 2 && (await page.$$('#view .badge[title="Elo fixé à la main"]')).length === 2, 'classement : 2 Elo modifiés d\'un coup, marqués ✎');

  // Groupes de travail
  await page.click('[data-tab="groups"]');
  await page.click('[data-action="wg-courts"][data-delta="-1"]');
  await page.click('[data-action="wg-courts"][data-delta="-1"]');
  await page.click('#view details summary');
  await page.check('input[data-action="wg-absent"] >> nth=0');
  const wg = await page.evaluate(() => { const c = window.__racket.getDB().classes[0]; return { courts: c.workGroups.courts, sizes: c.workGroups.groups.map(g => g.length), spread: window.RacketEngine.workGroupStats(c).spread }; });
  check(wg.courts === 4 && wg.sizes.reduce((a, b) => a + b, 0) === 23 && Math.max(...wg.sizes) - Math.min(...wg.sizes) <= 1, 'groupes de travail : 23 présents sur 4 terrains (' + wg.sizes.join('+') + ')');
  await page.selectOption('#wgMode', 'level');
  const lvl = await page.evaluate(() => window.RacketEngine.workGroupStats(window.__racket.getDB().classes[0]).spread);
  check(wg.spread < lvl, 'répartition équilibrée : écart des moyennes ' + wg.spread.toFixed(0) + ' contre ' + lvl.toFixed(0) + ' par niveau');
  await page.selectOption('#wgMode', 'balanced');
  await page.screenshot({ path: path.join(OUT, 'groupes-de-travail.png'), fullPage: true });
  check(await page.$$eval('.wg-card .court-draw .cd-player', n => n.length) === 23, 'groupes de travail : les 23 présents dessinés sur leur terrain');
  await page.click('#view .wg-card [data-action="student"] >> nth=0');
  check(!!(await page.$('#studentDialog[open]')), 'fiche accessible depuis les groupes de travail');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT, 'exemple-classement.png'), fullPage: true });
  await page.click('[data-tab="session"]');
  await page.click('[data-action="create-session"]');
  await page.click('[data-action="start-session"]');
  check(await page.$$eval('.match.st-playing', n => n.length) === 6, 'nouvelle séance possible sur la classe exemple (6 terrains occupés)');
  // Terrains dessinés selon le sport, élèves placés dessus
  const draw = await page.evaluate(() => ({
    n: document.querySelectorAll('.court-card .court-draw svg').length,
    sport: document.querySelector('.court-draw').dataset.sport,
    players: Array.from(document.querySelectorAll('.court-card')).filter(c => c.querySelectorAll('.cd-player').length === 2).length
  }));
  check(draw.n === 6 && draw.sport === 'badminton' && draw.players === 6, 'terrains de badminton dessinés, 2 élèves placés sur chacun des 6 terrains');
  const benchOk = await page.evaluate(() => {
    const playing = new Set(Array.from(document.querySelectorAll('.court-card .cd-name')).map(e => e.textContent));
    return Array.from(document.querySelectorAll('.bench-chip')).every(b => !playing.has(b.textContent));
  });
  check(benchOk, 'banc : aucun élève qui joue déjà sur un autre terrain');
  await page.screenshot({ path: path.join(OUT, 'terrains-badminton.png'), fullPage: false, clip: { x: 0, y: 330, width: 1280, height: 900 } });
  await page.click('[data-tab="settings"]');
  await page.selectOption('#sport', 'Tennis de table');
  await page.click('[data-action="save-settings"]');
  await page.click('[data-tab="session"]');
  check(await page.$eval('.court-draw', d => d.dataset.sport) === 'tt', 'changement de sport dans les réglages : terrains redessinés (tennis de table)');
  await page.screenshot({ path: path.join(OUT, 'terrains-tennis-de-table.png'), fullPage: false, clip: { x: 0, y: 330, width: 1280, height: 900 } });
  await page.click('[data-tab="settings"]');
  await page.selectOption('#sport', 'Badminton');
  await page.click('[data-action="save-settings"]');
  await page.click('[data-tab="session"]');
  // Terrains modifiés en cours de séance
  await page.click('[data-action="courts-step"][data-delta="1"]');
  check(await page.$$eval('.match.st-playing', n => n.length) === 7 && await noConflict(page), 'ajout d\'un terrain en cours de séance : 7 matchs en cours, sans conflit');
  await page.click('[data-action="court-toggle"][data-court="2"]');
  const on2 = await page.evaluate(() => { const c = window.__racket.getDB().classes[0]; const s = c.sessions.find(x => x.status !== 'closed'); return s.matches.some(m => m.court === 2 && !m.done); });
  check(!on2 && await noConflict(page) && /Fermé/.test(await page.innerText('#view')), 'terrain 2 fermé (match en cours renvoyé en file après confirmation)');
  await page.click('[data-action="courts-step"][data-delta="-1"]');
  const state = await page.evaluate(() => { const c = window.__racket.getDB().classes[0]; const s = c.sessions.find(x => x.status !== 'closed'); return { total: s.courts, cls: c.courts, active: s.matches.filter(m => m.court && !m.done).length }; });
  check(state.total === 6 && state.cls === 6 && state.active === 5 && await noConflict(page), 'retrait d\'un terrain : 6 terrains dont 1 fermé, 5 matchs en cours ; réglage de la classe inchangé');
  await page.click('[data-action="court-toggle"][data-court="2"]');
  check(await page.$$eval('.match.st-playing', n => n.length) === 6, 'terrain 2 rouvert : 6 matchs en cours');
  await page.screenshot({ path: path.join(OUT, 'exemple-terrains.png'), fullPage: false });
  check(errors.length === 0, 'aucune erreur JavaScript');
  await ctx.close();
}

// Écrit une vidéo .y4m (caméra simulée de Chromium) où l'on voit le QR du texte, tourné et incliné.
function writeCameraVideo(file, text) {
  const { render } = require('../qr-render.js');
  const W = 640, H = 480;
  const frames = [];
  for (let i = 0; i < 6; i++) frames.push(render(text, { W, H, module: 6, angle: 8 + i, tilt: 0.06, noise: 10, seed: i }).data);
  const head = Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F5:1 Ip A1:1 C420jpeg\n');
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const parts = [head];
  frames.forEach(y => { parts.push(Buffer.from('FRAME\n'), Buffer.from(y), uv); });
  fs.writeFileSync(file, Buffer.concat(parts));
}

// Petit serveur statique local : les QR codes exigent une adresse http(s), comme sur Vercel.
function serve() {
  const http = require('http');
  const root = path.resolve(__dirname, '../..');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const f = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '') || 'index.html');
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); resp.end(); return; }
      resp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

async function qrFlow(browser) {
  console.log('\n— QR codes : feuille de match sur tablette et mode scan');
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const answers = ['8', '0'];
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(answers.shift()) : d.accept());
  await page.goto(BASE);
  await page.click('.top [data-action="demo-class"]');
  await page.click('[data-tab="session"]');
  await page.click('[data-action="create-session"]');
  await page.click('[data-action="start-session"]');
  // Projection des poules : un QR par poule (feuille de toute la poule) et tous les joueurs
  const pj = await ctx.newPage();
  await pj.goto(BASE + '#projection');
  await pj.waitForSelector('.proj-pool-card');
  const pjInfo = await pj.evaluate(() => ({ cards: document.querySelectorAll('.proj-pool-card').length, qrs: document.querySelectorAll('.proj-pool-card .ppc-qr svg').length, players: document.querySelectorAll('.ppc-players li').length, groups: window.__racket.getDB().classes[0].sessions.find(x => x.status !== 'closed').groups }));
  check(pjInfo.cards === pjInfo.groups.length && pjInfo.qrs === pjInfo.cards && pjInfo.players === pjInfo.groups.flat().length, 'projection : ' + pjInfo.cards + ' poules, chacune avec son QR et tous ses joueurs (' + pjInfo.players + ')');
  await pj.screenshot({ path: path.join(OUT, 'projection-poules.png') });
  await pj.close();
  // En poules classiques, le QR d'un terrain ouvre la feuille de SA poule (tous les matchs), pas un seul match.
  await page.click('.court-card [data-action="qr-match"] >> nth=0');
  await page.waitForSelector('#qrDialog[open]');
  const courtHref = await page.getAttribute('#qrDialog .qr-link a', 'href');
  check(courtHref && courtHref.startsWith(BASE + '#p=') && /Poule/.test(await page.textContent('#qrTitle')), 'poules : le QR du terrain mène à la feuille de la poule (tous les matchs)');
  check(await page.$('#qrDialog .qr-img svg') !== null, 'QR code dessiné (générateur qr.js)');
  await page.click('[data-action="qr-close"]');
  await page.click('.match.st-playing [data-action="score-sheet"] >> nth=0');
  await page.click('#scoreDialog .ss-more summary');
  check(/QR de la poule/.test(await page.textContent('#scoreDialog .ss-more')), 'poules : le panneau de saisie propose le QR de la poule');
  await page.click('#scoreDialog [data-action="ss-close"]');
  // Feuille d'un seul match (utilisée par les autres formats) : lien construit comme dans l'application
  const href = await page.evaluate(base => {
    const R = window.RacketEngine, db = window.__racket.getDB(), c = db.classes[0], s = c.sessions.find(x => x.status !== 'closed');
    const m = s.matches.find(x => x.court && !x.done);
    return base + '#f=' + R.encodeSheet(R.sheetData(c, s, m));
  }, BASE);
  check(href.startsWith(BASE + '#f='), 'feuille d\'un seul match : lien (' + href.length + ' caractères)');

  // Tablette élève
  const tab = await browser.newContext(devices['iPad (gen 7)']);
  const t = await tab.newPage();
  t.on('pageerror', e => errors.push('tablette : ' + e.message));
  t.on('dialog', d => d.accept());
  await t.goto(href);
  await t.waitForSelector('.sheet-player');
  const names = await t.$$eval('.sheet-name', n => n.map(x => x.textContent));
  const shStakes = await t.$$eval('.sheet-player .stake', n => n.map(x => x.textContent));
  check(shStakes.length === 2 && shStakes.every(x => /Victoire \+\d+/.test(x) && /Défaite −\d+/.test(x)), 'feuille de match : Elo et enjeu de chaque joueur');
  await t.screenshot({ path: path.join(OUT, 'feuille-match-enjeu.png') });
  for (let i = 0; i < 11; i++) await t.click('[data-action="sheet-step"][data-side="a"][data-delta="1"]');
  for (let i = 0; i < 5; i++) await t.click('[data-action="sheet-step"][data-side="b"][data-delta="1"]');
  await t.click('[data-action="sheet-step"][data-side="b"][data-delta="-1"]');
  await t.reload();
  check(await t.$$eval('.sheet-score output', o => o.map(x => x.textContent).join('-')) === '11-4', 'feuille de match : score 11-4 compté, conservé après rechargement');
  await t.click('[data-action="sheet-finish"]');
  const code = (await t.textContent('.sheet-code')).trim();
  check(/^RE1\./.test(code), 'tablette : code de résultat affiché (' + code + ')');
  await t.screenshot({ path: path.join(OUT, 'qr-tablette-resultat.png') });
  check(await t.$('.sheet .qr-img svg') !== null, 'tablette : QR de résultat dessiné');
  if (process.env.QR_SHOTS) {
    await t.locator('.sheet .qr-img').screenshot({ path: path.join(OUT, 'qr-resultat.png') });
    fs.writeFileSync(path.join(OUT, 'qr-attendus.json'), JSON.stringify({ feuille: href, resultat: code }));
  }
  check(await t.evaluate(() => !localStorage.getItem('racket_eps_v1')), 'la tablette n\'enregistre aucune donnée de la classe');

  // Mode scan sur l'appareil de l'enseignant (caméra factice)
  await page.click('[data-action="scan-open"]');
  await page.waitForSelector('.scan-panel');
  await page.waitForFunction(() => /Présentez|non disponible|refusée|inaccessible/.test(document.querySelector('.scan-status').textContent));
  const status = await page.textContent('.scan-status');
  check(true, 'mode scan ouvert : « ' + status.trim() + ' »');
  const hasVideo = await page.evaluate(() => { const v = document.querySelector('.scan-panel video'); return !v.hidden && !!v.srcObject; });
  console.log('    (aperçu caméra ' + (hasVideo ? 'actif' : 'masqué : pas de lecteur QR dans ce navigateur') + ')');
  await page.screenshot({ path: path.join(OUT, 'qr-mode-scan.png') });
  await page.fill('#scanCode', code.replace('.11.4.', '.11.5.'));
  await page.press('#scanCode', 'Enter');
  check(/contrôle/.test(await page.textContent('.scan-status')), 'code modifié refusé (contrôle)');
  await page.fill('#scanCode', code);
  await page.press('#scanCode', 'Enter');
  await page.waitForFunction(() => /Enregistré/.test(document.querySelector('.scan-status').textContent));
  const rec = await page.evaluate(n => {
    const c = window.__racket.getDB().classes[0], s = c.sessions.find(x => x.status !== 'closed');
    const id = x => c.students.find(p => p.name === x).id;
    const m = s.matches.find(x => x.a === id(n[0]) && x.b === id(n[1]));
    return m && m.done && m.sa === 11 && m.sb === 4;
  }, names);
  check(rec, 'résultat 11-4 enregistré dans la séance par le scan');
  await page.fill('#scanCode', code);
  await page.press('#scanCode', 'Enter');
  check(/Déjà enregistré/.test(await page.textContent('.scan-status')), 'second scan du même code : rien n\'est modifié');
  // Poules en autonomie : QR de poule → tous les matchs sur la tablette → un seul code
  await page.click('[data-action="scan-close"]');
  await page.click('[data-action="qr-pool"][data-group="0"]');
  await page.waitForSelector('#qrDialog[open]');
  const poolHref = await page.getAttribute('#qrDialog .qr-link a', 'href');
  check(poolHref.includes('#p=') && await page.$('#qrDialog .qr-img svg') !== null, 'QR de la poule 1 dessiné (lien vers la feuille de poule)');
  await page.click('[data-action="qr-close"]');
  const pt = await tab.newPage();
  pt.on('pageerror', e => errors.push('tablette poule : ' + e.message));
  pt.on('dialog', d => d.accept());
  await pt.goto(poolHref);
  await pt.waitForSelector('.pool-match');
  const nPool = await pt.$$eval('.pool-match', n => n.length);
  check(nPool === 6, 'tablette : les 6 matchs de la poule affichés');
  check((await pt.$$('.pool-match .stake')).length === 12, 'feuille de poule : Elo et gain/perte possibles pour chaque joueur de chaque match');
  await pt.screenshot({ path: path.join(OUT, 'feuille-poule-enjeu.png') });
  for (let i = 0; i < nPool; i++) {
    if (i === 2) {
      await pt.click('.pool-grid > .pool-match >> nth=2 >> summary');
      await pt.click(`[data-action="pool-forfeit"][data-i="${i}"][data-side="b"]`);
      continue;
    }
    for (let k = 0; k < 11; k++) await pt.click(`[data-action="pool-step"][data-i="${i}"][data-side="${i % 2 ? 'b' : 'a'}"][data-delta="1"]`);
    for (let k = 0; k < i + 1; k++) await pt.click(`[data-action="pool-step"][data-i="${i}"][data-side="${i % 2 ? 'a' : 'b'}"][data-delta="1"]`);
    await pt.click(`[data-action="pool-validate"][data-i="${i}"]`);
    if (i === 1) { await pt.reload(); await pt.waitForSelector('.pool-match'); }
  }
  check(await pt.$$eval('.pool-match.done', n => n.length) === 6, 'tablette : 6 matchs validés (dont un forfait), conservés après rechargement');
  await pt.screenshot({ path: path.join(OUT, 'poule-tablette.png'), fullPage: true });
  await pt.click('[data-action="pool-finish"]');
  const poolCode = (await pt.textContent('.sheet-code')).trim();
  check(/^RP1\./.test(poolCode) && await pt.$('.sheet .qr-img svg') !== null, 'tablette : un QR et un code pour toute la poule (' + poolCode.length + ' caractères)');
  await pt.screenshot({ path: path.join(OUT, 'poule-resultat.png'), fullPage: true });
  // Caméra simulée : on filme le QR de résultat de la poule ; le lecteur maison le lit tout seul.
  const video = path.join(OUT, 'camera-poule.y4m');
  writeCameraVideo(video, poolCode);
  const camBrowser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + video] });
  const camCtx = await camBrowser.newContext({ storageState: await ctx.storageState(), permissions: ['camera'], viewport: { width: 1280, height: 900 } });
  const cam = await camCtx.newPage();
  cam.on('pageerror', e => errors.push('caméra : ' + e.message));
  cam.on('dialog', d => d.accept());
  await cam.goto(BASE);
  await cam.click('[data-tab="session"]');
  await cam.click('[data-action="scan-open"]');
  await cam.waitForFunction(() => /Poule 1/.test((document.querySelector('.scan-status') || {}).textContent || ''), null, { timeout: 20000 });
  const camOk = await cam.evaluate(() => {
    const c = window.__racket.getDB().classes[0], s = c.sessions.find(x => x.status !== 'closed');
    return window.RacketEngine.groupMatches(s, 0).every(m => m.done);
  });
  check(camOk, 'caméra simulée : le QR filmé est lu par le lecteur de l\'application et la poule est enregistrée');
  await cam.screenshot({ path: path.join(OUT, 'scan-camera.png') });
  await camBrowser.close();

  await page.click('[data-action="scan-open"]');
  await page.waitForSelector('.scan-panel');
  await page.fill('#scanCode', poolCode);
  await page.press('#scanCode', 'Enter');
  await page.waitForFunction(() => /Poule 1/.test(document.querySelector('.scan-status').textContent));
  const poolDone = await page.evaluate(() => {
    const c = window.__racket.getDB().classes[0], s = c.sessions.find(x => x.status !== 'closed');
    const ms = window.RacketEngine.groupMatches(s, 0);
    return { all: ms.every(m => m.done), forfeit: !!ms[2].forfeit, n: ms.length };
  });
  check(poolDone.all && poolDone.forfeit && poolDone.n === 6, 'scan du code de poule : les 6 résultats enregistrés d\'un coup');
  await page.fill('#scanCode', poolCode);
  await page.press('#scanCode', 'Enter');
  check(/déjà enregistrée/.test(await page.textContent('.scan-status')), 'second scan de la poule : rien ne change');
  await page.click('[data-action="scan-close"]');
  check(await page.$('.scan-panel') === null, 'mode scan fermé (caméra arrêtée)');
  // Test de l'appareil
  await page.click('[data-tab="settings"]');
  await page.click('#view [data-tab="diagnostic"]');
  await page.waitForFunction(() => /Prête|Copie locale/.test((document.getElementById('dg-offline') || {}).textContent || ''), null, { timeout: 15000 });
  const diag = await page.innerText('#view');
  check(/Enregistrement local opérationnel/.test(diag) && /Lecteur de l'application/.test(diag) && /Protocole d'essai/.test(diag), 'test de l\'appareil : stockage, hors connexion, lecteur QR et protocole d\'essai affichés');
  if (process.env.QR_SHOTS || true) await page.screenshot({ path: path.join(OUT, 'test-appareil.png'), fullPage: true });

  // Export d'une classe puis import par fusion (classe déjà présente → remplacer)
  await page.click('[data-tab="settings"]');
  const [ex] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-class"]')]);
  const exPath = await ex.path();
  const nBefore = await page.evaluate(() => window.__racket.getDB().classes.length);
  await page.setInputFiles('#importFile', exPath);
  await page.waitForFunction(() => /Import/.test(document.getElementById('toast').textContent));
  check(await page.evaluate(() => window.__racket.getDB().classes.length) === nBefore && /remplacée/.test(await page.textContent('#toast')), 'import par fusion : la classe existante est remplacée, aucune autre n\'est touchée');

  // Hors connexion : l'application et la feuille de poule s'ouvrent sans réseau
  const off = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'allow' });
  const op = await off.newPage();
  await op.goto(BASE);
  await op.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await op.reload();
  await op.waitForFunction(() => !!navigator.serviceWorker.controller);
  await off.setOffline(true);
  await op.reload();
  check(/Racket/.test(await op.innerText('body')) && await op.$('#nav .tab-btn') !== null, 'hors connexion : l\'application se rouvre sans réseau');
  await op.goto(poolHref);
  await op.waitForSelector('.pool-match');
  check(await op.$$eval('.pool-match', n => n.length) === 6, 'hors connexion : la feuille de poule s\'ouvre sur la tablette sans réseau');
  await off.close();

  check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await tab.close(); await ctx.close(); srv.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    await scenario(browser, 'ordinateur', { viewport: { width: 1280, height: 900 } });
    await scenario(browser, 'telephone', devices['iPhone 13']);
    await scenario(browser, 'tablette', devices['iPad (gen 7) landscape']);
    await migration(browser);
    await demoClass(browser);
    await qrFlow(browser);
    console.log('\nParcours réussis. Captures : ' + OUT);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
