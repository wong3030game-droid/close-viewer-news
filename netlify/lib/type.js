'use strict';
// 字形引擎：讀取 public/doc/cv-serif.bin（由 tools/build_font.py 生成），將文字畫到畫布上。
// 不依賴任何原生套件，Netlify 函式可以直接執行。
const zlib = require('zlib');

class Font {
  constructor(packed) {
    const b = zlib.inflateSync(packed);
    if (b.toString('latin1', 0, 4) !== 'CVF1') throw new Error('bad font file');
    this.b = b; this.upm = b.readUInt16LE(4); this.asc = b.readInt16LE(6); this.desc = b.readInt16LE(8); this.n = b.readUInt32LE(10);
    this.tab = 14; this.data = 14 + this.n * 8; this.cache = new Map();
  }
  /** 二分搜尋字碼；找不到回傳 -1 */
  find(cp) {
    let lo = 0, hi = this.n - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1, v = this.b.readUInt32LE(this.tab + mid * 8); if (v === cp) return this.data + this.b.readUInt32LE(this.tab + mid * 8 + 4); if (v < cp) lo = mid + 1; else hi = mid - 1; }
    return -1;
  }
  has(cp) { return this.find(cp) >= 0; }
  /** 字形輪廓 → { adv, segs: [[x0,y0,x1,y1]…]（字體單位，已將二次曲線拆成直線）} */
  outline(cp, scale) {
    let p = this.find(cp);
    if (p < 0) return null;
    const b = this.b, adv = b.readUInt16LE(p), n = b.readUInt16LE(p + 2), segs = [];
    p += 4;
    let x = 0, y = 0, sx = 0, sy = 0, px = 0, py = 0, open = false;
    const line = (x1, y1) => { segs.push([px, py, x1, y1]); px = x1; py = y1; };
    const rd = (wide) => { const v = wide ? b.readInt16LE(p) : b.readInt8(p); p += wide ? 2 : 1; return v; };
    for (let i = 0; i < n; i++) {
      const op = b[p++], wide = op >= 3, k = op % 3;
      if (k === 2) {
        const cx = (x += rd(wide)), cy = (y += rd(wide)), ex = (x += rd(wide)), ey = (y += rd(wide));
        const dx = (px - 2 * cx + ex) * scale, dy = (py - 2 * cy + ey) * scale, dev = dx * dx + dy * dy;
        const steps = dev < 0.333 ? 1 : 1 + Math.floor(Math.sqrt(Math.sqrt(3 * dev)));
        const x0 = px, y0 = py;
        for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; line(u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey); }
      } else {
        x += rd(wide); y += rd(wide);
        if (k === 0) { if (open && (px !== sx || py !== sy)) line(sx, sy); sx = px = x; sy = py = y; open = true; } else line(x, y);
      }
    }
    if (open && (px !== sx || py !== sy)) line(sx, sy);
    return { adv, segs };
  }
  /** 指定字號的灰階遮罩：{ w, h, left, top（相對基線，向下為正）, adv, a: Uint8Array } */
  glyph(cp, size) {
    const key = cp * 4096 + Math.round(size * 4);
    if (this.cache.has(key)) return this.cache.get(key);
    const s = size / this.upm, o = this.outline(cp, s);
    let g = null;
    if (o) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of o.segs) { x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]); }
      if (!o.segs.length) g = { w: 0, h: 0, left: 0, top: 0, adv: o.adv * s, a: null };
      else {
        const left = Math.floor(x0 * s) - 1, top = Math.floor(-y1 * s) - 1, w = Math.ceil(x1 * s) - left + 2, h = Math.ceil(-y0 * s) - top + 2;
        const acc = new Float32Array(w * h + 2);
        for (const q of o.segs) rasterLine(acc, w, h, q[0] * s - left, -q[1] * s - top, q[2] * s - left, -q[3] * s - top);
        const a = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) { let sum = 0; for (let x = 0; x < w; x++) { sum += acc[y * w + x]; const v = Math.abs(sum); a[y * w + x] = v >= 1 ? 255 : Math.round(v * 255); } }
        g = { w, h, left, top, adv: o.adv * s, a };
      }
    }
    if (this.cache.size > 6000) this.cache.clear();
    this.cache.set(key, g);
    return g;
  }
  /** 文字闊度（像素）。字體沒有的字當半個字闊。 */
  measure(text, size, spacing = 0) {
    let w = 0;
    for (const ch of String(text)) { const g = this.glyph(ch.codePointAt(0), size); w += (g ? g.adv : size * 0.5) + spacing; }
    return w - (text ? spacing : 0);
  }
}

