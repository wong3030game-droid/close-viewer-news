'use strict';
// 客戶服務系統：服務台個案（查詢、投訴、更正要求、合作、授權）及客戶名冊。
// 每宗個案有編號（CS-0001）、一位負責人，以及一條只有對方及負責同事可見的私人討論串。結案時自動保存對話紀錄。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { CASE_TYPES, CASE_STATUS, CLIENT_KINDS, CLIENT_STATUS, DEPT, can } = ORG;
const { UserError } = require('./work');
const { row, btn, linkBtn } = D;
const C = B.COLOR;
const COLOR = { open: C.pending, active: C.client, closed: C.muted };
const threadUrl = (ctx, c) => (c.threadId ? `https://discord.com/channels/${ctx.guild}/${c.threadId}` : '');

function cardMsg(ctx, c) {
  const t = CASE_TYPES[c.type];
  const e = {
    color: COLOR[c.status], author: B.head('客戶服務'), title: `${c.id}｜${t.zh}｜${D.trunc(c.subject, 120)}`, description: D.trunc(c.detail, 1500),
    fields: [
      { name: '提出人', value: `<@${c.uid}>（${c.name}）${c.org ? '\n' + c.org : ''}`, inline: true },
      { name: '負責部門', value: DEPT[t.dept].zh, inline: true },
      { name: '狀態', value: CASE_STATUS[c.status] + (c.handlerId ? `｜<@${c.handlerId}>` : ''), inline: true },
    ],
    footer: { text: c.status === 'open' ? '請於 24 小時內接手並在討論串回覆；一般個案七日內結案。' : c.status === 'active' ? `由 ${c.handlerName} 跟進` : `已結案｜${c.closedBy}｜${D.hkText(c.closedAt)}` },
    timestamp: new Date(c.at).toISOString(),
  };
  if (c.ref) e.fields.push({ name: '有關報道或連結', value: D.trunc(c.ref, 300) });
  if (c.status === 'open') e.fields.push({ name: '首次回覆期限', value: `<t:${D.unix(c.at + 24 * 3600e3)}:R>` });
  if ((c.notes || []).length) e.fields.push({ name: '內部備註', value: D.trunc(c.notes.slice(-4).map((n) => `${D.ymd(n.at)} ${n.by}：${n.text}`).join('\n'), 1000) });
  if (c.resolution) e.fields.push({ name: '處理摘要', value: D.trunc(c.resolution, 1000) });
  const btns = [];
  if (c.status === 'open') btns.push(btn(`cs:claim:${c.id}`, '接手處理', 1, { emoji: ctx.emo('case') }));
  if (c.status !== 'closed') btns.push(btn(`cs:close:${c.id}`, '結案', 3, { emoji: ctx.emo('ok') }));
  if (threadUrl(ctx, c)) btns.push(linkBtn(threadUrl(ctx, c), '前往討論串'));
  return { embeds: [e], components: btns.length ? [row(...btns)] : [], allowed_mentions: { parse: [] } };
}
async function mustGet(x) {
  const id = FB.norm('CS', x), c = id && (await FB.getDoc('cases/' + id));
  if (!c) throw new UserError(`找不到個案 ${id || x}。`);
  return c;
}
async function refreshCard(ctx, c) {
  if (!c.msgId) return;
  try { await D.api('PATCH', `/channels/${c.channelId}/messages/${c.msgId}`, cardMsg(ctx, c)); } catch { /* 訊息可能已被刪除 */ }
}
const say = async (c, payload) => { if (c.threadId) { try { await D.api('POST', `/channels/${c.threadId}/messages`, { allowed_mentions: { parse: [] }, ...payload }); } catch (e) { console.log('thread post failed', e.message); } } };

