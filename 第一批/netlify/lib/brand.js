'use strict';
// 品牌設定：公司名稱、口號、顏色、標記。想改名、改口號或換顏色，只需改這個檔案。
const BRAND = {
  zh: '近觀者',
  zhFull: '近觀者新聞有限公司',
  en: 'Close Viewer News',
  enFull: 'Close Viewer News Corporation',
  slogan: '看得近，報得真。',
  sloganEn: 'Look Closer. Report True.',
  creed: '接近事實的觀點',
  creedEn: 'Views that stay close to the facts',
};

/** 訊息側欄顏色。每個系統一種顏色，一眼分辨訊息來自哪個系統。 */
const COLOR = {
  brand: 0xcebd8a, ink: 0x13233f,
  news: 0xcebd8a, flash: 0x9e3b2c, opinion: 0x5a4a7a, feature: 0x2f6f73,
  pending: 0xb08a2e, ok: 0x3f6b4f, alert: 0x9e3b2c, muted: 0x5a6577,
  hr: 0x2f4a73, request: 0xb08a2e, client: 0x2f6f73, academy: 0x8a6a2f, duty: 0x4a5d7a, notice: 0x13233f, log: 0x5a6577, tip: 0x4b5a8a,
};

/**
 * 自家標記：伺服器內所有頻道及身份組名稱只使用這四個標記，不使用表情符號。
 * 標記本身有意思：看標記就知道頻道的用途。
 */
const SIGN = {
  official: '◈', // 正式發佈：只有系統或管理層發言
  desk: '◆',     // 工作台：有按鈕或待辦事項的頻道
  talk: '◇',     // 討論：同事或公眾交流
  record: '▤',   // 紀錄：系統自動記錄，不可發言
  dept: '▣',     // 部門及全體員工身份組
};

const site = () => (process.env.SITE_URL || '').replace(/\/$/, '');
const asset = (p) => `${site()}/${p}`;
/** 所有系統訊息的信頭：公司標誌＋發出部門 */
const head = (unit) => ({ name: `${BRAND.zh} ${BRAND.en}${unit ? '｜' + unit : ''}`, icon_url: site() ? asset('brand/icon.png') : undefined });

/** 自家圖示名稱（對應 public/icons/<名稱>.png），以 cv_<名稱> 上載為應用程式表情符號 */
const ICONS = ['mark', 'ok', 'no', 'warn', 'info', 'news', 'flash', 'edit', 'review', 'publish', 'correct', 'tip', 'hr', 'team', 'academy', 'cert', 'request', 'leave', 'client', 'case', 'duty', 'notice', 'log', 'lock', 'web', 'up', 'doc', 'id', 'camera', 'it', 'shield', 'money', 'key', 'next', 'tier3', 'tier2', 'tier1'];

/** 文字內使用的圖示：已上載就顯示自家圖示，未上載就甚麼都不顯示（絕不使用預設表情符號）。 */
const em = (settings, k) => { const id = settings && settings.emoji && settings.emoji[k]; return id ? `<:cv_${k}:${id}> ` : ''; };
/** 按鈕及選單使用的圖示 */
const emo = (settings, k) => { const id = settings && settings.emoji && settings.emoji[k]; return id ? { id, name: 'cv_' + k } : undefined; };

module.exports = { BRAND, COLOR, SIGN, ICONS, site, asset, head, em, emo };
