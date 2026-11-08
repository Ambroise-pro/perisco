/*
 * Test de parcours utilisateur (navigateur réel, ouverture en file://).
 * Nécessite Playwright (non inclus dans l'application) :
 *   node tests/e2e/parcours.js [dossier-captures]
 * Scénario du cahier des charges : 24 joueurs, 6 terrains, 3 rondes, 3 divisions de 8,
 * saisie de tous les scores, rechargement, exports — sur ordinateur puis sur téléphone.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');

const FILE = 'file://' + path.resolve(__dirname, '../../', process.env.PAGE || 'index.html');
const OUT = process.argv[2] || path.resolve(__dirname, 'captures');
fs.mkdirSync(OUT, { recursive: true });

function check(cond, msg) {
  if (!cond) throw new Error('ÉCHEC : ' + msg);
  console.log('  ✓ ' + msg);
}

async function scoreOpenDialog(page, i) {
  await page.fill('#scoreA', String(21));
  await page.fill('#scoreB', String(i % 19));
  if (i % 2) { await page.fill('#scoreA', String(i % 19)); await page.fill('#scoreB', '21'); }
  await page.click('#matchForm button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('#matchDialog').open);
}

async function playCourts(page, counter) {
  await page.click('[data-tab="courts"]');
  for (;;) {
    const btn = await page.$('.court-card button[data-action="open-match"]');
    if (!btn) break;
    await btn.click();
    await scoreOpenDialog(page, counter.n++);
  }
}

async function scenario(browser, label, contextOpts) {
  console.log('\n— Parcours ' + label);
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(d.defaultValue() || '') : d.accept());
  await page.goto(FILE);
  await page.waitForSelector('#playersText');

  const names = Array.from({ length: 24 }, (_, i) => 'Élève ' + String.fromCharCode(65 + (i % 26)) + (i + 1));
  await page.fill('#playersText', names.join('\n'));
  await page.click('[data-action="save-players"]');
  await page.fill('#courtsInput', '6');
  await page.dispatchEvent('#courtsInput', 'change');
  await page.waitForFunction(() => window.__tournoi.getState().tournament.settings.courts === 6);
  check(await page.evaluate(() => window.__tournoi.getState().players.length) === 24, '24 joueurs enregistrés');
  await page.screenshot({ path: path.join(OUT, label + '-1-configuration.png'), fullPage: true });
  await page.click('[data-action="start"]');

  const counter = { n: 0 };
  for (let r = 1; r <= 3; r++) {
    const st = await page.evaluate(() => window.__tournoi.getState());
    const active = st.matches.filter(m => m.courtId && !m.result);
    check(active.length === 6 && new Set(active.map(m => m.courtId)).size === 6, `ronde ${r} : 6 matchs sur 6 terrains distincts`);
    if (r === 1) await page.screenshot({ path: path.join(OUT, label + '-2-terrains.png'), fullPage: true });
    await playCourts(page, counter);
    if (r < 3) await page.click('[data-action="next-round"]');
  }
  await page.click('[data-tab="swiss"]');
  await page.screenshot({ path: path.join(OUT, label + '-3-brassage.png'), fullPage: true });
  const pairs = await page.evaluate(() => window.__tournoi.getState().matches.map(m => [m.playerAId, m.playerBId].sort().join()));
  check(new Set(pairs).size === 36, '36 matchs de brassage sans rencontre répétée');

  await page.click('[data-tab="brackets"]');
  check(await page.isChecked('input[name="partition"][value="8+8+8"]'), 'partition 8+8+8 proposée par défaut');
  await page.screenshot({ path: path.join(OUT, label + '-4-divisions.png'), fullPage: true });
  await page.click('[data-action="freeze"]');
  await page.waitForSelector('#bracketScroll svg');
  check(await page.$$eval('#bracketScroll g.node', n => n.length) === 12, 'arbre de la division A : 12 nœuds');
  check(await page.$$eval('#bracketScroll path', n => n.length) === 16, 'arbre : 16 arêtes (2 par match après le premier tour)');
  check(await page.evaluate(() => window.__tournoi.getState().matches.filter(m => m.phase === 'final').length) === 36, '36 matchs de classement');

  // Saisie d'un quart en touchant le nœud de l'arbre
  const node = await page.$('#bracketScroll g.node[aria-label*="Match 1,"]');
  await node.click();
  await page.waitForSelector('#matchDialog[open]');
  await scoreOpenDialog(page, 0);
  const semi = await page.evaluate(() => {
    const s = window.__tournoi.getState();
    const q1 = s.matches.find(m => m.phase === 'final' && m.number === 1 && m.divisionId === 'DA');
    const w = s.matches.find(m => m.sourceA && m.sourceA.matchId === q1.id && m.sourceA.take === 'winner');
    const l = s.matches.find(m => m.sourceA && m.sourceA.matchId === q1.id && m.sourceA.take === 'loser');
    return { ok: w.playerAId === q1.result.winnerId && l.playerAId === q1.result.loserId };
  });
  check(semi.ok, 'score du Q1 saisi via l\'arbre : vainqueur et perdant propagés dans les bonnes branches');
  check(/vainqueur|perdant/i.test(await page.textContent('#bracketScroll')) , 'les adversaires inconnus sont affichés « En attente du vainqueur/perdant »');

  // Zoom
  const w0 = await page.$eval('#bracketScroll svg', s => s.getBoundingClientRect().width);
  await page.click('[data-action="zoom"][data-delta="0.15"]');
  const w1 = await page.$eval('#bracketScroll svg', s => s.getBoundingClientRect().width);
  check(w1 > w0, 'zoom + agrandit l\'arbre');
  await page.click('[data-action="zoom-fit"]');
  await page.screenshot({ path: path.join(OUT, label + '-5-arbre-debut.png'), fullPage: true });

  await playCourts(page, counter);
  for (let guard = 0; guard < 10; guard++) {
    const left = await page.evaluate(() => window.__tournoi.getState().matches.filter(m => !m.result).length);
    if (!left) break;
    await playCourts(page, counter);
  }
  const done = await page.evaluate(() => window.__tournoi.getState().tournament.phase);
  check(done === 'done', 'tous les matchs joués via la vue Terrains');

  await page.click('[data-tab="brackets"]');
  await page.click('[data-action="division"][data-id="DC"]');
  await page.screenshot({ path: path.join(OUT, label + '-6-arbre-C.png'), fullPage: true });

  await page.click('[data-tab="standings"]');
  check(/Classement complet : places 1 à 24/.test(await page.textContent('#view')), 'classement final complet 1 à 24');
  const ranks = await page.$$eval('#view tbody tr td:first-child', tds => tds.map(t => Number(t.textContent)));
  check(ranks.length === 24 && ranks.every((r, i) => r === i + 1), 'rangs affichés continus de 1 à 24');
  await page.screenshot({ path: path.join(OUT, label + '-7-classement.png'), fullPage: true });

  // Rechargement
  const before = await page.evaluate(() => JSON.stringify(window.__tournoi.getState()));
  await page.reload();
  await page.waitForSelector('#view');
  const after = await page.evaluate(() => JSON.stringify(window.__tournoi.getState()));
  check(before === after, 'état identique après rechargement de la page');

  // Correction d'un score amont après rechargement
  await page.click('[data-tab="brackets"]');
  await page.click('[data-action="division"][data-id="DA"]');
  await page.click('#bracketScroll g.node[aria-label*="Match 1,"]');
  await page.waitForSelector('#matchDialog[open]');
  const cur = await page.evaluate(() => { const r = window.__tournoi.getState().matches.find(m => m.divisionId === 'DA' && m.number === 1).result; return [r.scoreA, r.scoreB]; });
  await page.fill('#scoreA', String(cur[1])); await page.fill('#scoreB', String(cur[0]));
  await page.click('#matchForm button[type="submit"]'); // confirmation acceptée automatiquement
  await page.waitForFunction(() => !document.querySelector('#matchDialog').open);
  const inv = await page.evaluate(() => window.__tournoi.getState().matches.filter(m => m.invalidated && !m.result).length);
  check(inv >= 2, 'correction amont : ' + inv + ' résultats aval invalidés explicitement');
  await page.screenshot({ path: path.join(OUT, label + '-8-invalidation.png'), fullPage: true });

  // Exports
  await page.click('[data-tab="standings"]');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-csv"]')]);
  const [json] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-json"]')]);
  check(/\.csv$/.test(csv.suggestedFilename()) && /\.json$/.test(json.suggestedFilename()), 'exports CSV et JSON téléchargés');
  const jsonText = fs.readFileSync(await json.path(), 'utf8');
  check(JSON.parse(jsonText).matches.length === 36 + 36, 'sauvegarde JSON complète (72 matchs)');

  // Mise en page : pas de défilement horizontal de la page
  for (const tab of ['config', 'swiss', 'brackets', 'courts', 'standings']) {
    await page.click(`[data-tab="${tab}"]`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `onglet ${tab} : aucun débordement horizontal de la page`);
  }
  check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await scenario(browser, 'ordinateur', { viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    await scenario(browser, 'telephone', Object.assign({}, devices['iPhone 13'], { acceptDownloads: true }));
    console.log('\nParcours réussis. Captures : ' + OUT);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
