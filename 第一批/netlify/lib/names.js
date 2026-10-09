'use strict';
// 文件上的姓名：Discord 名稱經常使用花式字體（例如 𝓜𝓪𝓿𝓮𝓻𝓲𝓬𝓴、ᴍᴀᴠᴇʀɪᴄᴋ）、表情符號或裝飾符號。
// 這些字元不在文件字形檔內，畫出來會變成空白，證書上的姓名因而消失。
// 這裡把名稱還原為普通字元、刪去畫不到的字元；如果仍然畫不到，就改用下一個候選名稱（伺服器暱稱 → Discord 顯示名稱 → 用戶名稱）。
// 最可靠的做法仍然是同事以 /cert name 設定「證書姓名」，系統會優先使用。

/** 常見的「小型大寫」及倒轉字母（NFKC 不會轉換的部分）。希臘及西里爾字母是真正的文字，不作轉換。 */
const LOOK = {
  'ᴀ': 'A', 'ʙ': 'B', 'ᴄ': 'C', 'ᴅ': 'D', 'ᴇ': 'E', 'ꜰ': 'F', 'ɢ': 'G', 'ʜ': 'H', 'ɪ': 'I', 'ᴊ': 'J', 'ᴋ': 'K', 'ʟ': 'L', 'ᴍ': 'M', 'ɴ': 'N', 'ᴏ': 'O', 'ᴘ': 'P', 'ǫ': 'Q', 'ʀ': 'R', 'ꜱ': 'S', 'ᴛ': 'T', 'ᴜ': 'U', 'ᴠ': 'V', 'ᴡ': 'W', 'ʏ': 'Y', 'ᴢ': 'Z',
  'ɐ': 'a', 'ɔ': 'c', 'ǝ': 'e', 'ɟ': 'f', 'ƃ': 'g', 'ɥ': 'h', 'ᴉ': 'i', 'ɾ': 'j', 'ʞ': 'k', 'ɯ': 'm', 'ɹ': 'r', 'ʇ': 't', 'ʌ': 'v', 'ʍ': 'w', 'ʎ': 'y',
};
/** 括號字母 ⒜、圈字母 ⓐ 等由 NFKC 處理；這些是 NFKC 處理後仍然需要移除的：表情符號、變體選擇符、零寬字元、組合符號、私用區 */
const STRIP = /[\p{Extended_Pictographic}\u{FE00}-\u{FE0F}\u{E0000}-\u{E007F}\u200B-\u200F\u2060-\u2064\u{1F3FB}-\u{1F3FF}\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}]/gu;
/** 名稱前後常見的裝飾符號 */
const EDGE_SET = new Set([...'|｜_~-—・·•★☆♪♡\u{2665}✦✧❀✿⋆｡ﾟ゜°*+=<>《》〈〉【】「」『』()（）[]{}.,，。!！?？:：;；\'"`^彡ミ〆ღ꧁꧂༺༻〖〗卍']);
const trimEdge = (s) => { const a = [...s]; while (a.length && (EDGE_SET.has(a[0]) || /\s/.test(a[0]))) a.shift(); while (a.length && (EDGE_SET.has(a[a.length - 1]) || /\s/.test(a[a.length - 1]))) a.pop(); return a.join(''); };
const WORDY = /[\p{L}\p{N}]/u;

/** 把一個名稱還原為普通字元。font 有提供時，刪去字形檔沒有的字元。回傳 { text, kept, total }：kept／total 為保留了的文字字元比例。 */
function clean(raw, font) {
  let s = String(raw || '').normalize('NFKC').replace(STRIP, '');
  s = [...s].map((ch) => LOOK[ch] || ch).join('').replace(/\p{M}/gu, (m) => (font && font.has(m.codePointAt(0)) ? m : ''));
  const before = [...s].filter((ch) => WORDY.test(ch)).length;
  if (font) s = [...s].filter((ch) => /\s/.test(ch) || font.has(ch.codePointAt(0))).join('');
  s = trimEdge(s).replace(/\s+/g, ' ').trim();
  const kept = [...s].filter((ch) => WORDY.test(ch)).length;
  return { text: s, kept, total: before };
}

/**
 * 由多個候選名稱中選出最適合畫在文件上的一個。
 * 優先選完整保留（≥ 80% 文字字元）的第一個候選；否則選保留比例最高的；全部都畫不到時回傳 fallback。
 */
function pick(cands, font, fallback = '') {
  const seen = new Set(), list = [];
  for (const c of cands) { const k = String(c || '').trim(); if (k && !seen.has(k)) { seen.add(k); list.push(clean(k, font)); } }
  const good = list.find((x) => x.kept >= 1 && x.kept >= 0.8 * x.total);
  if (good) return good.text;
  const best = list.filter((x) => x.kept >= 1).sort((a, b) => b.kept / Math.max(1, b.total) - a.kept / Math.max(1, a.total))[0];
  return best ? best.text : fallback;
}

/** 證書姓名的檢查：2 至 40 字，最少一個文字，不可含表情符號；font 有提供時，每一個字都必須畫得到。回傳錯誤訊息或空字串。 */
function validate(name, font) {
  const s = String(name || '').trim();
  if ([...s].length < 2 || [...s].length > 40) return '證書姓名須為 2 至 40 個字。';
  if (!WORDY.test(s)) return '證書姓名最少要有一個中文字、英文字母或數字。';
  if (/\p{Extended_Pictographic}/u.test(s)) return '證書姓名不可以包含表情符號。';
  if (font) { const bad = [...new Set([...s].filter((ch) => !/\s/.test(ch) && !font.has(ch.codePointAt(0))))]; if (bad.length) return `以下字元無法印在證書上：${bad.slice(0, 8).join(' ')}。請改用普通中文字或英文字母。`; }
  return '';
}

module.exports = { clean, pick, validate };