/* ---------- 開立個案 ---------- */
async function submit(ctx) {
  const type = CASE_TYPES[ctx.cid[2]] ? ctx.cid[2] : 'enquiry', t = CASE_TYPES[type], f = ctx.fields;
  const queue = ctx.needChannel('cases', '個案處理'), desk = ctx.settings.channels.desk;
  const open = (await FB.db().collection('cases').where('uid', '==', ctx.uid).get()).docs.filter((d) => d.data().status !== 'closed');
  ctx.need(open.length < 3, '你已有三宗個案正在處理。請先在現有個案的討論串跟進。');
  const n = await FB.next('case'), id = 'CS-' + FB.pad(n), now = Date.now();
  const c = { id, n, type, uid: ctx.uid, name: ctx.name, subject: f.subject, detail: f.detail, ref: f.ref || '', org: f.org || '', status: 'open', at: now, notes: [], threadId: '' };
  // 私人討論串：只有提出人及負責同事可見
  if (desk) {
    try {
      const th = await D.api('POST', `/channels/${desk}/threads`, { name: D.trunc(`${id}｜${f.subject}`, 90), type: 12, invitable: false, auto_archive_duration: 10080 });
      await D.api('PUT', `/channels/${th.id}/thread-members/${ctx.uid}`);
      c.threadId = th.id;
      await say(c, { content: `<@${ctx.uid}>`, embeds: [{ color: C.client, author: B.head('客戶服務'), title: `${id}｜${t.zh}`, description: `**${f.subject}**\n\n${D.trunc(f.detail, 1800)}`, fields: [{ name: '之後的安排', value: `${DEPT[t.dept].zh}的同事會在 24 小時內接手並在這裡回覆你。\n如有補充資料或截圖，可直接在這條討論串發送。\n這條討論串只有你及負責的同事可以看到。` }], footer: { text: '請以個案編號查詢進度。' } }], allowed_mentions: { users: [ctx.uid] } });
    } catch (e) { console.log('thread create failed', e.message); }
  }
  const m = await D.api('POST', `/channels/${queue}/messages`, cardMsg(ctx, c));
  await FB.setDoc('cases/' + id, { ...c, msgId: m.id, channelId: queue });
  await ctx.log('client', `開立個案：${t.zh}`, id, D.trunc(f.subject, 100));
  return ctx.edit(`${ctx.em('case')}已開立個案 **${id}**（${t.zh}）。` + (c.threadId ? `請到 <#${c.threadId}> 跟進，負責的同事會在 24 小時內回覆。` : '負責的同事會在 24 小時內以私訊聯絡你，請保持私訊開啟。'));
}

/* ---------- 接手 ---------- */
async function button(ctx) {
  const [, b, id] = ctx.cid;
  if (b !== 'claim') throw new UserError('未支援的操作。');
  ctx.need(can.cases(ctx), '只有客戶及市務部、合規部的同事，新聞部及編輯部職員級或以上，或任何經理或以上可以處理個案。');
  const c = await mustGet(id);
  ctx.need(c.status === 'open', c.status === 'active' ? `這宗個案已由 ${c.handlerName} 接手。` : '這宗個案已經結案。');
  const patch = { status: 'active', handlerId: ctx.uid, handlerName: ctx.name, handlerTitle: ctx.title, claimedAt: Date.now() };
  await FB.setDoc('cases/' + id, patch);
  const nc = { ...c, ...patch };
  if (c.threadId) { try { await D.api('PUT', `/channels/${c.threadId}/thread-members/${ctx.uid}`); } catch { /* 已在討論串內 */ } }
  await say(nc, { embeds: [{ color: C.client, description: `本個案現由 **${ctx.name}**（${ctx.title}）跟進。` }] });
  await ctx.edit(cardMsg(ctx, nc));
  await ctx.log('client', '接手個案', id, D.trunc(c.subject, 100));
  return ctx.follow(`你已接手 ${id}。請先在討論串確認對方的要求；內部備註請用 \`/case note\`，處理完成後按「結案」填寫處理摘要。`);
}

/* ---------- 結案 ---------- */
async function transcript(c) {
  if (!c.threadId) return null;
  try {
    const msgs = await D.api('GET', `/channels/${c.threadId}/messages?limit=100`);
    const lines = [...msgs].reverse().map((m) => `[${D.hkText(Date.parse(m.timestamp) || Date.now())}] ${(m.author && (m.author.global_name || m.author.username)) || '系統'}：${m.content || ((m.embeds || [])[0] ? '［系統訊息］' + ((m.embeds[0].title || m.embeds[0].description || '').slice(0, 200)) : '')}${(m.attachments || []).length ? `［附件 ${m.attachments.length} 個］` : ''}`);
    const head = `${B.BRAND.zhFull}　個案對話紀錄\n個案：${c.id}　${CASE_TYPES[c.type].zh}\n主題：${c.subject}\n提出人：${c.name}\n開立：${D.hkText(c.at)}　結案：${D.hkText(c.closedAt)}　負責：${c.closedBy}\n處理摘要：${c.resolution}\n${'-'.repeat(40)}\n`;
    return { name: `${c.id}.txt`, data: Buffer.from(head + lines.join('\n'), 'utf8'), type: 'text/plain; charset=utf-8' };
  } catch (e) { console.log('transcript failed', e.message); return null; }
}
async function closeSubmit(ctx) {
  ctx.need(can.cases(ctx), '你沒有處理個案的權限。');
  const c = await mustGet(ctx.cid[2]);
  ctx.need(c.status !== 'closed', '這宗個案已經結案。');
  const patch = { status: 'closed', resolution: ctx.fields.note, closedBy: ctx.name, closedAt: Date.now() };
  if (!c.handlerId) Object.assign(patch, { handlerId: ctx.uid, handlerName: ctx.name, handlerTitle: ctx.title });
  await FB.setDoc('cases/' + c.id, patch);
  const nc = { ...c, ...patch };
  await say(nc, { embeds: [{ color: C.muted, author: B.head('客戶服務'), title: `${c.id} 已結案`, description: `**處理摘要**\n${patch.resolution}\n\n如問題仍未解決，可在服務台重新提出，並引用本個案編號。` }] });
  const file = await transcript(nc);
  if (c.threadId) { try { await D.api('PATCH', `/channels/${c.threadId}`, { archived: true, locked: true }); } catch { /* 已封存 */ } }
  await ctx.edit(cardMsg(ctx, nc));
  await D.dm(c.uid, { embeds: [{ color: C.muted, author: B.head('客戶服務'), title: `個案 ${c.id} 已結案`, description: `**${c.subject}**\n\n**處理摘要**\n${patch.resolution}\n\n負責同事：${ctx.name}（${ctx.title}）` }] });
  await ctx.log('client', '結案', c.id, `${D.trunc(c.subject, 80)}｜${D.trunc(patch.resolution, 300)}`);
  const lc = ctx.settings.channels.log_client;
  if (file && lc) { try { await D.api('POST', `/channels/${lc}/messages`, { content: `${c.id} 對話紀錄` }, [file]); } catch (e) { console.log('transcript upload failed', e.message); } }
  return null;
}

