/*
 * Génère tournoi-eps.html : une version autonome (un seul fichier) de l'application,
 * avec CSS et JavaScript intégrés. Aucune dépendance : node tools/build-standalone.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let html = read('index.html');
const css = read('style.css').replace(/<\/style/gi, '<\\/style');
const js = f => read(f).replace(/<\/script/gi, '<\\/script');

const replaceOnce = (needle, value) => {
  if (!html.includes(needle)) throw new Error('Balise introuvable : ' + needle);
  html = html.replace(needle, () => value);
};
replaceOnce('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>');
replaceOnce('<script src="engine.js"></script>', '<script>\n' + js('engine.js') + '\n</script>');
replaceOnce('<script src="app.js"></script>', '<script>\n' + js('app.js') + '\n</script>');
html = html.replace('<head>', '<head>\n<!-- Version autonome générée par tools/build-standalone.js — ne pas modifier à la main. -->');

fs.writeFileSync(path.join(root, 'tournoi-eps.html'), html);
console.log('tournoi-eps.html généré (' + Math.round(html.length / 1024) + ' Ko)');
