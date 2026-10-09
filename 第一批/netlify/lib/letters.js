'use strict';
// 公函系統：按範本草擬 → 預覽（公司信箋圖像）→ 發出（或送交核准）→ 送到個案討論串或以私訊送達 → 編號存檔。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { KINDS, GUIDE, DEPT_CODE } = require('./lettertpl');
const { can } = ORG;
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const ST = { draft: '草稿', review: '待核准', sent: '已發出', dropped: '已取消', returned: '已退回' };
const mayWrite = (p) => can.cases(p) || can.manage(p);

async function render(l) {
  const doc = await require('./docs').letter({ ref: l.ref, date: D.zhDate(l.at), to: l.to, subject: l.subject, paras: ['敬啟者：', ...l.body.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean), '此致'], signName: `${l.byName}　謹啟`, signTitle: `${l.byTitle}　${l.byTitleEn}`, unit: l.unit });
  const fn = l.id;
  return [{ name: fn + '.png', data: doc.png, type: 'image/png' }, { name: fn + '.pdf', data: doc.pdf, type: 'application/pdf' }];
}
const embed = (l, note) => ({ color: l.status === 'sent' ? C.ok : l.status === 'review' ? C.pending : C.ink, author: B.head('公函'), title: `${l.id}｜${KINDS[l.kind].zh}｜${D.trunc(l.subject, 150)}`, description: note || '', fields: [{ name: '收件人', value: l.to, inline: true }, { name: '送達方式', value: l.caseId ? `個案 ${l.caseId} 的討論串` : l.toUid ? `私訊 <@${l.toUid}>` : '由草擬人自行轉交', inline: true }, { name: '狀態', value: ST[l.status], inline: true }], image: { url: `attachment://${l.id}.png` }, footer: { text: `檔號 ${l.ref}｜草擬：${l.byName}（${l.byTitle}）${l.okBy ? '｜核准：' + l.okBy : ''}` } });

