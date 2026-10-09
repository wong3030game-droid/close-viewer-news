'use strict';
// 文件引擎：在範本底圖上畫上文字，輸出 PNG（Discord 內直接顯示）及 PDF（列印或存檔）。
// 用於證書、員工證及公司函件。範本及字形檔放在 public/doc/，座標須與 tools/build_templates.py 一致。
const fs = require('fs');
const path = require('path');
const PNG = require('./png');
const { Font, Canvas } = require('./type');
const { site, BRAND } = require('./brand');

const NAVY = [19, 35, 63], GOLD = [206, 189, 138], GOLD_DEEP = [138, 114, 48], GREY = [90, 101, 119], CREAM = [241, 234, 214], MIST = [185, 192, 204];
const cache = new Map();

/** 讀取 public/ 內的檔案（例如 doc/cert.png、handouts/F101.pdf）：本機有就直接讀，否則經網站下載（Netlify 函式內）。結果會留在記憶體。 */
async function pub(rel) {
  if (cache.has(rel)) return cache.get(rel);
  let buf = null;
  for (const dir of [path.join(__dirname, '..', '..', 'public'), path.join(process.cwd(), 'public')]) {
    try { buf = fs.readFileSync(path.join(dir, rel)); break; } catch { /* 試下一個位置 */ }
  }
  if (!buf) {
    if (!site()) throw new Error('未設定 SITE_URL，無法讀取檔案');
    const r = await fetch(`${site()}/${rel}`);
    if (!r.ok) throw new Error(`讀取 ${rel} 失敗（HTTP ${r.status}）`);
    buf = Buffer.from(await r.arrayBuffer());
  }
  if (cache.size > 40) cache.clear();
  cache.set(rel, buf);
  return buf;
}
const asset = (name) => pub('doc/' + name);
let fontP = null;
const font = () => (fontP = fontP || asset('cv-serif.bin').then((b) => new Font(b)).catch((e) => { fontP = null; throw e; }));
const tplCache = new Map();
async function template(name) {
  if (!tplCache.has(name)) tplCache.set(name, PNG.decode(await asset(name)));
  return Canvas.fromRGBA(tplCache.get(name));
}
const out = (c, title, withPdf) => ({ png: PNG.encode(c.w, c.h, c.d), pdf: withPdf ? PNG.pdf(c.w, c.h, c.d, title) : null });

/**
 * 證書。c: { name, zh, en, serial, date, courses: ['F101　公司入職須知　Company Induction'…], signer }
 */
async function certificate(c) {
  const [f, cv] = await Promise.all([font(), template('cert.png')]);
  cv.text(f, c.zh, 150, 344, 64, NAVY, { fit: 1150, spacing: 4 });
  cv.text(f, c.en, 153, 392, 26, GOLD_DEEP, { spacing: 1.5, fit: 1150 });
  cv.text(f, c.name, 150, 602, 92, NAVY, { fit: 1300 });
  let y = 744;
  for (const line of (c.courses || []).slice(0, 4)) { cv.text(f, line, 150, y, 25, NAVY, { fit: 1200 }); y += 40; }
  cv.text(f, c.serial, 150, 960, 30, NAVY, { spacing: 1 });
  cv.text(f, c.date, 510, 960, 30, NAVY);
  if (c.signer) cv.text(f, c.signer, 1060, 926, 30, NAVY, { align: 'center', fit: 280 });
  cv.text(f, '系統核發', 1355, 926, 26, GOLD_DEEP, { align: 'center', spacing: 4 });
  return out(cv, `${c.zh} ${c.serial}`, true);
}

/**
 * 員工證。s: { name, titleZh, titleEn, dept, staffNo, joined, avatar?: Buffer(PNG) }
 */
async function staffCard(s) {
  const [f, cv] = await Promise.all([font(), template('card.png')]);
  if (s.avatar) { try { cv.image(PNG.decode(s.avatar), 58, 198, 233, 233); } catch { /* 頭像格式不支援時保留預設標記 */ } }
  cv.text(f, s.name, 340, 262, 56, CREAM, { fit: 620 });
  cv.text(f, s.titleZh, 340, 322, 32, GOLD, { fit: 620, spacing: 2 });
  cv.text(f, s.titleEn, 341, 362, 22, MIST, { fit: 620, spacing: 1 });
  cv.text(f, s.dept || '', 340, 412, 21, [154, 166, 184], { fit: 620 });
  cv.text(f, s.staffNo, 340, 514, 34, CREAM, { spacing: 2 });
  cv.text(f, s.joined, 620, 514, 34, CREAM);
  return out(cv, `員工證 ${s.staffNo}`, false);
}

/**
 * 公司函件。l: { ref, date, to, toLine?, subject, paras: [..], signName, signTitle, unit }
 */
async function letter(l) {
  const [f, cv] = await Promise.all([font(), template('letter.png')]);
  cv.text(f, `檔號：${l.ref}`, 96, 330, 23, GREY, { spacing: 1 });
  cv.text(f, l.date, 1144, 330, 23, GREY, { align: 'right' });
  cv.text(f, `致：${l.to}`, 96, 434, 32, NAVY, { fit: 1048 });
  if (l.toLine) cv.text(f, l.toLine, 96, 478, 23, GREY, { fit: 1048 });
  cv.text(f, l.subject, 96, 584, 38, NAVY, { fit: 1048, spacing: 2 });
  cv.rect(96, 606, 90, 3, GOLD);
  let y = 690;
  for (const p of l.paras || []) { y = cv.para(f, p, 96, y, 27, [36, 44, 60], 1048, 50) + 22; if (y > 1420) break; }
  y = Math.min(y + 50, 1500);
  cv.text(f, l.signName || '', 96, y, 30, NAVY);
  cv.text(f, l.signTitle || '', 96, y + 40, 23, GREY);
  cv.text(f, `${BRAND.zhFull}${l.unit ? '　' + l.unit : ''}`, 96, y + 76, 23, GREY);
  return out(cv, `${l.subject} ${l.ref}`, true);
}

module.exports = { certificate, staffCard, letter, asset, pub };
