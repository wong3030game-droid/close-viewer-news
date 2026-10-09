'use strict';
// PNG 編碼及解碼（只用 Node 內置 zlib，無需額外套件）。文件引擎用它讀取範本、輸出證書及員工證。
const zlib = require('zlib');

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** RGB（每像素 3 位元組）→ PNG。每行自動選用 None／Sub／Up 濾波，檔案較細。 */
function encode(w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h), sub = Buffer.alloc(stride), up = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride), prev = y ? rgb.subarray((y - 1) * stride, y * stride) : null;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < stride; i++) {
      const a = row[i], b = (a - (i >= 3 ? row[i - 3] : 0)) & 255, c = (a - (prev ? prev[i] : 0)) & 255;
      sub[i] = b; up[i] = c;
      s0 += a < 128 ? a : 256 - a; s1 += b < 128 ? b : 256 - b; s2 += c < 128 ? c : 256 - c;
    }
    const o = y * (stride + 1), f = s1 <= s0 && s1 <= s2 ? 1 : s2 < s0 ? 2 : 0;
    raw[o] = f; (f === 1 ? sub : f === 2 ? up : row).copy(raw, o + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** PNG → { w, h, data（RGBA，每像素 4 位元組）}。支援 8 位元、非交錯的灰階／RGB／色板／帶透明度格式；其他格式會拋出錯誤。 */
function decode(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, ct = 0, lace = 0, plte = null, trns = null; const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; lace = d[12]; }
    else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (depth !== 8 || lace || !ch || !w || !h || w * h > 4096 * 4096) throw new Error('unsupported PNG format');
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, cur = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[o + i - ch] : 0, b = y ? cur[o - stride + i] : 0, c = y && i >= ch ? cur[o - stride + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[o + i] = v & 255;
    }
  }
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch, t = i * 4;
    if (ct === 2 || ct === 6) { data[t] = cur[s]; data[t + 1] = cur[s + 1]; data[t + 2] = cur[s + 2]; data[t + 3] = ct === 6 ? cur[s + 3] : 255; }
    else if (ct === 0 || ct === 4) { data[t] = data[t + 1] = data[t + 2] = cur[s]; data[t + 3] = ct === 4 ? cur[s + 1] : 255; }
    else { const k = cur[s] * 3; data[t] = plte[k]; data[t + 1] = plte[k + 1]; data[t + 2] = plte[k + 2]; data[t + 3] = trns && cur[s] < trns.length ? trns[cur[s]] : 255; }
  }
  return { w, h, data };
}

/** 將一張 RGB 圖包成單頁 PDF（圖像鋪滿整頁），方便列印或存檔。 */
function pdf(w, h, rgb, title) {
  const img = zlib.deflateSync(rgb, { level: 6 }), pw = 842, ph = Math.round((842 * h) / w * 100) / 100;
  const page = w >= h ? [pw, ph] : [595, Math.round((595 * h) / w * 100) / 100];
  const content = Buffer.from(`q ${page[0]} 0 0 ${page[1]} 0 0 cm /Im0 Do Q`);
  const hex = (s) => 'FEFF' + [...String(s)].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page[0]} ${page[1]}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`, img, '\nendstream'],
    [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream'],
    `<< /Title <${hex(title || 'Document')}> /Producer (Close Viewer News) >>`,
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offs = []; let pos = parts[0].length;
  const push = (b) => { b = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(b); pos += b.length; };
  objs.forEach((o, n) => { offs.push(pos); push(`${n + 1} 0 obj\n`); for (const x of Array.isArray(o) ? o : [o]) push(x); push('\nendobj\n'); });
  const xref = pos;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

module.exports = { encode, decode, pdf, crc32 };
