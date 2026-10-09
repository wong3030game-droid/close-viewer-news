'use strict';
// 背景程式（檔名以 -background 結尾，Netlify 會即時回應 202，最長可執行 15 分鐘）。
const D = require('../lib/discord');
const { work, UserError, hook } = require('../lib/work');

exports.handler = async (event) => {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  const sig = (event.headers || {})['x-bot-sig'] || '';
  if (!process.env.DISCORD_BOT_TOKEN || !D.safeEq(sig, D.hmac(raw))) return { statusCode: 401, body: 'forbidden' };
  const i = JSON.parse(raw);
  await D.sleep(process.env.NODE_ENV === 'test' ? 0 : 1200); // 等待 Discord 收妥「處理中」回應後才編輯
  try {
    await work(i);
  } catch (e) {
    if (e instanceof UserError) console.log('user error:', e.message); else console.error('work failed', e);
    const msg = e instanceof UserError ? e.message : '處理時出現錯誤，請稍後再試。如持續出現，請通知資訊科技部。';
    // 更新訊息類的操作：以另一則訊息提示，不覆蓋原本的訊息
    try { if (D.isUpdate(i)) await hook(i).follow({ content: msg }); else await hook(i).edit({ content: msg, embeds: [], components: [] }); } catch (e2) { console.error('reply failed', e2); }
  }
  return { statusCode: 202 };
};
