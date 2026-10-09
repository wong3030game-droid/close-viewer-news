'use strict';
// 內部申請系統：請假、資源、經費、權限、調職、離職通知等。提交 → 審批 → 通知 → 紀錄。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { REQ_TYPES, REQ_STATUS, DEPT, can } = ORG;
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const COLOR = { pending: C.pending, approved: C.ok, rejected: C.alert, cancelled: C.muted };

function cardMsg(ctx, r, done) {
  const t = REQ_TYPES[r.type];
  const e = {
    color: COLOR[r.status], author: B.head('申請審批'), title: `${r.id}｜${t.zh}`,
    fields: [
      { name: '申請人', value: `<@${r.uid}>（${r.title}）`, inline: true }, { name: '部門', value: r.dept ? DEPT[r.dept].zh : '尚未編入', inline: true }, { name: '狀態', value: REQ_STATUS[r.status], inline: true },
      ...t.f.map(([k, label]) => ({ name: label, value: D.trunc(r.f[k] || '—', 1000) })),
    ],
    footer: { text: done || '由申請人所屬部門或人力資源及行政部的助理經理或以上審批。請於 48 小時內處理。' }, timestamp: new Date(r.at).toISOString(),
  };
  if (r.note) e.fields.push({ name: r.status === 'rejected' ? '不批准原因' : '備註', value: D.trunc(r.note, 1000) });
  return { embeds: [e], components: r.status === 'pending' ? [row(btn(`rq:ok:${r.id}`, '批准', 3, { emoji: ctx.emo('ok') }), btn(`rq:no:${r.id}`, '不批准', 4))] : [], allowed_mentions: { parse: [] } };
}
async function mustGet(x) {
  const id = FB.norm('REQ', x), r = id && (await FB.getDoc('requests/' + id));
  if (!r) throw new UserError(`找不到申請 ${id || x}。`);
  return r;
}
/** 審批權限：部門或人力資源的助理經理或以上；不可審批自己；申請人職級不可高於或等於審批人（董事會及管理員除外） */
function mayDecide(ctx, r) {
  ctx.need(can.approve(ctx, r.dept), '你沒有審批這項申請的權限。申請由申請人所屬部門或人力資源及行政部的助理經理或以上審批。');
  ctx.need(r.uid !== ctx.uid, '不可以審批自己的申請，請交由另一位管理人員處理。');
  ctx.need(ctx.admin || ctx.g >= 7 || ctx.g > (r.g || 0), '申請人的職級不低於你，請交由更高級的管理人員審批。');
  ctx.need(r.status === 'pending', `這項申請現時的狀態是「${REQ_STATUS[r.status]}」。`);
}
/** 由「2026-10-12 至 2026-10-14」取出最後一個日期，作為假期結束日（香港時間當日 23:59） */
function leaveEnd(text) {
  const all = String(text || '').match(/\d{4}-\d{1,2}-\d{1,2}/g);
  if (!all) return 0;
  const [y, m, d] = all[all.length - 1].split('-').map(Number), ms = Date.UTC(y, m - 1, d, 15, 59);
  return Number.isFinite(ms) ? ms : 0;
}

async function submit(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以提交內部申請。公眾查詢請使用服務台。');
  const type = REQ_TYPES[ctx.cid[2]] ? ctx.cid[2] : 'other', ch = ctx.needChannel('requests', '申請審批');
  const n = await FB.next('request'), id = 'REQ-' + FB.pad(n);
  const r = { id, n, type, uid: ctx.uid, name: ctx.name, title: ctx.title, g: ctx.g, dept: ctx.dept, f: ctx.fields, status: 'pending', at: Date.now() };
  const m = await D.api('POST', `/channels/${ch}/messages`, cardMsg(ctx, r));
  await FB.setDoc('requests/' + id, { ...r, msgId: m.id, channelId: ch });
  await ctx.log('request', `提交申請：${REQ_TYPES[type].zh}`, id, Object.values(ctx.fields).filter(Boolean).map((x) => D.trunc(x, 80)).join('｜'));
  return ctx.edit(`${ctx.em('request')}已提交${REQ_TYPES[type].zh}申請，編號 **${id}**。審批結果會以私訊通知；可使用 \`/request view id:${id}\` 查看進度。`);
}