/** 表單提交：建立草稿並顯示預覽 */
async function submit(ctx) {
  ctx.need(mayWrite(ctx), '只有處理個案的同事及助理經理或以上可以草擬公函。');
  const [, , kind, target] = ctx.cid, f = ctx.fields, k = KINDS[kind];
  ctx.need(k, '未知的公函類別。');
  ctx.need(!/[〔〕]/.test(f.body + f.subject + f.to), '正文內仍有〔 〕提示尚未換成實際內容。請重新草擬並把每個〔 〕換掉。');
  ctx.need(f.body.replace(/\s/g, '').length >= 40, '正文太短。公函最少要交代來由、內容及下一步。');
  const l = { kind, to: f.to, subject: f.subject, body: f.body, status: 'draft', at: Date.now(), by: ctx.uid, byName: ctx.name, byTitle: ctx.title, byTitleEn: ctx.titleEn, byG: ctx.g, unit: ctx.dept ? ORG.DEPT[ctx.dept].zh : '', caseId: '', toUid: '' };
  if (/^c\d+$/.test(target || '')) { const c = await FB.getDoc('cases/' + FB.norm('CS', target.slice(1))); ctx.need(c, '找不到這宗個案。'); ctx.need(c.threadId, '這宗個案沒有討論串，請改用私訊送達。'); l.caseId = c.id; l.threadId = c.threadId; l.toUid = c.uid; }
  else if (/^u\w+$/.test(target || '')) l.toUid = target.slice(1);
  const year = D.ymd(l.at).slice(0, 4), n = await FB.next('lt-' + year);
  l.id = `LT-${year}-${FB.pad(n)}`; l.ref = `CV/${DEPT_CODE[ctx.dept] || 'GM'}/${year}/${FB.pad(n)}`;
  const files = await render(l);
  await FB.setDoc('letters/' + l.id, l);
  const needOk = k.check && ctx.g < 4;
  return ctx.edit({ content: '', embeds: [embed(l, `請核對預覽。${needOk ? '這類公函須由助理經理或以上核准：按「送交核准」。' : '確認無誤後按「發出」。'}發出後不可修改；如需更改請取消後重新草擬。`)], components: [row(btn(`lt:send:${l.id}`, needOk ? '送交核准' : '發出', 3, { emoji: ctx.emo('publish') }), btn(`lt:drop:${l.id}`, '取消', 4))] }, files);
}
async function deliver(ctx, l, files) {
  const msg = { embeds: [{ color: C.ink, author: B.head(l.unit || '公函'), title: l.subject, description: `${l.to}：\n本公司的正式函件已附上（圖像及 PDF）。`, image: { url: `attachment://${l.id}.png` }, footer: { text: `檔號 ${l.ref}` } }], allowed_mentions: { parse: [] } };
  let how = '請下載附件並自行轉交收件人。';
  if (l.threadId) { await D.api('POST', `/channels/${l.threadId}/messages`, msg, files); how = `已送到個案 ${l.caseId} 的討論串。`; }
  else if (l.toUid) how = (await D.dm(l.toUid, msg, files)) ? '已以私訊送達。' : '對方關閉了私訊，未能送達；請下載附件並以其他方式轉交。';
  await FB.setDoc('letters/' + l.id, { status: 'sent', sentAt: Date.now(), okBy: l.okBy || '' });
  await ctx.log('client', '發出公函', l.ref, `${KINDS[l.kind].zh}｜致 ${l.to}｜${l.subject}`);
  return how;
}
async function button(ctx) {
  const [, b, id] = ctx.cid, l = await FB.getDoc('letters/' + id);
  ctx.need(l, '找不到這封公函。');
  if (b === 'drop') { ctx.need(l.by === ctx.uid && l.status === 'draft', '只可以取消自己的草稿。'); await FB.setDoc('letters/' + id, { status: 'dropped' }); return ctx.edit({ content: `已取消 ${id}。`, embeds: [], components: [], attachments: [] }); }
  if (b === 'send') {
    ctx.need(l.by === ctx.uid && l.status === 'draft', '這封公函已經處理。');
    const files = await render(l);
    if (KINDS[l.kind].check && l.byG < 4) {
      const ch = ctx.needChannel('cases', '個案處理');
      await FB.setDoc('letters/' + id, { status: 'review' });
      await D.api('POST', `/channels/${ch}/messages`, { embeds: [embed({ ...l, status: 'review' }, '請核對內容、用字及事實。核准後系統會即時送達收件人。')], components: [row(btn(`lt:ok:${id}`, '核准並發出', 3), btn(`lt:no:${id}`, '退回', 4))], allowed_mentions: { parse: [] } }, [files[0]]);
      return ctx.edit({ content: `已把 ${id} 送交核准。核准或退回後你會收到私訊。`, embeds: [], components: [], attachments: [] });
    }
    const how = await deliver(ctx, l, files);
    return ctx.edit({ content: `${id} 已發出。${how}`, embeds: [embed({ ...l, status: 'sent' })], components: [] });
  }
  if (b === 'ok') {
    ctx.need(can.manage(ctx), '只有助理經理或以上可以核准公函。'); ctx.need(l.status === 'review', '這封公函已經處理。'); ctx.need(l.by !== ctx.uid, '不可以核准自己草擬的公函。');
    const nl = { ...l, okBy: ctx.name }, how = await deliver(ctx, nl, await render(nl));
    await ctx.edit({ embeds: [{ ...embed({ ...nl, status: 'sent' }), image: undefined }], components: [], attachments: [] });
    await D.dm(l.by, { embeds: [{ color: C.ok, author: B.head('公函'), title: `${id} 已核准並發出`, description: `核准：${ctx.name}（${ctx.title}）\n${how}` }] });
    return null;
  }
  throw new UserError('未支援的操作。');
}
async function returnSubmit(ctx) {
  const id = ctx.cid[2], l = await FB.getDoc('letters/' + id);
  ctx.need(can.manage(ctx), '只有助理經理或以上可以退回公函。'); ctx.need(l && l.status === 'review', '這封公函已經處理。');
  await FB.setDoc('letters/' + id, { status: 'returned', returnNote: ctx.fields.note });
  await ctx.edit({ embeds: [{ color: C.alert, author: B.head('公函'), title: `${id}｜已退回`, description: ctx.fields.note, footer: { text: `退回：${ctx.name}` } }], components: [], attachments: [] });
  await D.dm(l.by, { embeds: [{ color: C.alert, author: B.head('公函'), title: `${id} 被退回`, description: `**需要修改：**${ctx.fields.note}\n\n請修改後重新草擬。原草稿如下：\n\n${D.trunc(l.body, 2500)}`, footer: { text: `退回：${ctx.name}（${ctx.title}）` } }] });
  await ctx.log('client', '退回公函', l.ref, ctx.fields.note);
  return null;
}
async function command(ctx) {
  if (ctx.sub === 'guide') return ctx.edit({ embeds: [{ color: C.ink, author: B.head('公函寫作指南'), description: '使用 `/letter new` 選擇類別，系統會提供範本。把範本內每個〔 〕換成實際內容後提交，核對預覽再發出。', fields: GUIDE.map(([name, value]) => ({ name, value })), footer: { text: `範本類別：${Object.values(KINDS).map((k) => k.zh).join('、')}` } }] });
  ctx.need(mayWrite(ctx), '只有處理個案的同事及助理經理或以上可以使用公函系統。');
  const list = (await FB.db().collection('letters').get()).docs.map((d) => d.data()).filter((l) => l.status !== 'dropped' && (can.senior(ctx) || l.by === ctx.uid)).sort((a, b) => b.at - a.at).slice(0, 15);
  return ctx.edit({ embeds: [{ color: C.ink, author: B.head('公函'), title: '公函紀錄', description: list.length ? list.map((l) => `\`${l.ref}\` ${KINDS[l.kind].zh}｜${ST[l.status]}｜致 ${D.trunc(l.to, 20)}｜${D.trunc(l.subject, 30)}`).join('\n') : '尚未有公函。' }] });
}

module.exports = { submit, button, returnSubmit, command };
