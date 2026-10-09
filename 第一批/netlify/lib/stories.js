'use strict';
// 編採系統：稿件由草稿到發佈的全部流程。
// 撰稿 → 提交審稿 → 批准／退回／不採用 → 發佈（自動轉發到追蹤的伺服器）→ 更正／撤回。另有報料箱。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const { CAT, TYPES, STATUS, can } = require('./org');
const { UserError } = require('./work');
const { row, btn, linkBtn } = D;
const C = B.COLOR;

const storyUrl = (s) => (D.site() ? `${D.site()}/#/story/${s.id}` : undefined);
const tag = (s) => `${CAT[s.cat] || '本地'}｜${TYPES[s.type] || '新聞'}`;

/* ---------- 圖片：Discord 附件連結會過期，每次使用前向 Discord 取回最新連結 ---------- */
async function freshImage(s) {
  if (!s.img || !s.img.msgId) return s.img ? s.img.url : '';
  try {
    const m = await D.api('GET', `/channels/${s.img.channelId}/messages/${s.img.msgId}`);
    const url = (m.attachments && m.attachments[0] && m.attachments[0].url) || (m.embeds && m.embeds[0] && m.embeds[0].image && m.embeds[0].image.url) || '';
    return url || s.img.url;
  } catch { return s.img.url; }
}

/* ---------- 訊息樣式 ---------- */
/** 內部查看的稿件（草稿預覽、審稿台）。標題、內文、導語、來源的位置與「改稿」表單預填對應，請勿更改欄位名稱。 */
function deskEmbed(s, head, imgUrl) {
  const e = {
    color: s.status === 'review' ? C.pending : s.status === 'published' ? C.ok : s.status === 'draft' ? C.muted : C.alert,
    author: B.head(`${head}｜${s.id}｜${tag(s)}`),
    title: s.title, description: s.body,
    fields: [
      { name: '導語', value: s.lede || '—' },
      { name: '消息來源（不公開）', value: s.source || '—' },
      { name: '撰稿', value: `<@${s.authorId}>`, inline: true },
      { name: '狀態', value: STATUS[s.status] || s.status, inline: true },
    ],
    footer: { text: `更新於 ${D.hkText(s.updatedAt || s.createdAt)}（香港時間）` },
  };
  if (s.returnNote && s.status === 'draft') e.fields.push({ name: '編輯退回意見', value: D.trunc(s.returnNote, 1000) });
  if (imgUrl) e.image = { url: imgUrl };
  return e;
}
function draftMsg(ctx, s, note, imgUrl) {
  const mine = s.status === 'draft';
  return {
    content: note || '', embeds: [deskEmbed(s, STATUS[s.status] || '稿件', imgUrl)],
    components: mine ? [row(btn(`st:edit:${s.id}`, '改稿', 2, { emoji: ctx.emo('edit') }), btn(`st:submit:${s.id}`, '提交審稿', 1, { emoji: ctx.emo('publish') }), btn(`st:del:${s.id}`, '刪除草稿', 4))] : [],
  };
}
const CHECKLIST = '**審稿清單**　1. 每項事實都有來源　2. 姓名、職銜、數字、日期已核對　3. 被指控的一方有回應機會　4. 未有定論的指控使用「涉嫌」「被指」　5. 事實與觀點分開，評論已標明';
function reviewMsg(ctx, s, imgUrl, done) {
  return {
    content: done || CHECKLIST, embeds: [deskEmbed(s, done ? STATUS[s.status] : '待審稿件', imgUrl)], allowed_mentions: { parse: [] },
    components: done ? [] : [row(btn(`rv:ok:${s.id}`, '批准發佈', 3, { emoji: ctx.emo('ok') }), btn(`rv:edit:${s.id}`, '改稿', 2, { emoji: ctx.emo('edit') }), btn(`rv:return:${s.id}`, '退回修改', 1), btn(`rv:reject:${s.id}`, '不採用', 4))],
  };
}
/** 對外發佈的樣式 */
function pubEmbed(s, imgRef) {
  const pre = s.type === 'flash' ? '【突發】' : s.type === 'opinion' ? '【評論】' : s.type === 'feature' ? '【專題】' : '';
  if (s.status === 'retracted') {
    return { color: C.alert, author: B.head(CAT[s.cat] || '本地'), title: D.trunc(`【已撤回】${s.title}`, 250), description: `本公司已撤回這篇報道。\n\n**原因：**${s.retractReason || '—'}`, footer: { text: `${s.id}｜撤回於 ${D.hkText(s.retractedAt || Date.now())}` } };
  }
  const e = {
    color: C[s.type] || C.news,
    author: B.head(CAT[s.cat] || '本地'),
    title: D.trunc(pre + s.title, 250), url: storyUrl(s),
    description: (s.lede ? `**${s.lede}**\n\n` : '') + s.body,
    fields: (s.corrections || []).slice(-3).map((c) => ({ name: `${c.kind === 'clarify' ? '澄清' : '更正'}（${D.ymd(c.at)}）`, value: D.trunc(c.text, 400) })),
    footer: { text: `${s.type === 'opinion' ? '作者' : '撰稿'}：${s.authorName}｜審批：${s.editorName || '—'}｜${s.id}${s.type === 'opinion' ? '｜評論屬作者觀點，不代表本公司立場' : ''}` },
    timestamp: new Date(s.publishedAt || Date.now()).toISOString(),
  };
  if (imgRef) e.image = { url: imgRef };
  return e;
}