async function decide(ctx, r, ok, note) {
  mayDecide(ctx, r);
  const patch = { status: ok ? 'approved' : 'rejected', by: ctx.name, byTitle: ctx.title, note: note || '', doneAt: Date.now() };
  await FB.setDoc('requests/' + r.id, patch);
  const nr = { ...r, ...patch }, t = REQ_TYPES[r.type];
  await ctx.edit(cardMsg(ctx, nr, `${ok ? '已批准' : '不批准'}｜${ctx.name}（${ctx.title}）｜${D.hkText(patch.doneAt)}`));
  let extra = '';
  if (ok && r.type === 'leave') {
    const until = leaveEnd(r.f.when);
    if (until) { await FB.saveStaff(r.uid, { leaveUntil: until, leaveRef: r.id }); extra = `\n假期至 ${D.ymd(until)}，期間你的員工檔案會顯示為休假中。`; }
  }
  if (ok && r.type === 'resign') extra = '\n人力資源及行政部會在你的最後工作日後辦理離職手續。請按交接安排完成交接。';
  await D.dm(r.uid, { embeds: [{ color: ok ? C.ok : C.alert, author: B.head('申請審批'), title: `${r.id}｜${t.zh}｜${ok ? '已批准' : '不批准'}`, description: (note ? `**${ok ? '備註' : '原因'}：**${note}\n` : '') + `審批：${ctx.name}（${ctx.title}）${extra}` }] });
  await ctx.log('request', `${ok ? '批准' : '不批准'}申請：${t.zh}`, r.id, `申請人 ${r.name}${note ? '｜' + note : ''}`);
  return null;
}
const button = async (ctx) => { if (ctx.cid[1] !== 'ok') throw new UserError('未支援的操作。'); return decide(ctx, await mustGet(ctx.cid[2]), true, ''); };
const rejectSubmit = async (ctx) => decide(ctx, await mustGet(ctx.cid[2]), false, ctx.fields.note);

async function command(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以使用內部申請系統。');
  if (ctx.sub === 'list') {
    const all = (await FB.db().collection('requests').get()).docs.map((d) => d.data());
    const line = (r) => `\`${r.id}\` ${REQ_TYPES[r.type].zh}｜${REQ_STATUS[r.status]}｜${D.ymd(r.at)}`;
    const mine = all.filter((r) => r.uid === ctx.uid).sort((a, b) => b.n - a.n).slice(0, 10);
    const embeds = [{ color: C.request, author: B.head('內部申請'), title: '我的申請', description: mine.length ? mine.map(line).join('\n') : '你尚未提交任何申請。可在「員工服務」頻道按「提交申請」。' }];
    const pend = all.filter((r) => r.status === 'pending' && r.uid !== ctx.uid && can.approve(ctx, r.dept)).sort((a, b) => a.n - b.n).slice(0, 15);
    if (can.approve(ctx, ctx.dept)) embeds.push({ color: C.pending, title: `待你審批（${pend.length}）`, description: pend.length ? pend.map((r) => `${line(r)}｜${r.name}${r.msgId ? `｜[前往審批](https://discord.com/channels/${ctx.guild}/${r.channelId}/${r.msgId})` : ''}`).join('\n') : '沒有待審批的申請。' });
    return ctx.edit({ embeds });
  }
  const r = await mustGet(ctx.opt('id'));
  ctx.need(r.uid === ctx.uid || can.approve(ctx, r.dept), '只有申請人及審批人員可以查看這項申請。');
  if (ctx.sub === 'view') return ctx.edit({ ...cardMsg(ctx, r, r.by ? `${REQ_STATUS[r.status]}｜${r.by}` : undefined), components: [] });
  if (ctx.sub === 'cancel') {
    ctx.need(r.uid === ctx.uid, '只有申請人可以取消自己的申請。');
    ctx.need(r.status === 'pending', `這項申請現時的狀態是「${REQ_STATUS[r.status]}」，不可以取消。`);
    await FB.setDoc('requests/' + r.id, { status: 'cancelled', doneAt: Date.now() });
    if (r.msgId) { try { await D.api('PATCH', `/channels/${r.channelId}/messages/${r.msgId}`, cardMsg(ctx, { ...r, status: 'cancelled' }, '申請人已取消')); } catch { /* 訊息可能已被刪除 */ } }
    await ctx.log('request', '取消申請', r.id, '');
    return ctx.edit(`已取消申請 ${r.id}。`);
  }
  throw new UserError('未支援的指令。');
}

module.exports = { submit, button, rejectSubmit, command, leaveEnd };
