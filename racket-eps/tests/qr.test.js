'use strict';
/*
 * Tests du générateur de QR codes (qr.js).
 * La conformité a été vérifiée avec un décodeur indépendant (OpenCV QRCodeDetector) :
 * 27 textes couvrant les versions 1 à 20 et 40 QR avec chacun des 8 masques forcés, tous décodés
 * à l'identique. Les empreintes ci-dessous figent ces sorties validées (non-régression).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Q = require('../qr.js');

const fingerprint = t => {
  const q = Q.encode(t);
  return q.version + ':' + q.mask + ':' + crypto.createHash('sha256').update(q.modules.map(r => r.map(x => (x ? 1 : 0)).join('')).join('\n')).digest('hex').slice(0, 16);
};

test('Reed-Solomon : vecteur de référence « HELLO WORLD » version 1-M', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(Q._rsRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('Non-régression : QR validés par un décodeur indépendant', () => {
  assert.equal(fingerprint('RE1.1JH9V4.0G0HS1.11.4.2KRXHJC'), '3:2:900bcc1d4ae4fb75');
  assert.equal(fingerprint('Élève à l\'école — çà et là ✓ 🏸'), '4:2:1236c4bf78bd3ca6');
  assert.equal(fingerprint('https://perisco.vercel.app/index.html#f=eyJ2IjoxLCJzIjoiMUpIOVY0IiwibSI6IjBHMEhTMSIsImEiOiJBbGJhdHJvcyIsImIiOiJEYXVwaGluIiwidCI6MSwiZyI6MTEsImsiOiJBQkNERUYiLCJuIjoxfQ'), '9:2:01b67cb4f2029815');
});

test('Structure : taille, motifs de repérage, synchronisation, module sombre', () => {
  for (const len of [1, 30, 120, 300, 600]) {
    const q = Q.encode('a'.repeat(len));
    assert.equal(q.size, 17 + 4 * q.version);
    const m = q.modules, n = q.size;
    // motif de repérage haut-gauche : coin sombre, anneau clair, centre sombre
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      assert.ok(m[r0][c0] && m[r0 + 6][c0 + 6] && !m[r0 + 1][c0 + 1] && m[r0 + 3][c0 + 3]);
    }
    for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
    assert.ok(m[n - 8][8], 'module sombre');
  }
});

test('Capacité : versions croissantes, erreur explicite au-delà de la version 20', () => {
  let prev = 0;
  for (const len of [10, 50, 100, 200, 400, 666]) {
    const v = Q.encode('b'.repeat(len)).version;
    assert.ok(v >= prev && v <= Q.MAX_VERSION);
    prev = v;
  }
  assert.throws(() => Q.encode('c'.repeat(700)), /trop long/);
});

test('SVG : zone de silence, modules regroupés, taille demandée', () => {
  const svg = Q.toSVG('RE1.TEST', 200);
  assert.match(svg, /^<svg[^>]+width="200"[^>]+height="200"/);
  const q = Q.encode('RE1.TEST');
  assert.match(svg, new RegExp('viewBox="0 0 ' + (q.size + 8) + ' ' + (q.size + 8) + '"'));
  assert.ok(svg.includes('fill="#fff"') && svg.includes('fill="#000"'));
});