/* ---------- 發佈 ---------- */
async function publish(ctx, s) {
  const ch = ctx.needChannel('news', '新聞發佈');
  s = { ...s, status: 'published', publishedAt: Date.now(), editorId: ctx.uid, editorName: ctx.name };
  // 有圖片：下載後連同新聞一併上載，追蹤的伺服器亦會看到，連結亦由新聞訊息保管
  let files = null, ref = '';
  if (s.img) {
    try {
      const url = await freshImage(s);
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const name = (s.img.name || 'photo.png').replace(/[^\w.-]/g, '_');
      files = [{ name, data: Buffer.from(await r.arrayBuffer()), type: s.img.type || 'image/png' }];
      ref = 'attachment://' + name;
    } catch (e) { console.log('image fetch failed', e.message); }
  }
  const m = await D.api('POST', `/channels/${ch}/messages`, { embeds: [pubEmbed(s, ref)], allowed_mentions: { parse: [] } }, files);
  let relay = '已轉發到所有追蹤新聞頻道的伺服器。';
  try { await D.api('POST', `/channels/${ch}/messages/${m.id}/crosspost`); } catch (e) {
    relay = '注意：未能轉發到追蹤的伺服器。新聞頻道必須是「公告頻道」（伺服器設定 → 啟用社群 → 把頻道類型改為公告）。新聞已在本伺服器發佈。';
    console.log('crosspost failed', e.message);
  }
  const patch = { status: 'published', publishedAt: s.publishedAt, editorId: s.editorId, editorName: s.editorName, channelId: ch, msgId: m.id, updatedAt: Date.now() };
  if (files && m.attachments && m.attachments[0]) patch.img = { channelId: ch, msgId: m.id, name: files[0].name, type: files[0].type, url: m.attachments[0].url };
  await FB.saveStory(s.id, patch);
  const st = (await FB.getStaff(s.authorId)) || {};
  await FB.saveStaff(s.authorId, { name: s.authorName, published: (st.published || 0) + 1, lastPublishedAt: s.publishedAt });
  await ctx.log('editorial', '發佈', s.id, `《${s.title}》撰稿 ${s.authorName}${s.authorId === ctx.uid ? '（自行審批）' : ''}`);
  return { s: { ...s, ...patch }, relay, link: `https://discord.com/channels/${ctx.guild}/${ch}/${m.id}` };
}
/** 已發佈的稿件有改動（更正、撤回）時，修改新聞頻道的原訊息；追蹤的伺服器會自動同步 */
async function refreshPublished(s) {
  if (!s.channelId || !s.msgId) return;
  const ref = s.status !== 'retracted' && s.img && s.img.name ? 'attachment://' + s.img.name : '';
  const body = { embeds: [pubEmbed(s, ref)] };
  if (s.status === 'retracted') body.attachments = [];
  await D.api('PATCH', `/channels/${s.channelId}/messages/${s.msgId}`, body);
}
/** 更正及撤回一律刊登在「更正及澄清」頻道，作為公開紀錄 */
async function recordNotice(ctx, s, kind, text) {
  const ch = ctx.settings.channels.corrections;
  if (!ch) return '';
  const label = { correct: '更正', clarify: '澄清', retract: '撤回' }[kind];
  try {
    const m = await D.api('POST', `/channels/${ch}/messages`, { embeds: [{ color: kind === 'retract' ? C.alert : C.pending, author: B.head(`${label}啟事`), title: D.trunc(`${label}：${s.title}`, 250), url: storyUrl(s), description: text, footer: { text: `${s.id}｜${kind === 'retract' ? '報道已撤回' : '原文已同步更新'}` }, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });
    try { await D.api('POST', `/channels/${ch}/messages/${m.id}/crosspost`); } catch { /* 非公告頻道時略過 */ }
    return `並已刊登於 <#${ch}>。`;
  } catch (e) { console.log('correction notice failed', e.message); return ''; }
}

async function mustGet(x) {
  const s = await FB.getStory(x);
  if (!s) throw new UserError(`找不到稿件 ${FB.normId(x) || x}。可使用 /story list 查看你的稿件編號。`);
  return s;
}
function check(ctx, f) {
  ctx.need(f.title && f.title.length >= 4, '標題太短。');
  ctx.need(f.body && f.body.length >= 10, '內文太短。');
  ctx.need(f.source, '必須填寫消息來源。本公司不發佈沒有來源的稿件。');
}

/* ---------- 指令 ---------- */
async function command(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以使用這個指令。有意加入可到「職位空缺」頻道應徵。');
  if (ctx.sub === 'list') return list(ctx);
  const s = await mustGet(ctx.opt('id'));
  if (ctx.sub === 'view') {
    const own = s.authorId === ctx.uid;
    ctx.need(own || can.review(ctx) || s.status === 'published', '未發佈的稿件只有作者及審稿人員可以查看。');
    const img = s.img ? await freshImage(s) : '';
    return ctx.edit(own ? draftMsg(ctx, s, '', img) : { embeds: [deskEmbed(s, STATUS[s.status], img)], components: [] });
  }
  if (ctx.sub === 'image') {
    ctx.need(s.authorId === ctx.uid || can.review(ctx), '只有作者或審稿人員可以為稿件加入圖片。');
    ctx.need(['draft', 'review'].includes(s.status), '已發佈或已結束的稿件不可以再更換圖片。');
    const att = (ctx.resolved.attachments || {})[ctx.opt('file')];
    ctx.need(att, '未能接收檔案，請再試一次。');
    ctx.need(/^image\//.test(att.content_type || ''), '只接受圖片（PNG、JPG、WEBP、GIF）。');
    ctx.need(att.size <= 8 * 1024 * 1024, '圖片必須在 8MB 以內。');
    const assets = ctx.needChannel('assets', '素材庫');
    const r = await fetch(att.url);
    ctx.need(r.ok, '下載圖片失敗，請重新上載。');
    const name = (att.filename || 'photo.png').replace(/[^\w.-]/g, '_');
    const m = await D.api('POST', `/channels/${assets}/messages`, { content: `${s.id}《${D.trunc(s.title, 80)}》圖片，由 ${ctx.name} 上載`, allowed_mentions: { parse: [] } }, [{ name, data: Buffer.from(await r.arrayBuffer()), type: att.content_type }]);
    const img = { channelId: assets, msgId: m.id, name, type: att.content_type, url: m.attachments[0].url };
    await FB.saveStory(s.id, { img, updatedAt: Date.now() });
    if (s.status === 'review' && s.reviewMsgId) { try { await D.api('PATCH', `/channels/${ctx.settings.channels.review}/messages/${s.reviewMsgId}`, reviewMsg(ctx, { ...s, img }, img.url)); } catch { /* 審稿訊息可能已被刪除 */ } }
    return ctx.edit(draftMsg(ctx, { ...s, img }, `已為 ${s.id} 加入圖片。`, img.url));
  }
  if (ctx.sub === 'submit') return submit(ctx, s);
  throw new UserError('未支援的指令。');
}

async function list(ctx) {
  const mine = (await FB.db().collection('stories').where('authorId', '==', ctx.uid).get()).docs.map((d) => d.data()).sort((a, b) => b.n - a.n).slice(0, 15);
  const line = (s) => `\`${s.id}\` ${STATUS[s.status]}｜${D.trunc(s.title, 50)}`;
  const embeds = [{ color: C.brand, author: B.head('編採系統'), title: '我的稿件', description: mine.length ? mine.map(line).join('\n') : '你尚未有稿件。使用 `/story new` 撰寫第一篇。' }];
  if (can.review(ctx)) {
    const q = (await FB.db().collection('stories').where('status', '==', 'review').get()).docs.map((d) => d.data()).sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0)).slice(0, 15);
    const rc = ctx.settings.channels.review;
    embeds.push({ color: C.pending, title: `待審稿件（${q.length}）`, description: q.length ? q.map((s) => `\`${s.id}\` ${D.trunc(s.title, 40)}｜${s.authorName}｜<t:${D.unix(s.submittedAt || s.createdAt)}:R>${rc && s.reviewMsgId ? `｜[前往審稿](https://discord.com/channels/${ctx.guild}/${rc}/${s.reviewMsgId})` : ''}`).join('\n') : '審稿台沒有待審稿件。' });
  }
  return ctx.edit({ embeds });
}

async function submit(ctx, s) {
  ctx.need(s.authorId === ctx.uid, '只有作者可以提交自己的稿件。');
  ctx.need(s.status === 'draft', `這篇稿件現時的狀態是「${STATUS[s.status]}」，不可以再提交。`);
  if (ctx.rank === 'trainee') {
    const st = ctx.staff || {};
    ctx.need(st.courses && st.courses.P201, '見習同事須先在 `/academy` 修畢 P201《新聞寫作基礎》才可以提交稿件。草稿已經保存，考核合格後回來按「提交審稿」即可。');
  }
  const rc = ctx.needChannel('review', '審稿台');
  const img = s.img ? await freshImage(s) : '';
  const ns = { ...s, status: 'review', submittedAt: Date.now(), updatedAt: Date.now(), returnNote: '' };
  const m = await D.api('POST', `/channels/${rc}/messages`, reviewMsg(ctx, ns, img));
  await FB.saveStory(s.id, { status: 'review', submittedAt: ns.submittedAt, updatedAt: ns.updatedAt, returnNote: '', reviewMsgId: m.id });
  await ctx.log('editorial', '提交審稿', s.id, `《${s.title}》`);
  return ctx.edit(draftMsg(ctx, ns, `已提交 ${s.id}。編輯處理後你會收到私訊通知。`, img));
}

/* ---------- 表單 ---------- */
async function modal(ctx) {
  const [, kind, a, b] = ctx.cid, f = ctx.fields, now = Date.now();
  if (kind === 'new') {
    ctx.need(can.staff(ctx), '只有本公司員工可以撰稿。有意加入可到「職位空缺」頻道應徵。');
    check(ctx, f);
    const { n, id } = await FB.nextStoryId();
    const s = { id, n, title: f.title, lede: f.lede || '', body: f.body, source: f.source, cat: a, type: b, status: 'draft', authorId: ctx.uid, authorName: ctx.name, createdAt: now, updatedAt: now, corrections: [] };
    await FB.saveStory(id, s);
    return ctx.edit(draftMsg(ctx, s, `草稿已保存，編號 **${id}**。加入圖片請用 \`/story image id:${id}\`；日後想再查看請用 \`/story view id:${id}\`。`));
  }
  if (kind === 'brk') {
    ctx.need(can.review(ctx), '突發消息只限審稿人員即時發佈。其他同事請使用 /story new 撰稿並提交審批。');
    check(ctx, f);
    const { n, id } = await FB.nextStoryId();
    const s = { id, n, title: f.title, lede: '', body: f.body, source: f.source, cat: a, type: 'flash', status: 'review', authorId: ctx.uid, authorName: ctx.name, createdAt: now, updatedAt: now, corrections: [] };
    await FB.saveStory(id, s);
    const r = await publish(ctx, s);
    return ctx.edit({ content: `突發消息 ${id} 已發佈。${r.relay}`, components: [row(linkBtn(r.link, '查看新聞'))] });
  }
  const s = await mustGet(a);
  if (kind === 'edit') {
    const own = s.authorId === ctx.uid;
    ctx.need((own && s.status === 'draft') || (can.review(ctx) && ['draft', 'review'].includes(s.status)), s.status === 'review' && own ? '稿件已提交審批，現由編輯處理。如需修改，請要求編輯退回。' : '你不可以修改這篇稿件。');
    check(ctx, f);
    const patch = { title: f.title, lede: f.lede || '', body: f.body, source: f.source, updatedAt: now };
    if (!own) patch.editedBy = ctx.name;
    await FB.saveStory(s.id, patch);
    const ns = { ...s, ...patch }, img = s.img ? await freshImage(s) : '';
    if (s.status === 'review') { await ctx.log('editorial', '編輯改稿', s.id, `《${ns.title}》`); return ctx.edit(reviewMsg(ctx, ns, img)); }
    return ctx.edit(draftMsg(ctx, ns, `已更新 ${s.id}。`, img));
  }
  if (kind === 'return' || kind === 'reject') {
    ctx.need(can.review(ctx), '只有審稿人員可以審稿。');
    ctx.need(s.status === 'review', `這篇稿件現時的狀態是「${STATUS[s.status]}」，已有其他同事處理。`);
    const ret = kind === 'return';
    const patch = ret ? { status: 'draft', returnNote: f.note, updatedAt: now, reviewMsgId: '', returns: (s.returns || 0) + 1 } : { status: 'rejected', rejectNote: f.note, updatedAt: now, editorId: ctx.uid, editorName: ctx.name };
    await FB.saveStory(s.id, patch);
    const ns = { ...s, ...patch };
    await ctx.edit(reviewMsg(ctx, ns, '', `**${ret ? '已退回修改' : '不採用'}**｜${ctx.name}｜${D.trunc(f.note, 300)}`));
    await D.dm(s.authorId, { embeds: [{ color: ret ? C.pending : C.alert, author: B.head('編輯部'), title: ret ? `稿件 ${s.id} 退回修改` : `稿件 ${s.id} 不採用`, description: `《${s.title}》\n\n**編輯意見：**${f.note}` + (ret ? `\n\n修改後請在伺服器使用 \`/story view id:${s.id}\`，按「改稿」，再按「提交審稿」。` : ''), footer: { text: `審批：${ctx.name}` } }] });
    await ctx.log('editorial', ret ? '退回修改' : '不採用', s.id, f.note);
    return null;
  }
  throw new UserError('未支援的表單。');
}

/* ---------- 按鈕 ---------- */
async function button(ctx) {
  const [a, b, id] = ctx.cid;
  const s = await mustGet(id);
  if (a === 'st' && b === 'submit') return submit(ctx, s);
  if (a === 'st' && b === 'del') {
    ctx.need(s.authorId === ctx.uid && s.status === 'draft', '只可以刪除自己的草稿。');
    await FB.db().doc('stories/' + s.id).delete();
    return ctx.edit({ content: `已刪除草稿 ${s.id}。`, embeds: [], components: [] });
  }
  if (a === 'rv' && b === 'ok') {
    ctx.need(can.review(ctx), '只有審稿人員可以審稿。');
    ctx.need(s.status === 'review', `這篇稿件現時的狀態是「${STATUS[s.status]}」，已有其他同事處理。`);
    ctx.need(s.authorId !== ctx.uid || can.selfApprove(ctx), '不可以審批自己的稿件，請交由另一位審稿人員處理。（編輯總監及董事會例外，並會記錄在案。）');
    const r = await publish(ctx, s);
    await ctx.edit(reviewMsg(ctx, r.s, '', `**已批准發佈**｜審批：${ctx.name}`));
    await ctx.follow({ content: `${s.id} 已發佈。${r.relay}`, components: [row(linkBtn(r.link, '查看新聞'))] });
    if (s.authorId !== ctx.uid) await D.dm(s.authorId, { embeds: [{ color: C.ok, author: B.head('編輯部'), title: `稿件 ${s.id} 已發佈`, description: `《${s.title}》\n審批：${ctx.name}\n\n[查看新聞](${r.link})` }] });
    return null;
  }
  throw new UserError('未支援的操作。');
}

/* ---------- 更正、澄清、撤回 ---------- */
async function correct(ctx) {
  ctx.need(can.review(ctx), '只有審稿人員可以發出更正。發現自己的稿件有錯，請立即通知編輯。');
  const s = await mustGet(ctx.opt('id'));
  ctx.need(s.status === 'published', '只可以更正已發佈的稿件。');
  const kind = ctx.opt('kind') === 'clarify' ? 'clarify' : 'correct';
  const c = { at: Date.now(), text: ctx.opt('text'), by: ctx.name, kind };
  const ns = { ...s, corrections: [...(s.corrections || []), c] };
  await FB.saveStory(s.id, { corrections: ns.corrections, updatedAt: c.at });
  await refreshPublished(ns);
  const extra = await recordNotice(ctx, s, kind, c.text);
  await ctx.log('editorial', kind === 'clarify' ? '澄清' : '更正', s.id, c.text);
  return ctx.edit(`已為 ${s.id} 加上${kind === 'clarify' ? '澄清' : '更正'}，原訊息及網站的更正紀錄已更新，${extra || '（尚未設定「更正及澄清」頻道，未有另行刊登。）'}`);
}
async function retract(ctx) {
  ctx.need(can.retract(ctx), '只有編輯總監或董事會可以撤回報道。');
  const s = await mustGet(ctx.opt('id'));
  ctx.need(s.status === 'published', '只可以撤回已發佈的稿件。');
  const ns = { ...s, status: 'retracted', retractReason: ctx.opt('reason'), retractedAt: Date.now() };
  await FB.saveStory(s.id, { status: 'retracted', retractReason: ns.retractReason, retractedAt: ns.retractedAt, updatedAt: ns.retractedAt });
  await refreshPublished(ns);
  await recordNotice(ctx, s, 'retract', `本公司已撤回這篇報道。\n\n**原因：**${ns.retractReason}`);
  await ctx.log('editorial', '撤回報道', s.id, ns.retractReason);
  return ctx.edit(`已撤回 ${s.id}。新聞頻道及網站會顯示撤回聲明及原因，報道不會被刪除。`);
}

/* ---------- 報料 ---------- */
async function tipSubmit(ctx) {
  const ch = ctx.needChannel('tips', '報料箱'), f = ctx.fields, anon = ctx.cid[2] === '1';
  const ref = await FB.db().collection('tips').add({ at: Date.now(), uid: anon ? '' : ctx.uid, name: anon ? '' : ctx.name, anon, ...f, status: 'open' });
  await D.api('POST', `/channels/${ch}/messages`, { embeds: [{ color: C.tip, author: B.head('報料箱'), title: '新報料', description: f.what, fields: [{ name: '時間及地點', value: f.when || '—' }, { name: '證據', value: f.proof || '—' }, { name: '報料人', value: anon ? '匿名' : `<@${ctx.uid}>` }], timestamp: new Date().toISOString() }], components: [row(btn(`tp:claim:${ref.id}`, '跟進', 1, { emoji: ctx.emo('review') }))], allowed_mentions: { parse: [] } });
  return ctx.edit('多謝報料，新聞部已經收到。' + (anon ? '這是匿名報料：我們不會知道你的身份，因此亦無法聯絡你跟進。' : '如有需要，負責的同事會以私訊聯絡你。'));
}
async function tipClaim(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以跟進報料。');
  const ref = FB.db().doc('tips/' + ctx.cid[2]), snap = await ref.get();
  ctx.need(snap.exists, '找不到這宗報料。');
  ctx.need(snap.data().status === 'open', `這宗報料已由 ${snap.data().claimedName || '其他同事'} 跟進。`);
  await ref.update({ status: 'claimed', claimedBy: ctx.uid, claimedName: ctx.name, claimedAt: Date.now() });
  const e = { ...((ctx.i.message && ctx.i.message.embeds && ctx.i.message.embeds[0]) || {}) };
  e.fields = [...(e.fields || []), { name: '跟進同事', value: `<@${ctx.uid}>（${ctx.title}）` }];
  e.color = C.ok;
  await ctx.edit({ embeds: [e], components: [] });
  await ctx.log('editorial', '認領報料', '', D.trunc(snap.data().what || '', 120));
  return ctx.follow('這宗報料由你跟進。請先查證再撰稿：使用 `/story new` 開稿，並在消息來源一欄寫明「讀者報料」及你的查證方法。');
}

module.exports = { command, modal, button, correct, retract, tipSubmit, tipClaim, publish, pubEmbed, freshImage, storyUrl };