/* ---------- /case ---------- */
async function command(ctx) {
  ctx.need(can.cases(ctx), '只有客戶及市務部、合規部的同事，新聞部及編輯部職員級或以上，或任何經理或以上可以使用個案系統。');
  if (ctx.sub === 'list') {
    const all = (await FB.db().collection('cases').get()).docs.map((d) => d.data()).filter((c) => c.status !== 'closed').sort((a, b) => a.n - b.n).slice(0, 20);
    return ctx.edit({ embeds: [{ color: C.client, author: B.head('客戶服務'), title: `未結案個案（${all.length}）`, description: all.length ? all.map((c) => `\`${c.id}\` ${CASE_TYPES[c.type].zh}｜${CASE_STATUS[c.status]}${c.handlerName ? '｜' + c.handlerName : ''}｜${D.trunc(c.subject, 40)}｜<t:${D.unix(c.at)}:R>`).join('\n') : '沒有未結案的個案。' }] });
  }
  const c = await mustGet(ctx.opt('id'));
  if (ctx.sub === 'view') return ctx.edit({ ...cardMsg(ctx, c), components: threadUrl(ctx, c) ? [row(linkBtn(threadUrl(ctx, c), '前往討論串'))] : [] });
  ctx.need(c.status !== 'closed', '這宗個案已經結案。');
  if (ctx.sub === 'note') {
    const notes = [...(c.notes || []), { at: Date.now(), by: ctx.name, text: ctx.opt('text') }];
    await FB.setDoc('cases/' + c.id, { notes });
    await refreshCard(ctx, { ...c, notes });
    return ctx.edit(`已為 ${c.id} 加入內部備註。對方不會看到。`);
  }
  if (ctx.sub === 'assign') {
    const t = require('./hr').target(ctx);
    ctx.need(can.cases(t), `${t.name} 沒有處理個案的權限。`);
    const patch = { status: 'active', handlerId: t.id, handlerName: t.name, handlerTitle: ORG.title(t.rank, t.dept) };
    await FB.setDoc('cases/' + c.id, patch);
    const nc = { ...c, ...patch };
    if (c.threadId) { try { await D.api('PUT', `/channels/${c.threadId}/thread-members/${t.id}`); } catch { /* 略過 */ } }
    await say(nc, { embeds: [{ color: C.client, description: `本個案現轉由 **${t.name}**（${patch.handlerTitle}）跟進。` }] });
    await refreshCard(ctx, nc);
    await ctx.log('client', '轉交個案', c.id, `${c.handlerName || '未接手'} → ${t.name}`);
    return ctx.edit(`已把 ${c.id} 轉交 ${t.name}。`);
  }
  throw new UserError('未支援的指令。');
}

