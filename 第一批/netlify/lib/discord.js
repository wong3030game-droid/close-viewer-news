'use strict';
const crypto = require('crypto');

const API = 'https://discord.com/api/v10';
/** 權限位元（用於頻道權限設定） */
const P = { VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n, MANAGE_THREADS: 1n << 34n, PUBLIC_THREADS: 1n << 35n, PRIVATE_THREADS: 1n << 36n, SEND_THREADS: 1n << 38n };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Discord REST。提供 files: [{name, data(Buffer), type}] 時改用 multipart 上載。 */
async function api(method, path, body, files, opts = {}) {
  const headers = {};
  if (!opts.noAuth) headers.Authorization = `Bot ${process.env.DISCORD_BOT_TOKEN}`;
  if (opts.reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(opts.reason);
  let payload;
  if (files && files.length) {
    const fd = new FormData();
    fd.append('payload_json', JSON.stringify(body || {}));
    files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.data], { type: f.type || 'application/octet-stream' }), f.name));
    payload = fd;
  } else if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API + path, { method, headers, body: payload });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      await sleep(Math.min((j.retry_after || 1) * 1000 + 100, 8000));
      continue;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 回應 */ }
    if (!res.ok) {
      const e = new Error(`Discord ${method} ${path} 回應 ${res.status}：${json && json.message ? json.message : text.slice(0, 160)}`);
      e.status = res.status;
      e.code = json && json.code;
      throw e;
    }
    return json;
  }
  throw new Error('Discord 請求過於頻繁，請稍後再試');
}

/** 驗證 Discord 互動請求的 Ed25519 簽名（無需額外套件） */
function verifySig(publicKeyHex, signatureHex, timestamp, body) {
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]);
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/** 內部呼叫簽名：互動入口 → 背景程式，以 Bot Token 作金鑰 */
const hmac = (s) => crypto.createHmac('sha256', process.env.DISCORD_BOT_TOKEN || '').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const isAdmin = (member) => { try { return (BigInt((member && member.permissions) || '0') & 8n) === 8n; } catch { return false; } };

/**
 * 這個互動是否屬於「更新原有訊息」類。
 * 是：入口回應 type 6，之後編輯 @original 即修改該則訊息；錯誤提示須用 follow-up，不可覆蓋原訊息。
 * 否：入口回應 type 5（只有本人可見的「處理中」），之後編輯 @original 即為回覆。
 * 規則：面板按鈕（custom_id 以 p: 或 ps: 開頭）及一般表單（m:）屬於「否」；其餘按鈕及 mu: 表單屬於「是」。
 */
const isUpdate = (i) => { const id = String((i.data && i.data.custom_id) || ''); return (i.type === 3 && !/^ps?:/.test(id)) || (i.type === 5 && /^mu:/.test(id)); };

const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const HK = 8 * 3600e3;
const hkText = (ms) => { const d = new Date(ms + HK); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const unix = (ms) => Math.floor(ms / 1000);
const { site } = require('./brand');

/** 私訊成員（可附檔案）。對方關閉私訊時不影響原本操作。 */
async function dm(uid, payload, files) {
  try {
    const ch = await api('POST', '/users/@me/channels', { recipient_id: uid });
    await api('POST', `/channels/${ch.id}/messages`, payload, files);
    return true;
  } catch (e) { console.log('dm failed', uid, e.message); return false; }
}
const row = (...btns) => ({ type: 1, components: btns });
const btn = (custom_id, label, style = 2, extra = {}) => { const b = { type: 2, custom_id, label, style, ...extra }; if (!b.emoji) delete b.emoji; return b; };
/** 下拉選單。o.min／o.max：可選數目（多項選擇題及管理台使用） */
const select = (custom_id, placeholder, options, o = {}) => ({ type: 1, components: [{ type: 3, custom_id, placeholder, ...(o.min ? { min_values: o.min } : {}), ...(o.max ? { max_values: Math.min(25, o.max) } : {}), options: options.map((x0) => { const x = { ...x0 }; if (!x.emoji) delete x.emoji; return x; }) }] });
const ymd = (ms) => hkText(ms).slice(0, 10);
/** 2026-10-09 → 2026 年 10 月 9 日 */
const zhDate = (ms) => { const [y, m, d] = ymd(ms).split('-'); return `${y} 年 ${+m} 月 ${+d} 日`; };
const linkBtn = (url, label) => ({ type: 2, style: 5, url, label });

module.exports = { API, P, api, verifySig, hmac, safeEq, isAdmin, isUpdate, trunc, hkText, ymd, zhDate, unix, sleep, site, dm, row, btn, select, linkBtn };
