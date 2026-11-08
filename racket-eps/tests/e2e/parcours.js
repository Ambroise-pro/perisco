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
    return new Set(pl).size === pl.length && new Set(ct).size === ct.length && ct.every(t => t <= c.courts);
  });
}

async function playAll(page, counter) {
  for (let guard = 0; guard < 400; guard++) {
    if (!(await noConflict(page))) throw new Error('ÉCHEC : conflit de terrain ou d\'élève');
    const row = await page.$('.match.st-playing');
    if (!row) return;
    const inputs = await row.$$('input');
    const i = counter.n++;
    await inputs[0].fill(String(i % 2 ? 11 : i % 9));
    await inputs[1].fill(String(i % 2 ? i % 9 : 11));
    await (await row.$('button[data-action="record"]')).click();
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
  await page.selectOption('#smode', 'pools');
  await page.click('[data-action="create-session"]');
  await page.check('input[data-action="absent"] >> nth=11');
  const present = await page.evaluate(() => window.__racket.getDB().classes[0].sessions[0].positions.length);
  check(present === 11, 'appel : 1 absent, 11 présents');
  const groups = await page.evaluate(() => window.__racket.getDB().classes[0].sessions[0].groups.map(g => g.length));
  check(Math.max(...groups) - Math.min(...groups) <= 1, 'groupes équilibrés proposés : ' + groups.join('+'));
  await page.screenshot({ path: path.join(OUT, label + '-1-appel.png'), fullPage: true });
  await page.click('[data-action="start-session"]');
  const playing = await page.$$eval('.match.st-playing', n => n.length);
  check(playing > 0 && playing <= 4, `${playing} match(s) en cours sur 4 terrains maximum`);
  await page.screenshot({ path: path.join(OUT, label + '-2-seance.png'), fullPage: true });
  check(/Classement des poules/.test(await page.textContent('#view')) && /Départagé par/.test(await page.textContent('#view')), 'classement par poule avec critère de départage affiché');

  // Mode projection : seconde fenêtre en lecture seule, mise à jour en direct, sans Elo
  const proj = await ctx.newPage();
  await proj.goto(FILE + '#projection');
  await proj.waitForSelector('.proj-court');
  check(await proj.$$eval('.proj-court', n => n.length) === 4, 'projection : 4 terrains affichés');
  check(!/Elo/i.test(await proj.innerText('body')), 'projection : aucune donnée Elo affichée');
  const projBefore = await proj.textContent('.proj-prog');
  const firstRow = await page.$('.match.st-playing');
  const ins = await firstRow.$$('input');
  await ins[0].fill('11'); await ins[1].fill('4');
  await (await firstRow.$('button[data-action="record"]')).click();
  await proj.waitForFunction(b => document.querySelector('.proj-prog').textContent !== b, projBefore, { timeout: 5000 });
  check(true, 'projection mise à jour automatiquement après une saisie (' + (await proj.textContent('.proj-prog')) + ')');
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

  // Séance 2 : ronde suisse, proposition selon l'Elo
  await page.click('[data-tab="session"]');
  await page.selectOption('#smode', 'swiss');
  await page.fill('#rounds', '2');
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
  check(/Évolution par séance/.test(await page.textContent('#view')), 'fiche élève avec évolution par séance');
  check(await page.$$eval('#eloChart circle', n => n.length) === 2 && await page.$$eval('#rankChart circle', n => n.length) === 2, 'graphiques Elo et rang : un point par séance clôturée');
  await page.hover('#eloChart svg', { position: { x: 30, y: 60 } });
  await page.waitForSelector('#eloChart .tip:not([hidden])');
  check(/Séance 1/.test(await page.textContent('#eloChart .tip')), 'survol du graphique : info-bulle de la séance la plus proche');
  await page.focus('#rankChart');
  await page.keyboard.press('ArrowLeft');
  check(/Séance 1/.test(await page.textContent('#rankChart .tip')), 'graphique utilisable au clavier (flèches)');
  await page.screenshot({ path: path.join(OUT, label + '-5-graphiques.png'), fullPage: true });

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
  check(await page.$$eval('#eloChart circle', n => n.length) === 4, 'graphiques alimentés par les séances simulées');
  await page.screenshot({ path: path.join(OUT, 'exemple-classement.png'), fullPage: true });
  await page.click('[data-tab="session"]');
  await page.click('[data-action="create-session"]');
  await page.click('[data-action="start-session"]');
  check(await page.$$eval('.match.st-playing', n => n.length) === 6, 'nouvelle séance possible sur la classe exemple (6 terrains occupés)');
  check(errors.length === 0, 'aucune erreur JavaScript');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await scenario(browser, 'ordinateur', { viewport: { width: 1280, height: 900 } });
    await scenario(browser, 'telephone', devices['iPhone 13']);
    await migration(browser);
    await demoClass(browser);
    console.log('\nParcours réussis. Captures : ' + OUT);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