/* ---------- 客戶名冊 /client ---------- */
function clientMsg(k) {
  return { embeds: [{
    color: k.status === 'active' ? C.ok : k.status === 'lead' ? C.pending : C.muted, author: B.head('客戶名冊'), title: `${k.id}｜${k.name}`,
    fields: [
      { name: '類別', value: CLIENT_KINDS[k.kind] || '其他', inline: true }, { name: '狀態', value: CLIENT_STATUS[k.status], inline: true }, { name: '已追蹤新聞頻道', value: k.follows ? '是' : '否', inline: true },
      { name: '聯絡人', value: k.contact || '—', inline: true }, { name: '客戶主任', value: `<@${k.managerId}>`, inline: true }, { name: '登記日期', value: D.ymd(k.at), inline: true },
      { name: '聯絡紀錄', value: (k.notes || []).length ? D.trunc(k.notes.slice(-6).map((n) => `${D.ymd(n.at)} ${n.by}：${n.text}`).join('\n'), 1000) : '尚未有紀錄。' },
    ],
    footer: { text: k.lastAt ? `最近聯絡：${D.ymd(k.lastAt)}` : '客戶資料屬內部資料，不得向外透露。' },
  }], allowed_mentions: { parse: [] } };
}
async function client(ctx) {
  ctx.need(can.clients(ctx), '只有客戶及市務部職員級或以上，或任何經理或以上可以使用客戶名冊。');
  if (ctx.sub === 'list') {
    const all = (await FB.db().collection('clients').get()).docs.map((d) => d.data()).sort((a, b) => a.n - b.n);
    const stale = Date.now() - 30 * 864e5;
    return ctx.edit({ embeds: [{ color: C.client, author: B.head('客戶名冊'), title: `客戶名冊（${all.length}）`, description: all.length ? D.trunc(all.map((k) => `\`${k.id}\` ${k.name}｜${CLIENT_KINDS[k.kind]}｜${CLIENT_STATUS[k.status]}${k.follows ? '｜已追蹤' : ''}${k.status === 'active' && (k.lastAt || k.at) < stale ? '｜**超過 30 日未聯絡**' : ''}`).join('\n'), 4000) : '名冊尚未有客戶。使用 `/client add` 登記。' }] });
  }
  if (ctx.sub === 'add') {
    const n = await FB.next('client'), id = 'CL-' + FB.pad(n), now = Date.now();
    const k = { id, n, name: ctx.opt('name'), kind: CLIENT_KINDS[ctx.opt('kind')] ? ctx.opt('kind') : 'other', contact: ctx.opt('contact') || '', follows: !!ctx.opt('follows'), status: 'lead', managerId: ctx.uid, managerName: ctx.name, at: now, notes: [] };
    const ch = ctx.settings.channels.clients;
    if (ch) { try { const m = await D.api('POST', `/channels/${ch}/messages`, clientMsg(k)); k.msgId = m.id; k.channelId = ch; } catch (e) { console.log('client card failed', e.message); } }
    await FB.setDoc('clients/' + id, k);
    await ctx.log('client', '登記客戶', id, `${k.name}｜${CLIENT_KINDS[k.kind]}`);
    return ctx.edit(`已登記客戶 **${id}** ${k.name}，由你擔任客戶主任。每次聯絡後請用 \`/client note id:${id}\` 記錄。`);
  }
  const id = FB.norm('CL', ctx.opt('id')), k = id && (await FB.getDoc('clients/' + id));
  ctx.need(k, `找不到客戶 ${id || ctx.opt('id')}。`);
  if (ctx.sub === 'view') return ctx.edit(clientMsg(k));
  const patch = {};
  if (ctx.sub === 'note') { patch.notes = [...(k.notes || []), { at: Date.now(), by: ctx.name, text: ctx.opt('text') }]; patch.lastAt = Date.now(); }
  else if (ctx.sub === 'update') {
    if (CLIENT_STATUS[ctx.opt('status')]) patch.status = ctx.opt('status');
    if (ctx.opt('follows') !== undefined) patch.follows = !!ctx.opt('follows');
    if (ctx.opt('contact')) patch.contact = ctx.opt('contact');
    if (ctx.opt('manager')) { const t = require('./hr').target(ctx, 'manager'); ctx.need(t.g > 0, `${t.name} 不是本公司員工。`); patch.managerId = t.id; patch.managerName = t.name; }
    ctx.need(Object.keys(patch).length, '請最少填寫一項要更新的資料。');
  } else throw new UserError('未支援的指令。');
  await FB.setDoc('clients/' + id, patch);
  const nk = { ...k, ...patch };
  if (k.msgId) { try { await D.api('PATCH', `/channels/${k.channelId}/messages/${k.msgId}`, clientMsg(nk)); } catch { /* 訊息可能已被刪除 */ } }
  await ctx.log('client', ctx.sub === 'note' ? '客戶聯絡紀錄' : '更新客戶資料', id, ctx.sub === 'note' ? D.trunc(ctx.opt('text'), 200) : Object.keys(patch).join('、'));
  return ctx.edit({ content: `已更新 ${id}。`, ...clientMsg(nk) });
}

module.exports = { submit, button, closeSubmit, command, client };
