/*
 * Racket EPS — lecteur de QR codes (écrit pour l'application, sans dépendance).
 * Sert quand le navigateur n'a pas de lecteur intégré (BarcodeDetector), par exemple sur iPad
 * ou sous Windows. Navigateur : window.RacketQRDecode (charger qr.js avant) ; Node : require.
 *
 * Il lit les QR produits par qr.js (niveau de correction M, versions 1 à 20, mode octets),
 * c'est-à-dire les feuilles de match, de poule et les codes de résultat de l'application.
 *   decode({ data, width, height }) → texte ou null      (data : RGBA ou niveaux de gris)
 *
 * Étapes : niveaux de gris → seuillage local (image intégrale) → recherche des 3 motifs de
 * repérage (rapport 1:1:3:1:1, vérifié en croix) → taille et orientation → transformation
 * perspective (4ᵉ point affiné sur le motif d'alignement) → échantillonnage des modules →
 * format (BCH, ≤ 3 erreurs) → démasquage → désentrelacement → correction Reed-Solomon
 * (Berlekamp-Massey, Chien, Forney) → lecture des segments → UTF-8.
 */
(function (root, factory) {
  'use strict';
  const Q = (typeof module === 'object' && module.exports) ? require('./qr.js') : root.RacketQR;
  const api = factory(Q && Q._internals);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RacketQRDecode = api;
})(typeof self !== 'undefined' ? self : this, function (I) {
  'use strict';
  if (!I) throw new Error('qr.js doit être chargé avant qrdecode.js');
  const { EC_M, EXP, LOG, gmul, MASKS, buildMatrix } = I;

  /* ---------------- Reed-Solomon (décodage) ---------------- */
  const gdiv = (a, b) => (a === 0 ? 0 : EXP[(LOG[a] - LOG[b] + 255) % 255]);
  const polyEval = (p, x) => { let v = 0; for (let i = p.length - 1; i >= 0; i--) v = gmul(v, x) ^ p[i]; return v; }; // p : degré croissant

  /** Corrige un bloc (données + codes) en place ; renvoie false si irréparable. */
  function rsCorrect(block, nec) {
    const n = block.length;
    const S = [];
    let any = false;
    for (let j = 0; j < nec; j++) {
      let v = 0;
      for (let k = 0; k < n; k++) v = gmul(v, EXP[j]) ^ block[k];
      S.push(v);
      if (v) any = true;
    }
    if (!any) return true;
    // Berlekamp-Massey : polynôme localisateur C (degré croissant)
    let C = [1], B = [1], L = 0, m = 1, b = 1;
    for (let k = 0; k < nec; k++) {
      let d = S[k];
      for (let i = 1; i <= L; i++) d ^= gmul(C[i] || 0, S[k - i]);
      if (d === 0) { m++; continue; }
      const coef = gdiv(d, b);
      const T = C.slice();
      const len = Math.max(C.length, B.length + m);
      const nc = new Array(len).fill(0);
      for (let i = 0; i < C.length; i++) nc[i] = C[i];
      for (let i = 0; i < B.length; i++) nc[i + m] ^= gmul(coef, B[i]);
      C = nc;
      if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else m++;
    }
    if (2 * L > nec) return false;
    // Chien : positions d'erreur
    const pos = [];
    for (let i = 0; i < n; i++) if (polyEval(C, EXP[(255 - i) % 255]) === 0) pos.push(i);
    if (pos.length !== L) return false;
    // Forney
    const omega = new Array(nec).fill(0);
    for (let i = 0; i < nec; i++) for (let j = 0; j <= i && j < C.length; j++) omega[i] ^= gmul(S[i - j], C[j]);
    const deriv = [];
    for (let i = 1; i < C.length; i++) deriv.push(i % 2 ? C[i] : 0);
    for (const i of pos) {
      const X = EXP[i % 255], Xinv = EXP[(255 - i) % 255];
      const den = polyEval(deriv, Xinv);
      if (!den) return false;
      const e = gdiv(gmul(X, polyEval(omega, Xinv)), den);
      block[n - 1 - i] ^= e;
    }
    for (let j = 0; j < nec; j++) {
      let v = 0;
      for (let k = 0; k < n; k++) v = gmul(v, EXP[j]) ^ block[k];
      if (v) return false;
    }
    return true;
  }

  /* ---------------- Image → binaire ---------------- */
  function toGray(img) {
    const { data, width: w, height: h } = img, n = w * h;
    if (data.length === n) return data;
    const g = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    return g;
  }

  // Seuillage local : pixel sombre s'il est nettement sous la moyenne de son voisinage.
  function binarize(gray, w, h) {
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(7, Math.floor(Math.min(w, h) / 16));
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        out[y * w + x] = gray[y * w + x] < mean * 0.9 - 2 ? 1 : 0;
      }
    }
    return out;
  }

  /* ---------------- Motifs de repérage ---------------- */
  function ratioOK(c) {
    const total = c[0] + c[1] + c[2] + c[3] + c[4];
    if (total < 7) return false;
    const m = total / 7, v = m * 0.6;
    return Math.abs(c[0] - m) < v && Math.abs(c[1] - m) < v && Math.abs(c[2] - 3 * m) < 3 * v && Math.abs(c[3] - m) < v && Math.abs(c[4] - m) < v;
  }

  // Vérification le long d'une direction (dx, dy) depuis un centre supposé ; renvoie { offset, total } ou null.
  function crossCheck(bin, w, h, cx, cy, dx, dy, maxCount) {
    const at = (k) => { const x = Math.round(cx + dx * k), y = Math.round(cy + dy * k); return x < 0 || y < 0 || x >= w || y >= h ? -1 : bin[y * w + x]; };
    const c = [0, 0, 0, 0, 0];
    let k = 0;
    while (at(k) === 1) { c[2]++; k--; }
    if (at(k) === -1) return null;
    while (at(k) === 0 && c[1] <= maxCount) { c[1]++; k--; }
    if (at(k) === -1 || c[1] > maxCount) return null;
    while (at(k) === 1 && c[0] <= maxCount) { c[0]++; k--; }
    if (c[0] > maxCount) return null;
    k = 1;
    while (at(k) === 1) { c[2]++; k++; }
    if (at(k) === -1) return null;
    while (at(k) === 0 && c[3] <= maxCount) { c[3]++; k++; }
    if (at(k) === -1 || c[3] > maxCount) return null;
    while (at(k) === 1 && c[4] <= maxCount) { c[4]++; k++; }
    if (c[4] > maxCount) return null;
    if (!ratioOK(c)) return null;
    const end = k - c[4] - c[3];
    return { offset: end - c[2] / 2, total: c[0] + c[1] + c[2] + c[3] + c[4] };
  }

  function findFinders(bin, w, h) {
    const cands = [];
    const add = (x, y, size) => {
      for (const c of cands) {
        if (Math.hypot(c.x - x, c.y - y) < size * 2.5 && Math.abs(c.size - size) < size * 0.6) {
          c.x = (c.x * c.n + x) / (c.n + 1); c.y = (c.y * c.n + y) / (c.n + 1); c.size = (c.size * c.n + size) / (c.n + 1); c.n++;
          return;
        }
      }
      cands.push({ x, y, size, n: 1 });
    };
    const step = h > 300 ? 2 : 1;
    for (let y = 0; y < h; y += step) {
      const c = [0, 0, 0, 0, 0];
      let st = 0;
      for (let x = 0; x <= w; x++) {
        const dark = x < w && bin[y * w + x] === 1;
        if (dark) {
          if (st % 2 === 1) st++;
          c[st]++;
        } else if (st % 2 === 0) {
          if (st === 4) {
            if (ratioOK(c)) {
              const total = c[0] + c[1] + c[2] + c[3] + c[4];
              const cx0 = x - c[4] - c[3] - c[2] / 2;
              const v = crossCheck(bin, w, h, cx0, y, 0, 1, total);
              if (v) {
                const cy = y + v.offset;
                const hz = crossCheck(bin, w, h, cx0, cy, 1, 0, total);
                if (hz) {
                  const cx = cx0 + hz.offset;
                  const d1 = crossCheck(bin, w, h, cx, cy, 0.7071, 0.7071, total * 1.6);
                  if (d1) add(cx, cy, (total + v.total + hz.total) / 21);
                }
              }
              c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0; st = 3;
            } else {
              c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0; st = 3;
            }
          } else { st++; c[st]++; }
        } else c[st]++;
      }
    }
    // Élimination des doublons : un candidat proche d'un autre vu plus souvent est un écho du même motif.
    cands.sort((a, b) => b.n - a.n);
    const kept = [];
    for (const c of cands) {
      if (kept.some(k => Math.hypot(k.x - c.x, k.y - c.y) < Math.max(k.size, c.size) * 7)) continue;
      kept.push(c);
    }
    return kept.slice(0, 12);
  }

  // Choix de trois motifs formant un triangle rectangle isocèle ; renvoie [hautGauche, hautDroit, basGauche].
  function pickTriple(c) {
    let best = null;
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
      const p = [c[i], c[j], c[k]];
      const sizes = p.map(q => q.size), ms = (sizes[0] + sizes[1] + sizes[2]) / 3;
      if (Math.max(...sizes) / Math.min(...sizes) > 1.6) continue;
      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const sides = [[d(p[1], p[2]), 0], [d(p[0], p[2]), 1], [d(p[0], p[1]), 2]].sort((a, b) => b[0] - a[0]);
      const tl = p[sides[0][1]], others = p.filter((_, idx) => idx !== sides[0][1]);
      const a = d(tl, others[0]), b = d(tl, others[1]), hyp = sides[0][0];
      if (a < ms * 7 || b < ms * 7) continue;
      const iso = Math.abs(a - b) / Math.max(a, b);
      const right = Math.abs(hyp * hyp - a * a - b * b) / (hyp * hyp);
      if (iso > 0.25 || right > 0.25) continue;
      const score = iso + right + (Math.max(...sizes) / Math.min(...sizes) - 1) - Math.min(p[0].n, p[1].n, p[2].n) * 0.01;
      if (!best || score < best.score) {
        let [tr, bl] = others;
        const cross = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x);
        if (cross < 0) [tr, bl] = [bl, tr];
        best = { score, tl, tr, bl, module: ms };
      }
    }
    return best;
  }

  /* ---------------- Transformation perspective ---------------- */
  function squareToQuad(p) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
    const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      return [x1 - x0, y1 - y0, 0, x2 - x1, y2 - y1, 0, x0, y0, 1];
    }
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [x1 - x0 + a13 * x1, y1 - y0 + a13 * y1, a13, x3 - x0 + a23 * x3, y3 - y0 + a23 * y3, a23, x0, y0, 1];
  }
  // Matrices 3×3 en ligne (vecteur ligne [u v 1] × M).
  function adjugate(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  }
  function mul(m, n) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = m[i * 3] * n[j] + m[i * 3 + 1] * n[3 + j] + m[i * 3 + 2] * n[6 + j];
    return r;
  }
  function quadToQuad(src, dst) { return mul(adjugate(squareToQuad(src)), squareToQuad(dst)); }
  function apply(m, u, v) {
    const den = m[2] * u + m[5] * v + m[8];
    return [(m[0] * u + m[3] * v + m[6]) / den, (m[1] * u + m[4] * v + m[7]) / den];
  }

  function sampleGrid(bin, w, h, T, dim) {
    const g = [];
    for (let r = 0; r < dim; r++) {
      const row = [];
      for (let c = 0; c < dim; c++) {
        const [x, y] = apply(T, c + 0.5, r + 0.5);
        const xi = Math.round(x), yi = Math.round(y);
        row.push(xi >= 0 && yi >= 0 && xi < w && yi < h ? bin[yi * w + xi] === 1 : false);
      }
      g.push(row);
    }
    return g;
  }

  function buildTransform(f, dim, br, brModule) {
    const src = [3.5, 3.5, dim - 3.5, 3.5, brModule, brModule, 3.5, dim - 3.5];
    const dst = [f.tl.x, f.tl.y, f.tr.x, f.tr.y, br[0], br[1], f.bl.x, f.bl.y];
    return quadToQuad(src, dst);
  }

  // Affine le 4ᵉ coin : on cherche la position qui fait le mieux apparaître le motif d'alignement.
  function refineBR(bin, w, h, f, dim) {
    const brModule = dim - 6.5;
    const t = (brModule - 3.5) / (dim - 7);
    const est = [f.tl.x + (f.tr.x - f.tl.x) * t + (f.bl.x - f.tl.x) * t, f.tl.y + (f.tr.y - f.tl.y) * t + (f.bl.y - f.tl.y) * t];
    if (dim < 25) return { br: [f.tr.x + f.bl.x - f.tl.x, f.tr.y + f.bl.y - f.tl.y], brModule: dim - 3.5, est: null };
    // Recherche en deux passes (grossière puis fine) ; le rayon croît avec la taille du code,
    // car l'écart dû à la perspective augmente avec le nombre de modules.
    const m = f.module;
    const scoreAt = br => {
      const T = buildTransform(f, dim, br, brModule);
      let score = 0;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        const expected = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        const [x, y] = apply(T, brModule + c, brModule + r);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi >= 0 && yi >= 0 && xi < w && yi < h && (bin[yi * w + xi] === 1) === expected) score++;
      }
      return score;
    };
    let best = { score: -1, br: est };
    const R1 = Math.max(5, dim * 0.2) * m, s1 = Math.max(1, m);
    for (let dy = -R1; dy <= R1; dy += s1) for (let dx = -R1; dx <= R1; dx += s1) {
      const br = [est[0] + dx, est[1] + dy], sc = scoreAt(br);
      if (sc > best.score) best = { score: sc, br };
    }
    const c0 = best.br, s2 = Math.max(1, m / 3);
    for (let dy = -m; dy <= m; dy += s2) for (let dx = -m; dx <= m; dx += s2) {
      const br = [c0[0] + dx, c0[1] + dy], sc = scoreAt(br);
      if (sc > best.score) best = { score: sc, br };
    }
    return { br: best.br, brModule, est };
  }

  /* ---------------- Lecture de la matrice ---------------- */
  const FORMATS = (() => {
    const out = [];
    for (let ecl = 0; ecl < 4; ecl++) for (let mask = 0; mask < 8; mask++) {
      const data = (ecl << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      out.push({ bits: ((data << 10) | rem) ^ 0x5412, ecl, mask });
    }
    return out;
  })();
  const popcount = x => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };

  function readFormat(g) {
    const n = g.length;
    const bitsAt = list => list.reduce((acc, [r, c], i) => acc | ((g[r][c] ? 1 : 0) << i), 0);
    const a = [], b = [];
    for (let i = 0; i <= 5; i++) a.push([i, 8]);
    a.push([7, 8], [8, 8], [8, 7]);
    for (let i = 9; i < 15; i++) a.push([8, 14 - i]);
    for (let i = 0; i < 8; i++) b.push([8, n - 1 - i]);
    for (let i = 8; i < 15; i++) b.push([n - 15 + i, 8]);
    let best = null;
    for (const bits of [bitsAt(a), bitsAt(b)]) {
      for (const f of FORMATS) {
        const d = popcount(f.bits ^ bits);
        if (!best || d < best.d) best = { d, f };
      }
    }
    return best && best.d <= 3 ? best.f : null;
  }

  function decodeMatrix(g) {
    const dim = g.length, version = (dim - 17) / 4;
    if (!Number.isInteger(version) || version < 1 || version >= EC_M.length) return null;
    const fmt = readFormat(g);
    if (!fmt || fmt.ecl !== 0) return null; // niveau M uniquement (celui de qr.js)
    const { fn } = buildMatrix(version);
    const maskFn = MASKS[fmt.mask];
    const bits = [];
    for (let right = dim - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < dim; vert++) {
        for (let j = 0; j < 2; j++) {
          const c = right - j, upward = ((right + 1) & 2) === 0, r = upward ? dim - 1 - vert : vert;
          if (!fn[r][c]) bits.push((g[r][c] !== maskFn(r, c)) ? 1 : 0);
        }
      }
    }
    const [ec, b1, n1, b2, n2] = EC_M[version];
    const total = b1 * (n1 + ec) + b2 * (n2 + ec);
    const cw = [];
    for (let i = 0; i < total; i++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | (bits[i * 8 + k] || 0); cw.push(v); }
    const sizes = [];
    for (let i = 0; i < b1; i++) sizes.push(n1);
    for (let i = 0; i < b2; i++) sizes.push(n2);
    const blocks = sizes.map(n => ({ data: [], ec: [], n }));
    let k = 0;
    const maxN = Math.max(n1, n2);
    for (let i = 0; i < maxN; i++) blocks.forEach(bl => { if (i < bl.n) bl.data.push(cw[k++]); });
    for (let i = 0; i < ec; i++) blocks.forEach(bl => bl.ec.push(cw[k++]));
    const data = [];
    for (const bl of blocks) {
      const full = bl.data.concat(bl.ec);
      if (!rsCorrect(full, ec)) return null;
      data.push(...full.slice(0, bl.n));
    }
    return parseSegments(data, version);
  }

  function parseSegments(bytes, version) {
    let pos = 0;
    const read = n => { let v = 0; for (let i = 0; i < n; i++) { const byte = bytes[pos >> 3]; v = (v << 1) | (byte === undefined ? 0 : (byte >> (7 - (pos & 7))) & 1); pos++; } return v; };
    const left = () => bytes.length * 8 - pos;
    const out = [];
    const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    while (left() >= 4) {
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 4) {
        const n = read(version < 10 ? 8 : 16);
        for (let i = 0; i < n; i++) out.push(read(8));
      } else if (mode === 2) {
        let n = read(version < 10 ? 9 : 11);
        let s = '';
        while (n >= 2) { const v = read(11); s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
        if (n === 1) s += ALNUM[read(6)];
        for (const ch of s) out.push(ch.charCodeAt(0));
      } else if (mode === 1) {
        let n = read(version < 10 ? 10 : 12);
        let s = '';
        while (n >= 3) { s += String(read(10)).padStart(3, '0'); n -= 3; }
        if (n === 2) s += String(read(7)).padStart(2, '0'); else if (n === 1) s += String(read(4));
        for (const ch of s) out.push(ch.charCodeAt(0));
      } else if (mode === 7) {
        read(8);
      } else return null;
    }
    try { return decodeURIComponent(escape(String.fromCharCode.apply(null, out))); }
    catch (e) { return String.fromCharCode.apply(null, out); }
  }

  /* ---------------- Point d'entrée ---------------- */
  function decode(img) {
    const w = img.width, h = img.height;
    if (!w || !h) return null;
    const bin = binarize(toGray(img), w, h);
    const finders = findFinders(bin, w, h);
    if (finders.length < 3) return null;
    const f = pickTriple(finders);
    if (!f) return null;
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let dim = Math.round(((d(f.tl, f.tr) + d(f.tl, f.bl)) / 2) / f.module) + 7;
    switch (dim & 3) { case 0: dim++; break; case 2: dim--; break; case 3: dim -= 2; break; default: break; }
    for (const delta of [0, 4, -4]) {
      const dd = dim + delta;
      if (dd < 21 || dd > 97) continue;
      const ref = refineBR(bin, w, h, f, dd);
      const tries = [ref.br];
      if (ref.est) tries.push(ref.est);
      for (const br of tries) {
        const T = buildTransform(f, dd, br, ref.brModule);
        const text = decodeMatrix(sampleGrid(bin, w, h, T, dd));
        if (text != null) return text;
      }
    }
    return null;
  }

  // Étapes intermédiaires (diagnostic et tests).
  function analyze(img) {
    const w = img.width, h = img.height, bin = binarize(toGray(img), w, h);
    const finders = findFinders(bin, w, h), f = finders.length >= 3 ? pickTriple(finders) : null;
    return { finders, triple: f };
  }

  return { decode, _rsCorrect: rsCorrect, _decodeMatrix: decodeMatrix, _analyze: analyze };
});
