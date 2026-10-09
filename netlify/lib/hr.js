'use strict';
// 人事系統：應徵、取錄、員工檔案、員工證、晉升、調職、紀律、離職。正式通知會附上公司函件（PNG 及 PDF）。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { GRADES, GRADE, DEPTS, DEPT, TIER, WARN_LEVELS, can } = ORG;
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const HR_UNIT = '人力資源及行政部';

/** 加入或收回身份組。權限不足時給予清楚的提示。 */
async function roleOp(ctx, method, uid, roleId, reason) {
  try { await D.api(method, `/guilds/${ctx.guild}/members/${uid}/roles/${roleId}`, null, null, { reason }); } catch (e) {
    if (e.status === 403) throw new UserError('系統沒有權限更改這個身份組。請到 伺服器設定 → 身份組，把機器人的身份組拖到所有公司身份組之上，並確認它擁有「管理身份組」權限。');
    throw e;
  }
}
async function setRank(ctx, uid, roles, key, reason) {
  const S = ctx.settings, target = S.roles[key];
  if (!target) throw new UserError(`尚未設定「${GRADE[key].name}」身份組。請管理員使用 /setup auto。`);
  for (const r of GRADES) { const id = S.roles[r.key]; if (id && id !== target && roles.includes(id)) await roleOp(ctx, 'DELETE', uid, id, reason); }
  if (!roles.includes(target)) await roleOp(ctx, 'PUT', uid, target, reason);
  if (S.staffRole && !roles.includes(S.staffRole)) await roleOp(ctx, 'PUT', uid, S.staffRole, reason);
}
async function setDept(ctx, uid, roles, key, reason) {
  const S = ctx.settings, target = S.depts[key];
  if (!target) throw new UserError(`尚未設定「${DEPT[key].zh}」身份組。請管理員使用 /setup auto。`);
  for (const d of DEPTS) { const id = S.depts[d.key]; if (id && id !== target && roles.includes(id)) await roleOp(ctx, 'DELETE', uid, id, reason); }
  if (!roles.includes(target)) await roleOp(ctx, 'PUT', uid, target, reason);
}

/** 由指令的 user 選項取得對象：id、名稱、身份組、現時職級 */
function target(ctx, name = 'user') {
  const id = ctx.opt(name);
  const m = (ctx.resolved.members || {})[id], u = (ctx.resolved.users || {})[id] || {};
  if (!id || !m) throw new UserError('找不到這位成員（對方可能已離開伺服器）。');
  if (u.bot) throw new UserError('不可以對機器人使用這個指令。');
  const roles = m.roles || [];
  return { id, name: m.nick || u.global_name || u.username || '成員', roles, avatar: u.avatar, ...ORG.resolve({ roles }, ctx.settings) };
}
/** 你只可以處理職級比你低的同事，也不可以把人晉升至與你同級或更高。伺服器管理員不受限制。 */
function guard(ctx, t, newG) {
  ctx.need(can.hr(ctx), '只有人力資源及行政部的助理經理或以上，或董事會成員，可以處理人事事項。');
  if (ctx.admin) return;
  ctx.need(t.id !== ctx.uid, '不可以處理自己的人事事項。');
  ctx.need(t.g < ctx.g && newG < ctx.g, '你只可以處理職級比你低的同事，也不可以把人晉升至與你同級或更高。');
}
const fullTitle = (rank, dept) => `${ORG.title(rank, dept)}（${ORG.titleEn(rank, dept)}）`;

