'use strict';
// 值勤系統：開始及結束值勤、工作摘要、時數統計。紀錄寫入「值勤紀錄」頻道及員工檔案。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { UserError } = require('./work');
const MAX = 12 * 3600e3; // 一節值勤最長 12 小時；超過視為忘記結束，不計時數
const fmt = (mins) => `${Math.floor(mins / 60)} 小時 ${Math.round(mins % 60)} 分`;

/** 結束一節值勤並寫入紀錄。逾時的不計時數。 */
async function close(ctx, cur, summary) {
  const now = Date.now(), over = now - cur.since > MAX, mins = over ? 0 : Math.max(1, Math.round((now - cur.since) / 60e3));
  await FB.db().collection('dutylog').add({ uid: ctx.uid, name: ctx.name, dept: ctx.dept, start: cur.since, end: now, mins, over, summary: summary || '' });
  await FB.db().doc('duty/' + ctx.uid).delete();
  const st = ctx.staff || {};
  await FB.saveStaff(ctx.uid, { dutyMins: (st.dutyMins || 0) + mins, lastDutyAt: now });
  await ctx.log('duty', over ? '結束值勤（逾時，不計時數）' : '結束值勤', fmt(mins), summary || '');
  return { mins, over };
}

async function command(ctx) {
  ctx.need(ORG.can.staff(ctx), '只有本公司員工可以使用值勤系統。');
  const cur = await FB.getDoc('duty/' + ctx.uid), now = Date.now();
  if (ctx.sub === 'on') {
    let note = '';
    if (cur) {
      ctx.need(now - cur.since > MAX, `你已在值勤中（<t:${D.unix(cur.since)}:R> 開始）。完成後請按「結束值勤」。`);
      await close(ctx, cur, '');
      note = '\n上一節值勤超過 12 小時仍未結束，已自動結束並標記為逾時，不計時數。';
    }
    await FB.setDoc('duty/' + ctx.uid, { uid: ctx.uid, name: ctx.name, dept: ctx.dept, title: ctx.title, since: now });
    await ctx.log('duty', '開始值勤', '', '');
    return ctx.edit(`${ctx.em('duty')}已開始值勤（<t:${D.unix(now)}:t>）。完成後請結束值勤並寫下工作摘要。${note}`);
  }
  if (ctx.sub === 'off') {
    ctx.need(cur, '你現時沒有在值勤。');
    const summary = ctx.i.type === 5 ? ctx.fields.summary : ctx.opt('summary');
    const r = await close(ctx, cur, summary);
    return ctx.edit(r.over ? '這一節值勤超過 12 小時，已標記為逾時，不計時數。下次請記得結束值勤。' : `${ctx.em('ok')}已結束值勤，本節 ${fmt(r.mins)}。工作摘要已記錄。`);
  }
  if (ctx.sub === 'board') {
    const on = (await FB.db().collection('duty').get()).docs.map((d) => d.data()).filter((x) => now - x.since <= MAX).sort((a, b) => a.since - b.since);
    return ctx.edit({ embeds: [{ color: B.COLOR.duty, author: B.head('值勤系統'), title: `現正值勤（${on.length} 人）`, description: on.length ? on.map((x) => `<@${x.uid}>｜${x.title || '員工'}｜<t:${D.unix(x.since)}:R> 開始`).join('\n') : '現時沒有同事值勤。' }], allowed_mentions: { parse: [] } });
  }
  if (ctx.sub === 'status') {
    const logs = (await FB.db().collection('dutylog').where('uid', '==', ctx.uid).get()).docs.map((d) => d.data()).sort((a, b) => b.end - a.end);
    const week = logs.filter((x) => x.end > now - 7 * 864e5).reduce((n, x) => n + x.mins, 0);
    return ctx.edit({ embeds: [{ color: B.COLOR.duty, author: B.head('值勤系統'), title: '我的值勤紀錄', fields: [
      { name: '現況', value: cur ? `值勤中（<t:${D.unix(cur.since)}:R> 開始）` : '沒有在值勤', inline: true },
      { name: '最近七日', value: fmt(week), inline: true }, { name: '累計', value: fmt((ctx.staff || {}).dutyMins || 0), inline: true },
      { name: '最近紀錄', value: logs.length ? logs.slice(0, 6).map((x) => `${D.hkText(x.start).slice(5)}｜${x.over ? '逾時' : fmt(x.mins)}${x.summary ? '｜' + D.trunc(x.summary, 60) : ''}`).join('\n') : '尚未有紀錄。' },
    ] }] });
  }
  throw new UserError('未支援的指令。');
}

module.exports = { command };
