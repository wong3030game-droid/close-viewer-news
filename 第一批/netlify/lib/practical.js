'use strict';
// 實務評核：管理系列部分課程除考試及案例分析外，須由評核員觀察考生實際操作（例如主持面談、危機演練、傳媒問答）。
// 流程：考生在課程頁按「預約實務評核」→ 評卷台出現評核卡 → 評核員按「接手評核」並與考生約時間 → 完成後按「合格」或「不合格」並填寫評語。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const { COURSE } = require('./courses');
const { can } = require('./org');
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const STATUS = { open: '待接手', claimed: '評核中', pass: '合格', fail: '不合格', cancelled: '已取消' };
const prOk = (st, id) => !!(st && st.practicals && st.practicals[id] && st.practicals[id].ok);

function cardMsg(ctx, p) {
  const c = COURSE[p.cid], pr = c.practical, done = p.status === 'pass' || p.status === 'fail';
  const emb = {
    color: done ? (p.status === 'pass' ? C.ok : C.alert) : C.pending, author: B.head('培訓學院｜實務評核'), title: `${p.id}｜${c.id} ${c.name}｜${pr.title}`,
    description: pr.task,
    fields: [
      { name: '考生', value: `<@${p.uid}>（${p.title}）`, inline: true }, { name: '狀態', value: STATUS[p.status], inline: true }, { name: '評核員', value: p.byId ? `<@${p.byId}>` : '未有', inline: true },
      { name: `評核準則（共 ${pr.criteria.length} 項）`, value: pr.criteria.map((x, n) => `${n + 1}. ${x}`).join('\n') },
    ],
    footer: { text: done ? `${STATUS[p.status]}｜${p.by}｜${D.hkText(p.doneAt)}` : '評核員須與考生沒有直屬上下級以外的利益關係；不可評核自己。合格須最少符合五項準則，並在評語逐項說明。' }, timestamp: new Date(p.at).toISOString(),
  };
  if (p.note) emb.fields.push({ name: '評核紀錄及評語', value: D.trunc(p.note, 1000) });
  const comps = p.status === 'open' ? [row(btn(`pa:claim:${p.id}`, '接手評核', 1, { emoji: ctx.emo('academy') }), btn(`pa:cancel:${p.id}`, '取消預約', 2))]
    : p.status === 'claimed' ? [row(btn(`pa:pass:${p.id}`, '合格', 3, { emoji: ctx.emo('ok') }), btn(`pa:fail:${p.id}`, '不合格', 4), btn(`pa:release:${p.id}`, '交回', 2))] : [];
  return { embeds: [emb], components: comps, allowed_mentions: { parse: [] } };
}

/** 考生預約（由課程頁按鈕 ac:prac:<課程> 呼叫） */
async function book(ctx, c) {
  ctx.need(c.practical, '這一科沒有實務評核。');
  const st = ctx.staff || {};
  ctx.need(!prOk(st, c.id), `你已通過 ${c.id} 的實務評核。`);
  ctx.need(st.exams && st.exams[c.id], `請先通過 ${c.id} 的考試，才可以預約實務評核。`);
  const mine = (await FB.db().collection('practicals').where('uid', '==', ctx.uid).get()).docs.map((d) => d.data()).find((p) => p.cid === c.id && (p.status === 'open' || p.status === 'claimed'));
  ctx.need(!mine, `你已預約 ${c.id} 的實務評核（${mine && mine.id}），請等候評核員聯絡。`);
  const ch = ctx.needChannel('marking', '評卷台'), n = await FB.next('practical'), id = 'PA-' + FB.pad(n);
  const p = { id, n, cid: c.id, uid: ctx.uid, name: ctx.name, title: ctx.title, g: ctx.g, status: 'open', at: Date.now() };
  const m = await D.api('POST', `/channels/${ch}/messages`, cardMsg(ctx, p));
  await FB.setDoc('practicals/' + id, { ...p, msgId: m.id, channelId: ch });
  await ctx.log('academy', '預約實務評核', id, `${c.id} ${c.practical.title}｜${ctx.name}`);
  return ctx.follow(`已預約 ${c.id}《${c.practical.title}》，編號 **${id}**。評核員接手後會私訊你約定時間。\n評核內容：${c.practical.task}`);
}

