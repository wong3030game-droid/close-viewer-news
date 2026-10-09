'use strict';
// Discord 互動入口：驗證簽名，並在 3 秒內回應。
// 彈出表單及選單即時回應；其餘一律先回「處理中」，再交給背景程式完成。這個檔案不可以讀取資料庫。
const D = require('../lib/discord');
const M = require('../lib/modals');

const json = (o) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
const modal = (data) => json({ type: 9, data });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  const h = event.headers || {};
  const sig = h['x-signature-ed25519'], ts = h['x-signature-timestamp'];
  if (!process.env.DISCORD_PUBLIC_KEY || !sig || !ts || !D.verifySig(process.env.DISCORD_PUBLIC_KEY, sig, ts, raw)) {
    return { statusCode: 401, body: 'invalid request signature' };
  }
  const i = JSON.parse(raw);
  if (i.type === 1) return json({ type: 1 });
  if (!i.guild_id) return json({ type: 4, data: { flags: 64, content: '請在近觀者伺服器內使用。' } });

  // 即時彈出表單的指令
  if (i.type === 2) {
    const d = i.data, sub = (d.options || [])[0] || {};
    const o = (list, n) => ((list || []).find((x) => x.name === n) || {}).value;
    if (d.name === 'story' && sub.name === 'new') return modal(M.newStory(o(sub.options, 'category'), o(sub.options, 'type')));
    if (d.name === 'breaking') return modal(M.breaking(o(d.options, 'category')));
    if (d.name === 'tip') return modal(M.tip(o(d.options, 'anonymous')));
    if (d.name === 'apply') return modal(M.apply(o(d.options, 'dept')));
    if (d.name === 'service') return modal(M.service(o(d.options, 'type')));
    if (d.name === 'request' && sub.name === 'new') return modal(M.request(o(sub.options, 'type')));
    if (d.name === 'notice') return modal(M.notice(o(d.options, 'scope')));
    if (d.name === 'letter' && sub.name === 'new') { const cs = String(o(sub.options, 'case') || '').replace(/\D/g, ''), u = o(sub.options, 'user'); return modal(M.letter(o(sub.options, 'kind'), cs ? 'c' + cs : u ? 'u' + u : '-')); }
    if (d.name === 'suggest') return modal(M.suggest(o(d.options, 'anonymous')));
    if (d.name === 'appeal') return modal(M.appeal());
    if (d.name === 'handover') return modal(M.handover());
    if (d.name === 'resolution') return modal(M.resolution());
    if (d.name === 'meeting' && sub.name === 'new') return modal(M.meeting());
  }
  // 即時彈出表單或選單的按鈕
  if (i.type === 3) {
    const [a, b, c] = String(i.data.custom_id || '').split(':'), v = (i.data.values || [])[0];
    if (a === 'p' && b === 'tip') return modal(M.tip(c === '1'));
    if (a === 'p' && b === 'case') return modal(M.service(c));
    if (a === 'p' && b === 'apply') return json({ type: 4, data: M.applyMenu() });
    if (a === 'p' && b === 'req') return json({ type: 4, data: M.requestMenu() });
    if (a === 'p' && b === 'duty' && c === 'off') return modal(M.dutyOff());
    if (a === 'ps' && b === 'apply') return modal(M.apply(v));
    if (a === 'ps' && b === 'req') return modal(M.request(v));
    if ((a === 'st' || a === 'rv') && b === 'edit') return modal(M.editStory(c, i.message));
    if (a === 'rv' && (b === 'return' || b === 'reject')) return modal(M.reason(b, c));
    if (a === 'hr' && b === 'no') return modal(M.reason('hrno', c));
    if (a === 'rq' && b === 'no') return modal(M.reason('rqno', c));
    if (a === 'cs' && b === 'close') return modal(M.reason('csclose', c));
    if (a === 'ac' && b === 'essay') return modal(M.essay(c));
    if (a === 'es' && b === 'fail') return modal(M.reason('esfail', c));
    if (a === 'es' && (b === 'vpass' || b === 'vdist')) return modal(M.reason('es' + b, c));
    if (a === 'lt' && b === 'no') return modal(M.reason('ltno', c));
    if (a === 'ap' && (b === 'keep' || b === 'change')) return modal(M.reason('ap' + b, c));
    if (a === 'tk' && b === 'done') return modal(M.reason('tkdone', c));
    if (a === 'p' && b === 'handover') return modal(M.handover());
    if (a === 'p' && b === 'suggest') return modal(M.suggest(c === '1'));
  }

  const cid = String((i.data && i.data.custom_id) || '');
  const ok = i.type === 2 || (i.type === 3 && /^(st|rv|tp|hr|ac|rq|cs|es|mt|tk|ap|rs|pl|cl|lt|p):/.test(cid)) || (i.type === 5 && /^mu?:/.test(cid));
  if (!ok) return json({ type: 4, data: { flags: 64, content: '未支援的操作。' } });

  try {
    const url = D.site() + '/.netlify/functions/bot-work-background';
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-sig': D.hmac(raw) }, body: raw });
    if (r.status >= 400) throw new Error('背景程式回應 ' + r.status);
  } catch (e) {
    console.error('dispatch failed', e);
    return json({ type: 4, data: { flags: 64, content: '系統暫時未能處理，請稍後再試。如持續出現，請通知資訊科技部。' } });
  }
  return json(D.isUpdate(i) ? { type: 6 } : { type: 5, data: { flags: 64 } });
};
