'use strict';
// 紀錄查詢：管理層及合規人員可按類別、同事或編號翻查操作紀錄。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const { can } = require('./org');
const { LOGS } = require('./work');

async function command(ctx) {
  ctx.need(can.audit(ctx), '只有總監或以上，以及合規部、資訊科技部的助理經理或以上可以查閱紀錄。');
  const cat = ctx.opt('category'), uid = ctx.opt('user'), ref = String(ctx.opt('ref') || '').trim().toUpperCase();
  let q = FB.db().collection('audit');
  if (cat && LOGS[cat]) q = q.where('cat', '==', cat);
  if (uid) q = q.where('uid', '==', uid);
  let list = (await q.get()).docs.map((d) => d.data());
  if (ref) list = list.filter((x) => String(x.ref || '').toUpperCase().includes(ref));
  list = list.sort((a, b) => b.at - a.at).slice(0, 15);
  const filt = [cat && LOGS[cat], uid && `<@${uid}>`, ref].filter(Boolean).join('｜') || '全部';
  await FB.audit(ctx.who, 'system', '查閱紀錄', '', filt);
  return ctx.edit({ embeds: [{ color: B.COLOR.log, author: B.head('紀錄查詢'), title: `最近 ${list.length} 項紀錄`, description: D.trunc(list.map((x) => `\`${D.hkText(x.at).slice(5)}\` **${x.action}**${x.ref ? '｜' + x.ref : ''}｜${x.name}${x.detail ? '\n　' + D.trunc(x.detail, 90) : ''}`).join('\n') || '沒有符合條件的紀錄。', 4000), footer: { text: `篩選：${filt.replace(/<@(\d+)>/, '指定同事')}｜查閱紀錄本身亦會被記錄` } }], allowed_mentions: { parse: [] } });
}

module.exports = { command };