async function button(ctx) {
  const [, b, id] = ctx.cid, p = await FB.getDoc('practicals/' + id);
  ctx.need(p, '找不到這項實務評核。');
  const c = COURSE[p.cid];
  if (b === 'cancel') {
    ctx.need(p.status === 'open', '評核已有人接手，請聯絡評核員。');
    ctx.need(p.uid === ctx.uid || can.hr(ctx), '只有考生本人或人力資源可以取消預約。');
    await FB.setDoc('practicals/' + id, { status: 'cancelled', doneAt: Date.now(), by: ctx.name });
    await ctx.log('academy', '取消實務評核', id, `${c.id}｜${p.name}`);
    return ctx.edit({ ...cardMsg(ctx, { ...p, status: 'cancelled' }), components: [] });
  }
  ctx.need(can.examine(ctx) && (ctx.g >= 5 || ctx.examiner), '實務評核須由經理或以上，或學院評核員主持。');
  ctx.need(p.uid !== ctx.uid, '不可以評核自己。');
  if (b === 'claim') {
    ctx.need(p.status === 'open', `這項評核已由 ${p.byName || '其他評核員'} 接手。`);
    await FB.setDoc('practicals/' + id, { status: 'claimed', byId: ctx.uid, byName: ctx.name, claimedAt: Date.now() });
    await D.dm(p.uid, { embeds: [{ color: C.academy, author: B.head('培訓學院｜實務評核'), title: `${c.id}《${c.practical.title}》已有評核員接手`, description: `評核員 ${ctx.name}（${ctx.title}）會與你約定時間。\n\n**評核內容**\n${c.practical.task}\n\n**評核準則**\n${c.practical.criteria.map((x, n) => `${n + 1}. ${x}`).join('\n')}`, footer: { text: id } }] });
    await ctx.log('academy', '接手實務評核', id, `${c.id}｜考生 ${p.name}`);
    return ctx.edit(cardMsg(ctx, { ...p, status: 'claimed', byId: ctx.uid, byName: ctx.name }));
  }
  if (b === 'release') {
    ctx.need(p.status === 'claimed' && (p.byId === ctx.uid || ctx.g >= 7), '只有接手的評核員可以交回。');
    await FB.setDoc('practicals/' + id, { status: 'open', byId: '', byName: '' });
    await ctx.log('academy', '交回實務評核', id, c.id);
    return ctx.edit(cardMsg(ctx, { ...p, status: 'open', byId: '', byName: '' }));
  }
  throw new UserError('未支援的操作。');
}

/** 評核結果（表單 mu:papass／mu:pafail） */
async function resultSubmit(ctx) {
  const ok = ctx.cid[1] === 'papass', id = ctx.cid[2], p = await FB.getDoc('practicals/' + id), note = ctx.fields.note || '';
  ctx.need(p, '找不到這項實務評核。');
  ctx.need(p.status === 'claimed', '這項評核未有人接手，或已經完成。');
  ctx.need(p.byId === ctx.uid || ctx.g >= 7, '只有接手的評核員可以記錄結果。');
  ctx.need(p.uid !== ctx.uid, '不可以評核自己。');
  ctx.need(note.replace(/\s/g, '').length >= (ok ? 80 : 30), ok ? '合格的評語最少 80 字，請逐項說明考生符合哪些準則。' : '請最少用 30 字說明未符合哪些準則及改善方向。');
  const c = COURSE[p.cid], patch = { status: ok ? 'pass' : 'fail', note, by: ctx.name, byTitle: ctx.title, doneAt: Date.now() };
  await FB.setDoc('practicals/' + id, patch);
  await ctx.edit(cardMsg(ctx, { ...p, ...patch }));
  const st = (await FB.getStaff(p.uid)) || {};
  await FB.saveStaff(p.uid, { practicals: { ...(st.practicals || {}), [p.cid]: { ok, id, by: ctx.name, at: patch.doneAt } } });
  await ctx.log('academy', `實務評核：${ok ? '合格' : '不合格'}`, id, `${c.id}｜${p.name}｜${D.trunc(note, 200)}`);
  const awarded = ok ? await require('./academy').settle(ctx, { uid: p.uid, name: p.name, title: p.title }) : [];
  await D.dm(p.uid, { embeds: [{ color: ok ? C.ok : C.alert, author: B.head('培訓學院｜實務評核'), title: `${c.id}《${c.practical.title}》：${ok ? '合格' : '不合格'}`, description: `**評語：**${note}\n\n評核員：${ctx.name}（${ctx.title}）` + (ok ? (awarded.length ? `\n\n你已獲頒${awarded.map((k) => `《${k.zh}》`).join('、')}。` : '') : '\n\n你可以在課程頁重新預約。'), footer: { text: id } }] });
  return null;
}

module.exports = { book, button, resultSubmit, prOk, STATUS };
