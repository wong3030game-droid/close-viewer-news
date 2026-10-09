'use strict';
// 通告系統：員工通告（內部）及公司公告（對外）。每份通告有編號，以公司信頭發出。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const { can } = require('./org');

async function submit(ctx) {
  const pub = ctx.cid[2] === 'public', f = ctx.fields;
  ctx.need(pub ? can.noticePublic(ctx) : can.noticeStaff(ctx), pub ? '只有總監或以上可以發出公司公告。' : '只有經理或以上可以發出員工通告。');
  const ch = pub ? ctx.needChannel('notice', '公司公告') : ctx.needChannel('staffnotice', '員工通告');
  const year = D.ymd(Date.now()).slice(0, 4), n = await FB.next(`${pub ? 'pa' : 'ic'}-${year}`);
  const no = `${pub ? '公告' : '通告'}第 ${year}/${FB.pad(n, 3)} 號`;
  const e = {
    color: B.COLOR.notice, author: B.head(pub ? '公司公告' : '員工通告'), title: D.trunc(f.title, 250), description: f.body,
    fields: f.effective ? [{ name: '生效日期或適用範圍', value: f.effective }] : [],
    footer: { text: `${no}｜${ctx.name}　${ctx.title}` }, timestamp: new Date().toISOString(),
  };
  const m = await D.api('POST', `/channels/${ch}/messages`, { embeds: [e], allowed_mentions: { parse: [] } });
  if (pub) { try { await D.api('POST', `/channels/${ch}/messages/${m.id}/crosspost`); } catch { /* 非公告頻道時略過 */ } }
  await FB.db().collection('notices').add({ no, scope: pub ? 'public' : 'staff', title: f.title, body: f.body, effective: f.effective || '', by: ctx.name, byTitle: ctx.title, at: Date.now(), channelId: ch, msgId: m.id });
  await ctx.log('hr', pub ? '發出公司公告' : '發出員工通告', no, f.title);
  return ctx.edit(`${ctx.em('notice')}已發出${no}：<#${ch}>`);
}

module.exports = { submit };