/** 有向面積累加法（與 font-rs 相同）：每條線段把覆蓋率的變化寫入累加緩衝，之後逐行累加得出灰階。 */
function rasterLine(acc, w, h, x0, y0, x1, y1) {
  if (y0 === y1) return;
  const dir = y0 < y1 ? 1 : -1;
  if (dir < 0) { let t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  if (y0 < 0) x -= y0 * dxdy;
  for (let y = Math.max(0, Math.floor(y0)), yEnd = Math.min(h, Math.ceil(y1)); y < yEnd; y++) {
    const row = y * w, dy = Math.min(y + 1, y1) - Math.max(y, y0), xn = x + dxdy * dy, d = dy * dir;
    const xa = Math.min(x, xn), xb = Math.max(x, xn), xaF = Math.floor(xa), xaI = xaF, xbC = Math.ceil(xb), xbI = xbC;
    if (xbI <= xaI + 1) {
      const xm = 0.5 * (x + xn) - xaF;
      acc[row + xaI] += d - d * xm; acc[row + xaI + 1] += d * xm;
    } else {
      const s = 1 / (xb - xa), xaf = xa - xaF, a0 = 0.5 * s * (1 - xaf) * (1 - xaf), xbf = xb - xbC + 1, am = 0.5 * s * xbf * xbf;
      acc[row + xaI] += d * a0;
      if (xbI === xaI + 2) acc[row + xaI + 1] += d * (1 - a0 - am);
      else {
        const a1 = s * (1.5 - xaf);
        acc[row + xaI + 1] += d * (a1 - a0);
        for (let xi = xaI + 2; xi < xbI - 1; xi++) acc[row + xi] += d * s;
        acc[row + xbI - 1] += d * (1 - (a1 + (xbI - xaI - 3) * s) - am);
      }
      acc[row + xbI] += d * am;
    }
    x = xn;
  }
}

/** RGB 畫布 */
class Canvas {
  constructor(w, h, rgb) { this.w = w; this.h = h; this.d = rgb || Buffer.alloc(w * h * 3, 255); }
  static fromRGBA(img) { const c = new Canvas(img.w, img.h); for (let i = 0, n = img.w * img.h; i < n; i++) { c.d[i * 3] = img.data[i * 4]; c.d[i * 3 + 1] = img.data[i * 4 + 1]; c.d[i * 3 + 2] = img.data[i * 4 + 2]; } return c; }
  rect(x, y, w, h, c) { for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) { const o = (j * this.w + i) * 3; this.d[o] = c[0]; this.d[o + 1] = c[1]; this.d[o + 2] = c[2]; } }
  mask(g, x, y, c) {
    for (let j = 0; j < g.h; j++) { const py = y + j; if (py < 0 || py >= this.h) continue;
      for (let i = 0; i < g.w; i++) { const a = g.a[j * g.w + i]; if (!a) continue; const px = x + i; if (px < 0 || px >= this.w) continue;
        const o = (py * this.w + px) * 3, k = a / 255; this.d[o] += (c[0] - this.d[o]) * k; this.d[o + 1] += (c[1] - this.d[o + 1]) * k; this.d[o + 2] += (c[2] - this.d[o + 2]) * k; } }
  }
  /** 畫一行字。y 為基線位置；align: left｜center｜right；fit: 超過此闊度就自動縮細字號。回傳實際闊度。 */
  text(font, str, x, y, size, color, o = {}) {
    str = String(str ?? '');
    const sp = o.spacing || 0;
    if (o.fit) { const w0 = font.measure(str, size, sp); if (w0 > o.fit) size *= o.fit / w0; }
    const w = font.measure(str, size, sp);
    let pen = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    for (const ch of str) {
      const g = font.glyph(ch.codePointAt(0), size);
      if (g && g.a) this.mask(g, Math.round(pen) + g.left, Math.round(y) + g.top, color);
      pen += (g ? g.adv : size * 0.5) + sp;
    }
    return w;
  }
  /** 自動換行的段落。中文可在任何字之間斷行，英文按詞斷行，標點不會落在行首。回傳下一行的基線位置。 */
  para(font, str, x, y, size, color, maxW, lineH) {
    for (const line of wrap(font, str, size, maxW)) { this.text(font, line, x, y, size, color); y += lineH; }
    return y;
  }
  /** 貼上 RGBA 圖（雙線性縮放至 dw×dh） */
  image(img, dx, dy, dw, dh) {
    for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) {
      const fx = Math.min(img.w - 1, ((i + 0.5) * img.w) / dw - 0.5), fy = Math.min(img.h - 1, ((j + 0.5) * img.h) / dh - 0.5);
      const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1), tx = Math.max(0, fx - x0), ty = Math.max(0, fy - y0);
      const px = dx + i, py = dy + j; if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
      const o = (py * this.w + px) * 3, s = (xx, yy, k) => img.data[(yy * img.w + xx) * 4 + k];
      const lerp = (k) => (s(x0, y0, k) * (1 - tx) + s(x1, y0, k) * tx) * (1 - ty) + (s(x0, y1, k) * (1 - tx) + s(x1, y1, k) * tx) * ty;
      const a = lerp(3) / 255;
      for (let k = 0; k < 3; k++) this.d[o + k] += (lerp(k) - this.d[o + k]) * a;
    }
  }
}

const NO_START = new Set([...'，。、；：！？）」』》】％,.;:!?)]}']);
function wrap(font, str, size, maxW) {
  const out = [];
  for (const raw of String(str ?? '').split('\n')) {
    const tokens = raw.match(/[A-Za-z0-9@#&'’\-\/.]+|\s+|[\s\S]/gu) || [];
    let line = '', w = 0;
    for (const t of tokens) {
      const tw = font.measure(t, size);
      if (line && w + tw > maxW && !NO_START.has(t) && !/^\s+$/.test(t)) { out.push(line.replace(/\s+$/, '')); line = ''; w = 0; }
      if (!line && /^\s+$/.test(t)) continue;
      line += t; w += tw;
    }
    out.push(line);
  }
  return out;
}

module.exports = { Font, Canvas, wrap };