/** 發出公司函件：私訊當事人，附上 PNG 及 PDF。文件引擎出錯時只發文字，不影響人事操作。 */
async function sendLetter(ctx, uid, l, embed) {
  const year = D.ymd(Date.now()).slice(0, 4);
  const ref = `HR/${year}/${FB.pad(await FB.next('letter-' + year))}`;
  let files = null;
  try {
    const doc = await require('./docs').letter({ ...l, ref, date: D.zhDate(Date.now()), signName: ctx.name, signTitle: `${ctx.title}　${ctx.titleEn}`, unit: HR_UNIT });
    const fn = ref.replace(/\//g, '-');
    files = [{ name: fn + '.png', data: doc.png, type: 'image/png' }, { name: fn + '.pdf', data: doc.pdf, type: 'application/pdf' }];
    embed = { ...embed, image: { url: `attachment://${fn}.png` } };
  } catch (e) { console.log('letter render failed', e.message); }
  embed.footer = { text: `檔號 ${ref}` };
  const sent = await D.dm(uid, { embeds: [embed] }, files);
  return { ref, sent };
}

/* ---------- 應徵 ---------- */
async function applySubmit(ctx) {
  ctx.need(ctx.g === 0, '你已經是本公司員工。如想調職，請在「員工服務」提交調職申請。');
  const ch = ctx.needChannel('recruit', '招聘審批'), dept = DEPT[ctx.cid[2]] ? ctx.cid[2] : 'press', f = ctx.fields;
  const old = await FB.db().collection('applications').where('uid', '==', ctx.uid).where('status', '==', 'pending').get();
  ctx.need(old.empty, '你有一份申請正在處理，人力資源及行政部會盡快回覆。');
  const id = 'APP-' + FB.pad(await FB.next('app'));
  await FB.setDoc('applications/' + id, { id, at: Date.now(), uid: ctx.uid, name: ctx.name, dept, ...f, status: 'pending' });
  await D.api('POST', `/channels/${ch}/messages`, { embeds: [{ color: C.hr, author: B.head(HR_UNIT), title: `應徵申請 ${id}｜${DEPT[dept].zh}`, fields: [
    { name: '申請人', value: `<@${ctx.uid}>（${ctx.name}）`, inline: true }, { name: '應徵部門', value: `${DEPT[dept].zh} ${DEPT[dept].fEn}`, inline: true },
    { name: '可投入時間', value: f.hours || '—' }, { name: '相關經驗', value: f.exp || '—' }, { name: '加入原因', value: f.why || '—' }, { name: '可以帶來甚麼', value: f.offer || '—' },
  ], footer: { text: '請於七日內處理。取錄後系統會自動派發身份組及員工編號，並發出聘書。' }, timestamp: new Date().toISOString() }], components: [row(btn(`hr:ok:${id}`, '取錄', 3, { emoji: ctx.emo('ok') }), btn(`hr:no:${id}`, '不取錄', 4))], allowed_mentions: { parse: [] } });
  await FB.audit(ctx.who, 'hr', '提交應徵申請', id, DEPT[dept].zh);
  return ctx.edit(`已收到你應徵${DEPT[dept].zh}的申請，編號 **${id}**。人力資源及行政部會在七日內以私訊回覆，請保持私訊開啟。`);
}
async function getApp(ctx, id) {
  ctx.need(can.hr(ctx), '只有人力資源及行政部的助理經理或以上，或董事會成員，可以處理應徵申請。');
  const a = await FB.getDoc('applications/' + id);
  ctx.need(a, '找不到這份申請。');
  ctx.need(a.status === 'pending', '這份申請已經處理。');
  return a;
}
const cardOf = (ctx) => ({ ...((ctx.i.message && ctx.i.message.embeds && ctx.i.message.embeds[0]) || {}) });
async function button(ctx) {
  const [, b, id] = ctx.cid;
  if (b !== 'ok') throw new UserError('未支援的操作。');
  const a = await getApp(ctx, id);
  let m;
  try { m = await D.api('GET', `/guilds/${ctx.guild}/members/${a.uid}`); } catch { throw new UserError('申請人已離開伺服器。'); }
  await setRank(ctx, a.uid, m.roles || [], 'trainee', `取錄：${ctx.name}`);
  await setDept(ctx, a.uid, m.roles || [], a.dept, `取錄：${ctx.name}`);
  const prev = (await FB.getStaff(a.uid)) || {};
  const no = prev.no || 'S' + FB.pad(await FB.next('staff')), now = Date.now();
  await FB.setDoc('applications/' + id, { status: 'accepted', by: ctx.name, doneAt: now });
  await FB.saveStaff(a.uid, { name: a.name, no, rank: 'trainee', dept: a.dept, active: true, joinedAt: now, published: prev.published || 0 });
  const e = cardOf(ctx); e.color = C.ok; e.footer = { text: `已取錄｜${ctx.name}｜員工編號 ${no}` };
  await ctx.edit({ embeds: [e], components: [] });
  const press = a.dept === 'press', t = fullTitle('trainee', a.dept);
  await sendLetter(ctx, a.uid, {
    to: a.name, toLine: `應徵申請 ${id}`, subject: '聘書',
    paras: [
      `本公司欣然通知，閣下已獲聘為${DEPT[a.dept].zh}${t}，員工編號 ${no}，由 ${D.zhDate(now)}起生效。`,
      `請於入職後七日內修畢 F101、F102 及 F103 三科，以取得《基礎專業證書》；這是晉升為職員（第 2 級）的必要條件。${press ? '新聞部同事另須修畢 P201《新聞寫作基礎》，方可提交稿件審批。' : ''}`,
      '閣下須遵守《員工守則》，包括申報利益、保密及不收受利益等規定。開始工作時請在「員工服務」頻道按「開始值勤」。',
      '歡迎加入近觀者。',
    ],
  }, { color: C.brand, author: B.head(HR_UNIT), title: '歡迎加入近觀者', description: `你已獲聘為 **${DEPT[a.dept].zh}${ORG.title('trainee', a.dept)}**，員工編號 **${no}**。\n\n**首三件事**\n1. 在伺服器使用 \`/academy\`，修畢 **F101、F102、F103** 取得《基礎專業證書》。\n2. 到「員工服務」頻道認識各項自助服務，開始工作時按「開始值勤」。\n3. ${press ? '修畢 P201 後，使用 `/story new` 撰寫第一篇稿件。' : '向你的直屬上司領取第一項工作。'}\n\n使用 \`/profile\` 可隨時查看晉升進度；使用 \`/help\` 查看可用指令。` });
  await ctx.log('hr', '取錄', `${a.name}（${no}）`, `${DEPT[a.dept].zh}${ORG.title('trainee', a.dept)}｜申請 ${id}`);
  return null;
}
async function declineSubmit(ctx) {
  const id = ctx.cid[2], a = await getApp(ctx, id), note = ctx.fields.note;
  await FB.setDoc('applications/' + id, { status: 'rejected', by: ctx.name, note, doneAt: Date.now() });
  const e = cardOf(ctx); e.color = C.alert; e.footer = { text: `不取錄｜${ctx.name}｜${D.trunc(note, 120)}` };
  await ctx.edit({ embeds: [e], components: [] });
  await D.dm(a.uid, { embeds: [{ color: C.muted, author: B.head(HR_UNIT), title: `應徵結果｜${id}`, description: `多謝你應徵${DEPT[a.dept].zh}。經審閱後，本公司今次未能取錄。\n\n**說明：**${note}\n\n歡迎在 14 日後再次申請。` }] });
  await ctx.log('hr', '不取錄', a.name, `${DEPT[a.dept].zh}｜${note}`);
  return null;
}

/* ---------- 員工檔案 ---------- */
const hours = (mins) => `${Math.floor((mins || 0) / 60)} 小時 ${Math.round((mins || 0) % 60)} 分`;
async function profile(ctx) {
  const t = ctx.i.type === 2 && ctx.opt('user') ? target(ctx) : { id: ctx.uid, name: ctx.name, rank: ctx.rank, g: ctx.g, dept: ctx.dept };
  ctx.need(t.g > 0, t.id === ctx.uid ? '你尚未是本公司員工。有意加入可到「職位空缺」頻道應徵。' : `${t.name} 不是本公司員工。`);
  const st = (await FB.getStaff(t.id)) || {}, self = t.id === ctx.uid;
  const { COURSES, CERTS } = require('./courses');
  const done = COURSES.filter((c) => st.courses && st.courses[c.id]);
  const certs = CERTS.filter((c) => st.certs && st.certs[c.key]);
  const nx = ORG.nextGrade(t.rank);
  let prog = '已是最高職級。';
  if (nx) { const miss = ORG.unmet(nx.key, st, t.dept); prog = `下一級：**${ORG.title(nx.key, t.dept)}**\n` + (miss.length ? miss.map((x) => '• ' + x).join('\n') : '條件已齊備，可由上司或人力資源及行政部使用 `/promote` 辦理。'); }
  const week = (await FB.db().collection('dutylog').where('uid', '==', t.id).get()).docs.map((d) => d.data()).filter((x) => x.end > Date.now() - 7 * 864e5).reduce((n, x) => n + (x.mins || 0), 0);
  const onLeave = st.leaveUntil && st.leaveUntil > Date.now();
  const fields = [
    { name: '職銜', value: `${ORG.title(t.rank, t.dept)}\n${ORG.titleEn(t.rank, t.dept)}`, inline: true },
    { name: '職級', value: `第 ${GRADE[t.rank].g} 級｜${TIER[GRADE[t.rank].tier]}`, inline: true },
    { name: '部門', value: t.dept ? DEPT[t.dept].zh : '尚未編入', inline: true },
    { name: '員工編號', value: st.no || '—', inline: true },
    { name: '入職日期', value: st.joinedAt ? D.ymd(st.joinedAt) : '—', inline: true },
    { name: '狀態', value: onLeave ? `休假中（至 ${D.ymd(st.leaveUntil)}）` : '在職', inline: true },
    { name: '值勤時數', value: `最近七日 ${hours(week)}｜累計 ${hours(st.dutyMins)}`, inline: true },
    { name: '已發佈稿件', value: String(st.published || 0), inline: true },
    { name: '獲嘉許', value: `${st.kudos || 0} 次`, inline: true },
    { name: '試用期', value: st.probation === 'passed' ? '已通過' : st.probation === 'failed' ? '不通過' : t.rank === 'trainee' ? '評核中' : '—', inline: true },
    { name: '表現評核', value: (st.reviews || []).length ? `最近 ${Math.min(3, st.reviews.length)} 次平均 ${(st.reviews.slice(-3).reduce((n, x) => n + x.avg, 0) / Math.min(3, st.reviews.length)).toFixed(1)}／5` : '未有評核', inline: true },
    { name: `證書（${certs.length}）`, value: certs.length ? certs.map((c) => `《${c.zh}》 \`${st.certs[c.key].serial}\``).join('\n') : '尚未取得' },
    { name: `已修畢課程（${done.length}／${COURSES.length}）`, value: done.length ? done.map((c) => c.id).join('、') : '尚未修畢任何課程' },
    { name: '晉升進度', value: prog },
  ];
  if (self || can.hr(ctx)) fields.push({ name: '紀律記錄', value: (st.strikes || []).length ? st.strikes.slice(-5).map((x) => `${D.ymd(x.at)}｜${WARN_LEVELS[x.level] || '記錄'}｜${D.trunc(x.reason, 100)}`).join('\n') : '沒有' });
  return ctx.edit({ embeds: [{ color: C.hr, author: B.head('員工檔案'), title: t.name, fields }], components: self ? [row(btn('p:card', '領取員工證', 2, { emoji: ctx.emo('id') }), btn('p:academy', '培訓學院', 2, { emoji: ctx.emo('academy') }))] : [] });
}

/** 員工證（PNG）。附上 Discord 頭像；頭像讀取失敗時使用公司標記。 */
async function card(ctx) {
  const other = ctx.i.type === 2 && ctx.opt('user');
  const t = other ? target(ctx) : { id: ctx.uid, name: ctx.name, rank: ctx.rank, g: ctx.g, dept: ctx.dept, avatar: ctx.user.avatar };
  ctx.need(t.g > 0, t.id === ctx.uid ? '你尚未是本公司員工。' : `${t.name} 不是本公司員工。`);
  ctx.need(!other || t.id === ctx.uid || can.hr(ctx), '只可以領取自己的員工證。');
  const st = (await FB.getStaff(t.id)) || {};
  let avatar = null;
  if (t.avatar) { try { const r = await fetch(`https://cdn.discordapp.com/avatars/${t.id}/${t.avatar}.png?size=256`); if (r.ok) avatar = Buffer.from(await r.arrayBuffer()); } catch { /* 沒有頭像亦可 */ } }
  const doc = await require('./docs').staffCard({ name: t.name, titleZh: ORG.title(t.rank, t.dept), titleEn: ORG.titleEn(t.rank, t.dept), dept: t.dept ? `${DEPT[t.dept].zh}　${DEPT[t.dept].en}` : B.BRAND.zhFull, staffNo: st.no || '—', joined: st.joinedAt ? D.ymd(st.joinedAt) : '—', avatar });
  const fn = `staff-${st.no || t.id}.png`;
  return ctx.edit({ content: '', embeds: [{ color: C.ink, author: B.head('員工證'), description: `${t.name}｜${ORG.title(t.rank, t.dept)}｜${st.no || ''}\n職級或部門有變時，可再次領取更新版本。`, image: { url: 'attachment://' + fn } }], components: [] }, [{ name: fn, data: doc.png, type: 'image/png' }]);
}

/** 在職證明（PNG 及 PDF）：證明職銜、部門、員工編號及入職日期。本人或人力資源可以領取。 */
async function proof(ctx) {
  const other = ctx.opt('user'), t = other ? target(ctx) : { id: ctx.uid, name: ctx.name, rank: ctx.rank, g: ctx.g, dept: ctx.dept };
  ctx.need(t.g > 0, '只有本公司在職員工可以領取在職證明。');
  ctx.need(t.id === ctx.uid || can.hr(ctx), '只可以領取自己的在職證明。');
  const st = (await FB.getStaff(t.id)) || {}, year = D.ymd(Date.now()).slice(0, 4), ref = `HR/${year}/${FB.pad(await FB.next('letter-' + year))}`;
  const doc = await require('./docs').letter({ ref, date: D.zhDate(Date.now()), to: '有關人士', subject: '在職證明', paras: [
    `茲證明 ${t.name}（員工編號 ${st.no || '—'}）為本公司在職員工，現任${t.dept ? DEPT[t.dept].zh : ''}${fullTitle(t.rank, t.dept)}，職級為第 ${GRADE[t.rank].g} 級。`,
    `該員工於 ${st.joinedAt ? D.zhDate(st.joinedAt) : '—'}入職。`, '本證明應該員工的要求發出，只證明上述在職資料。', '如需核實本證明，請到本公司服務台開立個案並引用檔號。',
  ], signName: HR_UNIT, signTitle: 'Human Resources and Administration Department', unit: '' });
  const fn = ref.replace(/\//g, '-');
  await ctx.log('hr', '發出在職證明', ref, t.name);
  return ctx.edit({ embeds: [{ color: C.hr, author: B.head(HR_UNIT), title: `在職證明｜${t.name}`, image: { url: `attachment://${fn}.png` }, footer: { text: `檔號 ${ref}` } }] }, [{ name: fn + '.png', data: doc.png, type: 'image/png' }, { name: fn + '.pdf', data: doc.pdf, type: 'application/pdf' }]);
}

/* ---------- 晉升 ---------- */
async function promote(ctx) {
  const t = target(ctx);
  ctx.need(t.g > 0, `${t.name} 尚未是員工。應徵者須先經申請程序取錄。`);
  const nx = ORG.nextGrade(t.rank);
  ctx.need(nx, `${t.name} 已是最高職級。`);
  guard(ctx, t, nx.g);
  const st = (await FB.getStaff(t.id)) || {};
  const miss = ORG.unmet(nx.key, st, t.dept);
  if (miss.length) return ctx.edit({ embeds: [{ color: C.pending, author: B.head(HR_UNIT), title: `${t.name} 尚未符合晉升條件`, description: `目標職級：${ORG.title(nx.key, t.dept)}\n\n` + miss.map((x) => '• ' + x).join('\n') }] });
  await setRank(ctx, t.id, t.roles, nx.key, `晉升：${ctx.name}`);
  await FB.saveStaff(t.id, { name: t.name, rank: nx.key, dept: t.dept, active: true, promotedAt: Date.now() });
  const from = ORG.title(t.rank, t.dept), to = fullTitle(nx.key, t.dept);
  await sendLetter(ctx, t.id, { to: t.name, toLine: `${t.dept ? DEPT[t.dept].zh + '　' : ''}${from}（員工編號 ${st.no || '—'}）`, subject: '晉升通知書', paras: [
    `本公司欣然通知，閣下已符合晉升條件，由 ${D.zhDate(Date.now())}起晉升為${to}。`,
    '新職級的權限已即時生效。請使用 /help 查看新增的指令，並使用 /profile 查看下一級的晉升條件。',
    '感謝閣下一直以來的貢獻，期望閣下在新的崗位繼續發揮所長。',
  ] }, { color: C.ok, author: B.head(HR_UNIT), title: '晉升通知', description: `你已晉升為 **${ORG.title(nx.key, t.dept)}**（第 ${nx.g} 級）。\n經辦：${ctx.name}` });
  await ctx.log('hr', '晉升', `${t.name}（${st.no || '—'}）`, `${from} → ${ORG.title(nx.key, t.dept)}`);
  return ctx.edit(`已把 ${t.name} 晉升為${ORG.title(nx.key, t.dept)}，晉升通知書已以私訊發出。`);
}

/* ---------- /staff ---------- */
async function staff(ctx) {
  if (ctx.sub === 'list') {
    ctx.need(ctx.g > 0, '只有員工可以查看名冊。公開的人員名單在網站「管理層及團隊」頁。');
    const all = (await FB.db().collection('staff').where('active', '==', true).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => GRADE[s.rank]);
    const lines = [];
    for (const r of [...GRADES].reverse()) {
      const g = all.filter((s) => s.rank === r.key);
      if (g.length) lines.push(`**第 ${r.g} 級　${r.name} ${r.nameEn}**\n` + g.map((s) => `<@${s.id}>｜${ORG.title(s.rank, s.dept)}${s.no ? '｜' + s.no : ''}`).join('\n'));
    }
    return ctx.edit({ embeds: [{ color: C.hr, author: B.head(HR_UNIT), title: `員工名冊（${all.length} 人）`, description: D.trunc(lines.join('\n\n') || '尚未有員工記錄。', 4000) }], allowed_mentions: { parse: [] } });
  }
  const t = target(ctx);
  if (ctx.sub === 'set') {
    const key = ctx.opt('grade'), reason = ctx.opt('reason');
    ctx.need(GRADE[key], '未知的職級。');
    guard(ctx, t, GRADE[key].g);
    await setRank(ctx, t.id, t.roles, key, `${reason}（${ctx.name}）`);
    const st = (await FB.getStaff(t.id)) || {}, patch = { name: t.name, rank: key, dept: t.dept, active: true };
    if (!st.joinedAt) patch.joinedAt = Date.now();
    if (!st.no) patch.no = 'S' + FB.pad(await FB.next('staff'));
    await FB.saveStaff(t.id, patch);
    const from = t.rank ? ORG.title(t.rank, t.dept) : '非員工';
    await sendLetter(ctx, t.id, { to: t.name, toLine: `員工編號 ${patch.no || st.no}`, subject: '委任通知書', paras: [
      `本公司現委任閣下為${fullTitle(key, t.dept)}，由 ${D.zhDate(Date.now())}起生效。`,
      `委任原因：${reason}`,
      '新職級的權限已即時生效。請使用 /help 查看可用的指令。',
    ] }, { color: C.brand, author: B.head(HR_UNIT), title: '委任通知', description: `你的職級已更改為 **${ORG.title(key, t.dept)}**（第 ${GRADE[key].g} 級）。\n原因：${reason}\n經辦：${ctx.name}` });
    await ctx.log('hr', '委任或調整職級', `${t.name}（${patch.no || st.no}）`, `${from} → ${ORG.title(key, t.dept)}｜${reason}`);
    return ctx.edit(`已把 ${t.name} 的職級設定為${ORG.title(key, t.dept)}，委任通知書已以私訊發出。`);
  }
  ctx.need(t.g > 0, `${t.name} 不是本公司員工。`);
  guard(ctx, t, t.g);
  const st = (await FB.getStaff(t.id)) || {};
  if (ctx.sub === 'dept') {
    const key = ctx.opt('dept');
    ctx.need(DEPT[key], '未知的部門。');
    await setDept(ctx, t.id, t.roles, key, `調職：${ctx.name}`);
    await FB.saveStaff(t.id, { name: t.name, rank: t.rank, dept: key, active: true });
    await D.dm(t.id, { embeds: [{ color: C.hr, author: B.head(HR_UNIT), title: '調職通知', description: `你已調往 **${DEPT[key].zh}**，職銜為 **${ORG.title(t.rank, key)}**（${ORG.titleEn(t.rank, key)}）。\n經辦：${ctx.name}` }] });
    await ctx.log('hr', '調職', `${t.name}（${st.no || '—'}）`, `${t.dept ? DEPT[t.dept].zh : '尚未編入'} → ${DEPT[key].zh}`);
    return ctx.edit(`已把 ${t.name} 編入${DEPT[key].zh}，職銜為${ORG.title(t.rank, key)}。`);
  }
  if (ctx.sub === 'warn') {
    const level = WARN_LEVELS[ctx.opt('level')] ? ctx.opt('level') : 'verbal', reason = ctx.opt('reason');
    const strikes = [...(st.strikes || []), { at: Date.now(), level, reason, by: ctx.name }];
    await FB.saveStaff(t.id, { name: t.name, strikes });
    const embed = { color: C.alert, author: B.head(HR_UNIT), title: WARN_LEVELS[level], description: `你收到一項${WARN_LEVELS[level]}。\n\n**事由：**${reason}\n**經辦：**${ctx.name}\n\n如有異議，可在 48 小時內向經辦人的上一級提出申訴。` };
    if (level === 'verbal') await D.dm(t.id, { embeds: [embed] });
    else await sendLetter(ctx, t.id, { to: t.name, toLine: `${t.dept ? DEPT[t.dept].zh + '　' : ''}${ORG.title(t.rank, t.dept)}（員工編號 ${st.no || '—'}）`, subject: WARN_LEVELS[level], paras: [
      `經調查及聽取閣下的回應後，本公司現就以下事項向閣下發出${WARN_LEVELS[level]}：`,
      reason,
      level === 'final' ? '這是最後警告。如再有違規，本公司可終止聘用。' : '請即時改善。如再有違規，本公司可採取進一步的紀律行動。',
      '本警告已記入閣下的員工檔案。如有異議，可在收到本函後 48 小時內向經辦人的上一級提出申訴。',
    ] }, embed);
    await ctx.log('hr', WARN_LEVELS[level], `${t.name}（${st.no || '—'}）`, reason);
    return ctx.edit(`已向 ${t.name} 發出${WARN_LEVELS[level]}。對方現有 ${strikes.length} 項紀律記錄，其中 ${strikes.filter((x) => Date.now() - x.at < 30 * 864e5).length} 項在最近 30 日內。`);
  }
  if (ctx.sub === 'remove') {
    const reason = ctx.opt('reason'), kind = ctx.opt('kind') === 'terminate' ? '終止聘用' : '離職', S = ctx.settings;
    const ids = [...GRADES.map((r) => S.roles[r.key]), ...DEPTS.map((d) => S.depts[d.key]), S.staffRole].filter((id) => id && t.roles.includes(id));
    for (const id of ids) await roleOp(ctx, 'DELETE', t.id, id, `${kind}：${reason}（${ctx.name}）`);
    await FB.saveStaff(t.id, { name: t.name, active: false, rank: '', lastRank: t.rank, leftAt: Date.now(), leftReason: reason, leftKind: kind });
    await FB.db().doc('duty/' + t.id).delete();
    await ctx.log('hr', kind, `${t.name}（${st.no || '—'}）`, reason);
    return ctx.edit(`已辦理 ${t.name} 的${kind}手續，並收回所有公司身份組。員工檔案、稿件署名及已取得的證書會保留。`);
  }
  throw new UserError('未支援的指令。');
}

module.exports = { proof, applySubmit, button, declineSubmit, profile, card, promote, staff, setRank, setDept, sendLetter, target };
