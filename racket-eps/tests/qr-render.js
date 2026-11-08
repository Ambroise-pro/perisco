'use strict';
/* Rendu d'un QR dans une image simulant une prise de vue (partagé par les tests). */
const Q = require('../qr.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// Homographie qui envoie 4 points src sur 4 points dst (système 8×8).
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return (x, y) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
}

/**
 * Rendu d'un QR dans une image W×H. o : { module, angle (deg), tilt (0..0.4), dark, light, noise, blur, clutter, cx, cy }
 */
function render(text, o) {
  o = Object.assign({ W: 640, H: 480, module: 6, angle: 0, tilt: 0, dark: 30, light: 230, noise: 0, blur: false, clutter: false, seed: 1 }, o);
  const q = Q.encode(text), n = q.size, quiet = 4, N = n + 2 * quiet;
  const r = rng(o.seed);
  const side = N * o.module, cx = o.cx || o.W / 2, cy = o.cy || o.H / 2;
  const a = o.angle * Math.PI / 180;
  const corner = (dx, dy, shrink) => { const x = dx * shrink, y = dy; return [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]; };
  const h = side / 2;
  const quad = [corner(-h, -h, 1 - o.tilt), corner(h, -h, 1 - o.tilt), corner(h, h, 1), corner(-h, h, 1)];
  const toModule = homography(quad, [[0, 0], [N, 0], [N, N], [0, N]]);
  const g = new Uint8ClampedArray(o.W * o.H);
  const rects = o.clutter ? Array.from({ length: 40 }, () => [r() * o.W, r() * o.H, 5 + r() * 40, 5 + r() * 40, r() < 0.5 ? o.dark : 140]) : [];
  for (let y = 0; y < o.H; y++) for (let x = 0; x < o.W; x++) {
    let acc = 0;
    for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const [u, v] = toModule(x + sx, y + sy);
      let val;
      if (u >= 0 && v >= 0 && u < N && v < N) {
        const mr = Math.floor(v) - quiet, mc = Math.floor(u) - quiet;
        val = mr >= 0 && mc >= 0 && mr < n && mc < n && q.modules[mr][mc] ? o.dark : o.light;
      } else {
        val = 170;
        for (const [rx, ry, rw, rh, col] of rects) if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) val = col;
      }
      acc += val;
    }
    g[y * o.W + x] = acc / 4 + (o.noise ? (r() - 0.5) * 2 * o.noise : 0);
  }
  if (o.blur) {
    const b = new Uint8ClampedArray(g.length);
    for (let y = 1; y < o.H - 1; y++) for (let x = 1; x < o.W - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * o.W + x + dx];
      b[y * o.W + x] = s / 9;
    }
    return { data: b, width: o.W, height: o.H };
  }
  return { data: g, width: o.W, height: o.H };
}

module.exports = { render, rng, homography };
