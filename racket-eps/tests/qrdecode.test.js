'use strict';
/*
 * Tests du lecteur de QR (qrdecode.js) sur des images simulant une prise de vue :
 * rotation, perspective, flou, bruit, faible contraste, petits modules, fond encombré.
 * Le rendu est fait ici, indépendamment du lecteur (homographie résolue par Gauss).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../qrdecode.js');

const Q = require('../qr.js');
const { render, rng } = require('./qr-render.js');

const RESULT = 'RE1.0RZ57D.1EA82Y.11.4.3FH68F4';
const POOL = 'RP1.3ATA1R.0.11:1,2:11,FB,4:11,11:5,6:11.04F8SC0';
const SHEET = 'https://perisco.vercel.app/index.html#p=' + 'eyJ2IjoxLCJraW5kIjoicG9vbCIsInMiOiIzQVRBMVIiLCJnIjowLCJrIjoiQUJDREVGIiwibiI6MSwidCI6MTEsInAiOlsiQWxiYXRyb3MiLCJCaXNvbiIsIkNhc3RvciIsIkRhdXBoaW4iLCJFY3VyZXVpbCIsIkZhdWNvbiJdLCJtIjoiMDEyMzQ1MDIxMzQ1MDMxNDI1MDQxNTIzMDUxNDIzIn0';

const CASES = [
  ['droit, modules de 6 px', RESULT, {}],
  ['petits modules (3 px)', RESULT, { module: 3 }],
  ['rotation 30°', RESULT, { angle: 30 }],
  ['rotation 90°', POOL, { angle: 90 }],
  ['rotation 180°', POOL, { angle: 180, module: 5 }],
  ['perspective (inclinaison 25 %)', POOL, { tilt: 0.25, module: 5 }],
  ['perspective + rotation 15°', RESULT, { tilt: 0.2, angle: 15 }],
  ['bruit fort', RESULT, { noise: 45 }],
  ['faible contraste', POOL, { dark: 95, light: 175, module: 5 }],
  ['flou', POOL, { blur: true, module: 5 }],
  ['fond encombré, décentré', RESULT, { clutter: true, cx: 230, cy: 200, module: 5 }],
  ['grand QR (version 14) incliné', SHEET, { W: 900, H: 700, module: 7, angle: 12, tilt: 0.12 }],
  ['grand QR (version 14), bruit et flou', SHEET, { W: 900, H: 700, module: 7, noise: 30, blur: true }]
];

for (const [name, text, opts] of CASES) {
  test('Lecture caméra simulée : ' + name, () => {
    const img = render(text, opts);
    assert.equal(D.decode(img), text);
  });
}

test('Image RGBA (format de la caméra) acceptée', () => {
  const g = render(RESULT, {});
  const rgba = new Uint8ClampedArray(g.width * g.height * 4);
  for (let i = 0; i < g.data.length; i++) { rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = g.data[i]; rgba[4 * i + 3] = 255; }
  assert.equal(D.decode({ data: rgba, width: g.width, height: g.height }), RESULT);
});

test('Pas de faux positif sur une image sans QR', () => {
  const r = rng(3), W = 320, H = 240, data = new Uint8ClampedArray(W * H);
  for (let i = 0; i < data.length; i++) data[i] = r() * 255;
  assert.equal(D.decode({ data, width: W, height: H }), null);
  assert.equal(D.decode({ data: new Uint8ClampedArray(W * H).fill(200), width: W, height: H }), null);
});

test('Correction d\'erreurs : un QR dont des modules sont abîmés reste lisible', () => {
  const q = Q.encode(POOL);
  const m = q.modules.map(r => r.slice());
  const r = rng(9);
  // Une rayure (bloc de 4×4 modules inversés) et 1 % de modules isolés inversés (reflets)
  for (let y = 12; y < 16; y++) for (let x = 14; x < 18; x++) m[y][x] = !m[y][x];
  for (let k = 0; k < Math.floor(m.length * m.length * 0.01); k++) {
    const y = 9 + Math.floor(r() * (m.length - 18)), x = 9 + Math.floor(r() * (m.length - 18));
    m[y][x] = !m[y][x];
  }
  assert.equal(D._decodeMatrix(m), POOL);
});

test('Rapidité : une image 640×480 est analysée en moins de 250 ms', () => {
  const img = render(RESULT, { angle: 20 });
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) D.decode(img);
  assert.ok((Date.now() - t0) / 5 < 250);
});
