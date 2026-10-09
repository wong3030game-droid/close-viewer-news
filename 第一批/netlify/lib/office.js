'use strict';
// 辦公室系統：嘉許、意見箱、申訴、會議及出席、工作交接、任務分派、董事會決議、管理報告、部門通訊錄、標準回覆。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { DEPT, DEPTS, GRADE, can } = ORG;
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const post = (ch, body, files) => D.api('POST', `/channels/${ch}/messages`, { allowed_mentions: { parse: [] }, ...body }, files);
const card = (ctx) => ({ ...((ctx.i.message && ctx.i.message.embeds && ctx.i.message.embeds[0]) || {}) });
const year = () => D.ymd(Date.now()).slice(0, 4);

/* ---------- 嘉許 /kudos ---------- */
async function kudos(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以嘉許同事。');
  const t = require('./hr').target(ctx), reason = ctx.opt('reason');
  ctx.need(t.g > 0, `${t.name} 不是本公司員工。`); ctx.need(t.id !== ctx.uid, '不可以嘉許自己。');
  const today = D.ymd(Date.now()), mine = (await FB.db().collection('kudos').where('from', '==', ctx.uid).get()).docs.filter((d) => D.ymd(d.data().at) === today);
  ctx.need(mine.length < 3, '每日最多嘉許三次。嘉許貴精不貴多。');
  await FB.db().collection('kudos').add({ at: Date.now(), from: ctx.uid, fromName: ctx.name, to: t.id, toName: t.name, reason });
  const st = (await FB.getStaff(t.id)) || {};
  await FB.saveStaff(t.id, { kudos: (st.kudos || 0) + 1 });
  const ch = ctx.settings.channels.kudos;
  if (ch) await post(ch, { embeds: [{ color: C.brand, author: B.head('嘉許榜'), description: `${ctx.em('cert')}<@${t.id}>（${ORG.title(t.rank, t.dept)}）獲 <@${ctx.uid}> 嘉許：\n\n**${reason}**`, footer: { text: `累計獲嘉許 ${(st.kudos || 0) + 1} 次` }, timestamp: new Date().toISOString() }] });
  await ctx.log('hr', '嘉許', t.name, reason);
  return ctx.edit(`已嘉許 ${t.name}。${ch ? `已在 <#${ch}> 公佈。` : ''}`);
}

/* ---------- 意見箱 /suggest ---------- */
async function suggestSubmit(ctx) {
  ctx.need(can.staff(ctx), '意見箱只供本公司員工使用。公眾意見請到服務台。');
  const ch = ctx.needChannel('feedback', '意見及申訴'), anon = ctx.cid[2] === '1', f = ctx.fields, id = 'SG-' + FB.pad(await FB.next('suggest'));
  await FB.setDoc('suggestions/' + id, { id, at: Date.now(), uid: anon ? '' : ctx.uid, name: anon ? '' : ctx.name, anon, ...f });
  await post(ch, { embeds: [{ color: C.tip, author: B.head('意見箱'), title: `${id}｜${D.trunc(f.title, 200)}`, description: f.body, fields: [{ name: '提出人', value: anon ? '匿名' : `<@${ctx.uid}>（${ctx.title}）`, inline: true }], timestamp: new Date().toISOString() }] });
  await FB.audit(anon ? { name: '匿名' } : ctx.who, 'hr', '提交意見', id, D.trunc(f.title, 100));
  return ctx.edit(`已把你的意見（${id}）送交管理層。` + (anon ? '這是匿名意見：管理層不會知道是誰提出，因此亦無法個別回覆。' : ''));
}

/* ---------- 申訴 /appeal ---------- */
async function appealSubmit(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以提出申訴。');
  const ch = ctx.needChannel('feedback', '意見及申訴'), f = ctx.fields, id = 'AP-' + FB.pad(await FB.next('appeal'));
  const a = { id, at: Date.now(), uid: ctx.uid, name: ctx.name, title: ctx.title, g: ctx.g, ...f, status: 'pending' };
  await post(ch, { embeds: [{ color: C.pending, author: B.head('申訴'), title: `${id}｜申訴`, fields: [{ name: '申訴人', value: `<@${ctx.uid}>（${ctx.title}）`, inline: true }, { name: '針對的決定', value: f.about }, { name: '理由', value: f.why }, { name: '希望的結果', value: f.want || '—' }], footer: { text: '由沒有參與原決定的經理或以上處理；七日內作出決定。' }, timestamp: new Date().toISOString() }], components: [row(btn(`ap:keep:${id}`, '維持原決定', 2), btn(`ap:change:${id}`, '修改或撤銷原決定', 1))] });
  await FB.setDoc('appeals/' + id, a);
  await ctx.log('hr', '提出申訴', id, D.trunc(f.about, 150));
  return ctx.edit(`已提交申訴 **${id}**。管理層會在七日內以私訊通知結果。申訴期間原決定繼續生效。`);
}
async function appealDecide(ctx) {
  const [, kind, id] = ctx.cid, a = await FB.getDoc('appeals/' + id);
  ctx.need(can.senior(ctx), '只有經理或以上可以處理申訴。'); ctx.need(a, '找不到這宗申訴。');
  ctx.need(a.status === 'pending', '這宗申訴已經處理。'); ctx.need(a.uid !== ctx.uid, '不可以處理自己的申訴。');
  ctx.need(ctx.admin || ctx.g > (a.g || 0), '申訴人的職級不低於你，請交由更高級的同事處理。');
  const keep = kind === 'apkeep', res = keep ? '維持原決定' : '修改或撤銷原決定', note = ctx.fields.note;
  await FB.setDoc('appeals/' + id, { status: keep ? 'kept' : 'changed', by: ctx.name, note, doneAt: Date.now() });
  const e = card(ctx); e.color = keep ? C.muted : C.ok; e.fields = [...(e.fields || []), { name: `決定：${res}`, value: D.trunc(note, 1000) }]; e.footer = { text: `${res}｜${ctx.name}（${ctx.title}）` };
  await ctx.edit({ embeds: [e], components: [] });
  await D.dm(a.uid, { embeds: [{ color: keep ? C.muted : C.ok, author: B.head('申訴'), title: `申訴 ${id}：${res}`, description: `**說明：**${note}\n\n處理：${ctx.name}（${ctx.title}）\n每項決定只可以申訴一次。${keep ? '' : '\n有關的人事紀錄會由人力資源及行政部跟進修改。'}` }] });
  await ctx.log('hr', `申訴結果：${res}`, id, note);
  return null;
}

/* ---------- 會議 /meeting ---------- */
function meetingMsg(ctx, m) {
  const list = (ids) => (ids.length ? ids.map((x) => `<@${x}>`).join('、') : '—');
  const e = { color: C.notice, author: B.head('會議安排'), title: `${m.id}｜${D.trunc(m.title, 200)}`, fields: [{ name: '時間', value: m.when, inline: true }, { name: '召集人', value: `<@${m.uid}>（${m.by}）`, inline: true }, { name: '議程', value: D.trunc(m.agenda, 1000) }, { name: `出席（${m.yes.length}）`, value: D.trunc(list(m.yes), 1000), inline: true }, { name: `未能出席（${m.no.length}）`, value: D.trunc(list(m.no), 1000), inline: true }], footer: { text: m.minutes ? '已有會議紀錄' : '請按下方按鈕回覆是否出席。會後由召集人以 /meeting minutes 記錄決定、負責人及期限。' }, timestamp: new Date(m.at).toISOString() };
  if (m.minutes) e.fields.push({ name: '會議紀錄（決定｜負責人｜期限）', value: D.trunc(m.minutes, 1000) });
  return { embeds: [e], components: m.minutes ? [] : [row(btn(`mt:yes:${m.id}`, '出席', 3, { emoji: ctx.emo('ok') }), btn(`mt:no:${m.id}`, '未能出席', 2))], allowed_mentions: { parse: [] } };
}
async function meetingSubmit(ctx) {
  ctx.need(can.manage(ctx), '只有助理經理或以上可以召開會議。');
  const ch = ctx.needChannel('meetings', '會議安排'), f = ctx.fields, id = 'MT-' + FB.pad(await FB.next('meeting'));
  const m = { id, at: Date.now(), uid: ctx.uid, by: ctx.title, title: f.title, when: f.when, agenda: f.agenda, yes: [ctx.uid], no: [], minutes: '' };
  const msg = await post(ch, meetingMsg(ctx, m));
  await FB.setDoc('meetings/' + id, { ...m, msgId: msg.id, channelId: ch });
  await ctx.log('hr', '召開會議', id, `${f.title}｜${f.when}`);
  return ctx.edit(`已發出會議通知 **${id}**：<#${ch}>`);
}
async function meetingButton(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以回覆。');
  const [, b, id] = ctx.cid, m = await FB.getDoc('meetings/' + id);
  ctx.need(m, '找不到這個會議。');
  const yes = m.yes.filter((x) => x !== ctx.uid), no = m.no.filter((x) => x !== ctx.uid);
  (b === 'yes' ? yes : no).push(ctx.uid);
  await FB.setDoc('meetings/' + id, { yes, no });
  return ctx.edit(meetingMsg(ctx, { ...m, yes, no }));
}
async function meeting(ctx) {
  const id = FB.norm('MT', ctx.opt('id')), m = id && (await FB.getDoc('meetings/' + id));
  ctx.need(m, `找不到會議 ${id || ctx.opt('id')}。`);
  ctx.need(m.uid === ctx.uid || can.senior(ctx), '只有召集人或經理或以上可以記錄會議紀錄。');
  const minutes = ctx.opt('text');
  await FB.setDoc('meetings/' + id, { minutes });
  if (m.msgId) { try { await D.api('PATCH', `/channels/${m.channelId}/messages/${m.msgId}`, meetingMsg(ctx, { ...m, minutes })); } catch { /* 訊息可能已被刪除 */ } }
  await ctx.log('hr', '會議紀錄', id, minutes);
  return ctx.edit(`已記錄 ${id} 的會議紀錄，並更新會議通知。`);
}

/* ---------- 工作交接 /handover ---------- */
async function handoverSubmit(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以使用。');
  const f = ctx.fields, ch = ctx.settings.channels['d_' + ctx.dept] || ctx.settings.channels.staffchat;
  ctx.need(ch, '尚未設定部門頻道。請管理員使用 /setup auto。');
  await post(ch, { embeds: [{ color: C.duty, author: B.head('工作交接'), description: `<@${ctx.uid}>（${ctx.title}）的交接：`, fields: [{ name: '已完成', value: f.done }, { name: '未完成', value: f.pending }, { name: '下一步（誰、何時之前）', value: f.next }], timestamp: new Date().toISOString() }] });
  await ctx.log('duty', '工作交接', '', `未完成：${D.trunc(f.pending, 150)}｜下一步：${D.trunc(f.next, 150)}`);
  return ctx.edit(`已在 <#${ch}> 發出交接。`);
}

/* ---------- 任務 /task ---------- */
const TASK = { open: '待確認', doing: '進行中', done: '已完成' };
function taskMsg(ctx, t) {
  return { embeds: [{ color: { open: C.pending, doing: C.client, done: C.ok }[t.status], author: B.head('任務板'), title: `${t.id}｜${D.trunc(t.title, 200)}`, fields: [{ name: '負責人', value: `<@${t.to}>`, inline: true }, { name: '期限', value: t.due, inline: true }, { name: '狀態', value: TASK[t.status], inline: true }, { name: '分派人', value: `<@${t.from}>（${t.fromTitle}）`, inline: true }, ...(t.result ? [{ name: '完成摘要', value: D.trunc(t.result, 1000) }] : [])], timestamp: new Date(t.at).toISOString() }], components: t.status === 'done' ? [] : [row(...(t.status === 'open' ? [btn(`tk:take:${t.id}`, '確認接收', 1)] : []), btn(`tk:done:${t.id}`, '完成', 3, { emoji: ctx.emo('ok') }))], allowed_mentions: { parse: [] } };
}
async function task(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以使用任務板。');
  if (ctx.sub === 'list') {
    const all = (await FB.db().collection('tasks').get()).docs.map((d) => d.data()).filter((t) => t.status !== 'done' && (t.to === ctx.uid || t.from === ctx.uid)).sort((a, b) => a.n - b.n);
    return ctx.edit({ embeds: [{ color: C.client, author: B.head('任務板'), title: `未完成的任務（${all.length}）`, description: all.length ? all.map((t) => `\`${t.id}\` ${D.trunc(t.title, 50)}｜${t.to === ctx.uid ? '由我負責' : `<@${t.to}>`}｜${t.due}｜${TASK[t.status]}`).join('\n') : '沒有未完成的任務。' }], allowed_mentions: { parse: [] } });
  }
  ctx.need(can.manage(ctx), '只有助理經理或以上可以分派任務。');
  const who = require('./hr').target(ctx), ch = ctx.needChannel('tasks', '任務板');
  ctx.need(who.g > 0, `${who.name} 不是本公司員工。`); ctx.need(ctx.admin || who.g <= ctx.g, '不可以向職級比你高的同事分派任務。');
  const n = await FB.next('task'), id = 'TK-' + FB.pad(n);
  const t = { id, n, at: Date.now(), from: ctx.uid, fromTitle: ctx.title, to: who.id, toName: who.name, title: ctx.opt('title'), due: ctx.opt('due'), status: 'open' };
  const m = await post(ch, { content: `<@${who.id}>`, ...taskMsg(ctx, t), allowed_mentions: { users: [who.id] } });
  await FB.setDoc('tasks/' + id, { ...t, msgId: m.id, channelId: ch });
  await ctx.log('duty', '分派任務', id, `${who.name}｜${t.title}｜期限 ${t.due}`);
  return ctx.edit(`已分派任務 **${id}** 予 ${who.name}：<#${ch}>`);
}
async function taskAct(ctx, id, done, result) {
  const t = await FB.getDoc('tasks/' + id);
  ctx.need(t, '找不到這項任務。'); ctx.need(t.status !== 'done', '這項任務已經完成。');
  ctx.need(t.to === ctx.uid, '只有負責人可以確認或完成這項任務。');
  const patch = done ? { status: 'done', result, doneAt: Date.now() } : { status: 'doing', takenAt: Date.now() };
  await FB.setDoc('tasks/' + id, patch);
  await ctx.edit(taskMsg(ctx, { ...t, ...patch }));
  if (done) { await ctx.log('duty', '完成任務', id, D.trunc(result, 200)); await D.dm(t.from, { embeds: [{ color: C.ok, author: B.head('任務板'), title: `${id} 已完成`, description: `**${t.title}**\n負責人：${ctx.name}\n\n${result}` }] }); }
  return null;
}
const taskButton = (ctx) => { if (ctx.cid[1] !== 'take') throw new UserError('未支援的操作。'); return taskAct(ctx, ctx.cid[2], false); };
const taskDone = (ctx) => taskAct(ctx, ctx.cid[2], true, ctx.fields.note);

/* ---------- 董事會決議 /resolution ---------- */
function resMsg(ctx, r) {
  const n = (k) => Object.values(r.votes).filter((v) => v === k).length, closed = r.status !== 'open';
  return { embeds: [{ color: r.status === 'passed' ? C.ok : r.status === 'failed' ? C.alert : C.notice, author: B.head('董事會'), title: `${r.no}｜${D.trunc(r.title, 200)}`, description: r.body, fields: [{ name: '贊成', value: String(n('for')), inline: true }, { name: '反對', value: String(n('against')), inline: true }, { name: '棄權', value: String(n('abstain')), inline: true }, ...(closed ? [{ name: '結果', value: r.status === 'passed' ? '**通過**' : '**不獲通過**' }, { name: '表決紀錄', value: D.trunc(Object.entries(r.votes).map(([u, v]) => `<@${u}>：${{ for: '贊成', against: '反對', abstain: '棄權' }[v]}`).join('\n') || '沒有人投票', 1000) }] : [])], footer: { text: closed ? `表決已結束｜提案：${r.byName}` : `提案：${r.byName}｜只限董事會成員投票，可更改；由提案人或主席結束表決。贊成多於反對即通過。` }, timestamp: new Date(r.at).toISOString() }], components: closed ? [] : [row(btn(`rs:for:${r.id}`, '贊成', 3), btn(`rs:against:${r.id}`, '反對', 4), btn(`rs:abstain:${r.id}`, '棄權', 2), btn(`rs:close:${r.id}`, '結束表決', 1))], allowed_mentions: { parse: [] } };
}
async function resolutionSubmit(ctx) {
  ctx.need(can.board(ctx), '只有董事會成員可以提出決議案。');
  const ch = ctx.needChannel('board', '董事會'), f = ctx.fields, n = await FB.next('res-' + year()), id = `BR-${year()}-${FB.pad(n, 3)}`;
  const r = { id, no: `董事會決議第 ${year()}/${FB.pad(n, 3)} 號`, at: Date.now(), by: ctx.uid, byName: ctx.name, title: f.title, body: f.body, votes: {}, status: 'open' };
  const m = await post(ch, resMsg(ctx, r));
  await FB.setDoc('resolutions/' + id, { ...r, msgId: m.id, channelId: ch });
  await ctx.log('system', '提出董事會決議案', r.no, f.title);
  return ctx.edit(`已提出${r.no}：<#${ch}>`);
}
async function resolutionButton(ctx) {
  const [, b, id] = ctx.cid, r = await FB.getDoc('resolutions/' + id);
  ctx.need(can.board(ctx), '只有董事會成員可以投票。'); ctx.need(r, '找不到這項決議案。'); ctx.need(r.status === 'open', '表決已經結束。');
  if (b === 'close') {
    ctx.need(r.by === ctx.uid || ctx.rank === 'chairman', '只有提案人或主席可以結束表決。');
    const v = Object.values(r.votes), status = v.filter((x) => x === 'for').length > v.filter((x) => x === 'against').length ? 'passed' : 'failed';
    await FB.setDoc('resolutions/' + id, { status, closedAt: Date.now() });
    await ctx.log('system', `董事會決議${status === 'passed' ? '通過' : '不獲通過'}`, r.no, r.title);
    return ctx.edit(resMsg(ctx, { ...r, status }));
  }
  const votes = { ...r.votes, [ctx.uid]: b };
  await FB.db().doc('resolutions/' + id).update({ votes });
  return ctx.edit(resMsg(ctx, { ...r, votes }));
}

/* ---------- 管理報告 /report ---------- */
async function report(ctx) {
  if (ctx.sub === 'stories') return require('./plus').storyStats(ctx);
  ctx.need(can.senior(ctx), '只有經理或以上可以查看管理報告。');
  if (ctx.sub === 'digest') return ctx.edit({ embeds: [await require('./plus').digestEmbed()] });
  const now = Date.now(), wk = now - 7 * 864e5, all = async (c) => (await FB.db().collection(c).get()).docs.map((d) => ({ _id: d.id, ...d.data() }));
  const staff = (await all('staff')).filter((s) => s.active && GRADE[s.rank]);
  if (ctx.sub === 'inactive') {
    const idle = staff.filter((s) => (s.lastDutyAt || s.joinedAt || 0) < now - 14 * 864e5 && !(s.leaveUntil > now)).sort((a, b) => (a.lastDutyAt || 0) - (b.lastDutyAt || 0));
    return ctx.edit({ embeds: [{ color: C.pending, author: B.head('管理報告'), title: `超過 14 日沒有值勤（${idle.length} 人）`, description: idle.length ? D.trunc(idle.map((s) => `<@${s._id}>｜${ORG.title(s.rank, s.dept)}｜最後值勤：${s.lastDutyAt ? D.ymd(s.lastDutyAt) : '從未值勤'}`).join('\n'), 3900) : '所有在職同事在最近 14 日內都有值勤，或正在休假。', footer: { text: '請先由上司聯絡了解；再過七日仍無回覆，可按離職處理。休假中的同事不會列出。' } }], allowed_mentions: { parse: [] } });
  }
  const [stories, cases, reqs, duty, essays, tasks, apps] = await Promise.all(['stories', 'cases', 'requests', 'dutylog', 'essays', 'tasks', 'applications'].map(all));
  const mins = {}; for (const d of duty) if (d.end > wk) mins[d.uid] = (mins[d.uid] || 0) + d.mins;
  const top = Object.entries(mins).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const late = (list, ms) => list.filter((x) => x.at < now - ms).length, pend = (l, k = 'pending') => l.filter((x) => x.status === k);
  const f = (name, value) => ({ name, value, inline: true });
  return ctx.edit({ embeds: [{ color: C.ink, author: B.head('管理報告'), title: `每周概況（${D.ymd(wk)} 至 ${D.ymd(now)}）`, fields: [
    f('新聞', `本周發佈 ${stories.filter((s) => s.publishedAt > wk).length} 篇\n待審 ${pend(stories, 'review').length} 篇\n本周更正 ${stories.reduce((n, s) => n + (s.corrections || []).filter((c) => c.at > wk).length, 0)} 次`),
    f('客戶個案', `本周新開 ${cases.filter((c) => c.at > wk).length} 宗\n未結案 ${cases.filter((c) => c.status !== 'closed').length} 宗\n超過 24 小時未接手 ${late(pend(cases, 'open'), 864e5)} 宗`),
    f('內部申請', `待審批 ${pend(reqs).length} 項\n超過 48 小時 ${late(pend(reqs), 2 * 864e5)} 項`),
    f('人事', `在職 ${staff.length} 人\n本周入職 ${staff.filter((s) => s.joinedAt > wk).length} 人\n待處理應徵 ${pend(apps).length} 份`),
    f('培訓', `待評文章 ${pend(essays).length} 篇\n本周評分 ${essays.filter((e) => e.doneAt > wk).length} 篇`),
    f('任務', `未完成 ${tasks.filter((t) => t.status !== 'done').length} 項\n本周完成 ${tasks.filter((t) => t.doneAt > wk).length} 項`),
    { name: '本周值勤時數最高', value: top.length ? top.map(([u, m]) => `<@${u}>　${Math.floor(m / 60)} 小時 ${Math.round(m % 60)} 分`).join('\n') : '本周沒有值勤紀錄。' },
  ], footer: { text: '數字為即時計算。超時的項目請到相應的工作台處理。' } }], allowed_mentions: { parse: [] } });
}

/* ---------- 部門通訊錄 /directory ---------- */
async function directory(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以查看通訊錄。');
  const key = ctx.opt('dept'), d = DEPT[key];
  ctx.need(d, '未知的部門。');
  const list = (await FB.db().collection('staff').where('dept', '==', key).get()).docs.map((x) => ({ id: x.id, ...x.data() })).filter((s) => s.active && GRADE[s.rank]).sort((a, b) => GRADE[b.rank].g - GRADE[a.rank].g);
  const on = new Set((await FB.db().collection('duty').get()).docs.map((x) => x.id));
  return ctx.edit({ embeds: [{ color: C.hr, author: B.head('部門通訊錄'), title: `${d.zh}　${d.en}（${list.length} 人）`, description: `${d.does}。\n\n` + (list.length ? list.map((s) => `<@${s.id}>｜${ORG.title(s.rank, key)}${s.no ? '｜' + s.no : ''}${on.has(s.id) ? '｜值勤中' : s.leaveUntil > Date.now() ? '｜休假中' : ''}`).join('\n') : '這個部門暫時未有同事。'), footer: { text: '工作上的事情請先找該部門職級最低而又能處理的同事，處理不到才逐級上報。' } }], allowed_mentions: { parse: [] } });
}

/* ---------- 標準回覆 /canned ---------- */
const CANNED = {
  ack: ['確認收到', '多謝你聯絡近觀者。我是負責這宗個案的（職銜）（名稱）。我已收到你的資料，會在（時間）前回覆你。如有補充，可直接在這條討論串發送。'],
  understand: ['確認要求', '為確保我理解正確：你希望我們（對方的要求），對嗎？如有遺漏，請告訴我。'],
  nodelete: ['不刪除報道', '本公司不會刪除已發佈的報道。如果報道有事實錯誤，請指出是哪一處及正確的資料，我們會核對原始資料；確認有誤會公開更正，並列明修改之處。'],
  corrected: ['已更正', '多謝你的指正。我們核對了原始資料，報道（哪一處）確實有誤，正確的是（正確資料）。更正已刊登，並列明修改之處。對於錯誤，我們謹此致歉。'],
  nocorrect: ['核對後不更正', '我們已核對記者的紀錄及（來源）原文，報道內容與原文一致，因此不會作出更正。如果你有其他資料顯示報道有誤，歡迎在這裡提供，我們會再次核對。'],
  follow: ['如何追蹤新聞', '在本公司伺服器的「新聞發佈」頻道按「追蹤」，選擇你的伺服器及頻道，新聞便會自動送達。你無需加入機器人，亦無需給予任何權限。'],
  partner: ['合作及編採界線', '多謝你的合作意向。我們歡迎（合作形式）。有一點需要先說明：合作關係不影響報道。你可以向我們提供消息，我們會轉交新聞部，是否報道及如何報道由他們按新聞價值決定。'],
  close: ['結案前確認', '這宗個案的處理結果是：（結果）。如果沒有其他問題，我會在（時間）結案。日後如有需要，可在服務台重新提出，並引用本個案編號。'],
};
async function canned(ctx) {
  ctx.need(can.cases(ctx) || can.manage(ctx), '標準回覆只供處理個案的同事使用。');
  const k = CANNED[ctx.opt('topic')];
  ctx.need(k, '未知的類別。');
  return ctx.edit({ embeds: [{ color: C.client, author: B.head('標準回覆'), title: k[0], description: '```\n' + k[1] + '\n```', footer: { text: '複製後請把括號內的部分換成實際內容，再貼到個案討論串。' } }] });
}

module.exports = { kudos, suggestSubmit, appealSubmit, appealDecide, meetingSubmit, meetingButton, meeting, handoverSubmit, task, taskButton, taskDone, resolutionSubmit, resolutionButton, report, directory, canned, CANNED };
