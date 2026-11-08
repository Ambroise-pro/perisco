/*
 * Racket EPS — générateur de QR codes (écrit pour l'application, sans dépendance).
 * Navigateur : window.RacketQR ; Node : require('./qr.js').
 *
 * Norme ISO/IEC 18004 : mode « octets » (texte UTF-8), niveau de correction d'erreur M
 * (~15 % de modules récupérables), versions 1 à 20 (jusqu'à 666 octets), codes de
 * Reed-Solomon sur GF(256) (polynôme 0x11D), choix du masque par les 4 règles de pénalité.
 *   RacketQR.encode(texte) → { version, size, modules: booléens[ligne][colonne] }
 *   RacketQR.toSVG(texte, taillePx) → chaîne SVG (zone de silence de 4 modules incluse)
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RacketQR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Niveau M : [codes de correction par bloc, blocs groupe 1, octets de données par bloc g1, blocs groupe 2, octets g2]
  const EC_M = [null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42]];
  // Centres des motifs d'alignement
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
    [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
  const MAX_VERSION = 20;

  /* ---------- Corps de Galois GF(256) et Reed-Solomon ---------- */
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  // Polynôme générateur ∏ (x − αⁱ), coefficients du degré le plus haut au plus bas.
  function generator(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }

  function rsRemainder(data, deg) {
    const gen = generator(deg), rem = new Array(deg).fill(0);
    data.forEach(d => {
      const f = d ^ rem[0];
      rem.shift(); rem.push(0);
      if (f) for (let j = 0; j < deg; j++) rem[j] ^= gmul(gen[j + 1], f);
    });
    return rem;
  }

  function utf8(text) {
    const s = unescape(encodeURIComponent(String(text)));
    const out = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  const dataCodewords = v => EC_M[v][1] * EC_M[v][2] + EC_M[v][3] * EC_M[v][4];

  /* ---------- Codage des données ---------- */
  function encodeData(bytes) {
    let version = 0;
    for (let v = 1; v <= MAX_VERSION; v++) {
      const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCodewords(v) * 8) { version = v; break; }
    }
    if (!version) throw new Error('Texte trop long pour un QR code (' + bytes.length + ' octets).');
    const cap = dataCodewords(version) * 8, bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);                                   // mode octets
    push(bytes.length, version < 10 ? 8 : 16);         // nombre de caractères
    bytes.forEach(b => push(b, 8));
    push(0, Math.min(4, cap - bits.length));           // terminateur
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }

    // Découpage en blocs, correction d'erreur, entrelacement
    const [ec, b1, n1, b2, n2] = EC_M[version];
    const blocks = [];
    let k = 0;
    for (let i = 0; i < b1; i++) { blocks.push(cw.slice(k, k + n1)); k += n1; }
    for (let i = 0; i < b2; i++) { blocks.push(cw.slice(k, k + n2)); k += n2; }
    const ecBlocks = blocks.map(b => rsRemainder(b, ec));
    const out = [];
    const maxLen = Math.max(n1, n2);
    for (let i = 0; i < maxLen; i++) blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < ec; i++) ecBlocks.forEach(b => out.push(b[i]));
    const finalBits = [];
    out.forEach(b => { for (let i = 7; i >= 0; i--) finalBits.push((b >>> i) & 1); });
    return { version, bits: finalBits };
  }

  /* ---------- Matrice ---------- */
  function buildMatrix(version) {
    const size = 17 + 4 * version;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => { mod[r][c] = dark; fn[r][c] = true; };

    // Motifs de repérage (+ séparateurs)
    [[0, 0], [0, size - 7], [size - 7, 0]].forEach(([r0, c0]) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r, c, ring !== 2 && ring !== 4);
      }
    });
    // Lignes de synchronisation
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // Motifs d'alignement
    const pos = ALIGN[version], last = pos.length - 1;
    pos.forEach((r, i) => pos.forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));
    // Zones réservées au format (remplies plus tard) et module sombre
    for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
    for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
    set(size - 8, 8, true);
    // Informations de version (v ≥ 7)
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const vb = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((vb >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(b, a, dark); set(a, b, dark);
      }
    }
    return { size, mod, fn };
  }

  function placeData(m, bits) {
    const { size, mod, fn } = m;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          const upward = ((right + 1) & 2) === 0;
          const r = upward ? size - 1 - vert : vert;
          if (!fn[r][c]) { mod[r][c] = i < bits.length ? bits[i] === 1 : false; i++; }
        }
      }
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  function applyMask(m, k) {
    const f = MASKS[k];
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (!m.fn[r][c] && f(r, c)) m.mod[r][c] = !m.mod[r][c];
  }

  // Informations de format : niveau M (bits 00) + masque, BCH(15,5), masque 0x5412.
  function drawFormat(m, mask) {
    const data = (0 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = i => ((bits >>> i) & 1) === 1;
    const { size, mod } = m;
    for (let i = 0; i <= 5; i++) mod[i][8] = bit(i);
    mod[7][8] = bit(6); mod[8][8] = bit(7); mod[8][7] = bit(8);
    for (let i = 9; i < 15; i++) mod[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) mod[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) mod[size - 15 + i][8] = bit(i);
    mod[size - 8][8] = true;
  }

  function penalty(mod) {
    const n = mod.length;
    let score = 0, dark = 0;
    const line = get => {
      let s = 0, run = 1;
      for (let i = 1; i < n; i++) {
        if (get(i) === get(i - 1)) run++;
        else { if (run >= 5) s += 3 + run - 5; run = 1; }
      }
      if (run >= 5) s += 3 + run - 5;
      // motif 1:1:3:1:1 bordé de 4 modules clairs
      for (let i = 0; i + 10 < n; i++) {
        const p = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], q = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
        let a = true, b = true;
        for (let k = 0; k < 11; k++) { const v = get(i + k) ? 1 : 0; if (v !== p[k]) a = false; if (v !== q[k]) b = false; }
        if (a) s += 40; if (b) s += 40;
      }
      return s;
    };
    for (let r = 0; r < n; r++) { score += line(i => mod[r][i]); score += line(i => mod[i][r]); }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const v = mod[r][c];
      if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) score += 3;
    }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mod[r][c]) dark++;
    score += 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
    return score;
  }

  function encode(text, opts) {
    const { version, bits } = encodeData(utf8(text));
    const forced = opts && Number.isInteger(opts.mask) ? opts.mask : null; // pour les tests
    let best = null;
    for (let k = 0; k < 8; k++) {
      if (forced !== null && k !== forced) continue;
      const m = buildMatrix(version);
      placeData(m, bits);
      applyMask(m, k);
      drawFormat(m, k);
      const p = penalty(m.mod);
      if (!best || p < best.p) best = { p, m, k };
    }
    return { version, size: best.m.size, mask: best.k, modules: best.m.mod };
  }

  function toSVG(text, px) {
    const q = encode(text), quiet = 4, tot = q.size + 2 * quiet;
    let d = '';
    for (let r = 0; r < q.size; r++) {
      for (let c = 0; c < q.size; c++) {
        if (!q.modules[r][c]) continue;
        let w = 1;
        while (c + w < q.size && q.modules[r][c + w]) w++;  // regroupe les modules sombres d'une ligne
        d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h' + w + 'v1h-' + w + 'z';
        c += w - 1;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + tot + ' ' + tot + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  // Tables partagées avec le lecteur (qrdecode.js), qui lit les QR produits par ce générateur.
  const internals = { EC_M, ALIGN, EXP, LOG, gmul, MASKS, buildMatrix, dataCodewords };
  return { encode, toSVG, MAX_VERSION, _rsRemainder: rsRemainder, _internals: internals };
});
