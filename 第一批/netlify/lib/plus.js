'use strict';
// 進階管理功能：每日提醒、試用期及表現評核、輪值表、稿件數據、讀者投票、現場課堂、個人專頁連結。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { DEPT, GRADE, can } = ORG;
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const post = (ch, body) => D.api('POST', `/channels/${ch}/messages`, { allowed_mentions: { parse: [] }, ...body });
const all = async (c) => (await FB.db().collection(c).get()).docs.map((d) => ({ _id: d.id, ...d.data() }));

/* ---------- 每日提醒 ---------- */
/** 整理所有超時及待辦事項。由排程函式 bot-cron 每日執行，亦可用 /report digest 即時執行。 */
async function digestEmbed() {
  const now = Date.now(), H = 3600e3, old = (list, h) => list.filter((x) => (x.at || x.submittedAt || 0) < now - h * H);
  const [cases, reqs, essays, tasks, stories, staff, apps, practicals] = await Promise.all(['cases', 'requests', 'essays', 'tasks', 'stories', 'staff', 'applications', 'practicals'].map(all));
  const items = [
    ['超過 24 小時未接手的個案', old(cases.filter((c) => c.status === 'open'), 24).map((c) => `${c.id} ${D.trunc(c.subject, 30)}`)],
    ['超過 7 日未結案的個案', old(cases.filter((c) => c.status === 'active'), 168).map((c) => `${c.id}（${c.handlerName}）`)],
    ['超過 48 小時未審批的申請', old(reqs.filter((r) => r.status === 'pending'), 48).map((r) => `${r.id} ${r.name}`)],
    ['超過 24 小時未審的稿件', stories.filter((s) => s.status === 'review' && (s.submittedAt || 0) < now - 24 * H).map((s) => `${s.id} ${D.trunc(s.title, 30)}`)],
    ['超過 72 小時未評分的文章及案例分析', old(essays.filter((e) => e.status === 'pending' || e.status === 'flagged'), 72).map((e) => `${e.id} ${e.cid} ${e.name}`)],
    ['超過 72 小時未完成的實務評核', old(practicals.filter((p) => p.status === 'open' || p.status === 'claimed'), 72).map((p) => `${p.id} ${p.cid} ${p.name}${p.byName ? '｜' + p.byName : '｜未接手'}`)],
    ['超過 7 日未處理的應徵', old(apps.filter((a) => a.status === 'pending'), 168).map((a) => `${a.id} ${a.name}`)],
    ['未完成的任務', tasks.filter((t) => t.status !== 'done').map((t) => `${t.id} ${t.toName}｜期限 ${t.due}`)],
    ['入職滿 14 日而未有試用期評核', staff.filter((s) => s.active && s.rank === 'trainee' && !s.probation && (s.joinedAt || now) < now - 14 * 24 * H).map((s) => `${s.name}（${s.no || '—'}）`)],
    ['超過 14 日沒有值勤', staff.filter((s) => s.active && GRADE[s.rank] && (s.lastDutyAt || s.joinedAt || now) < now - 14 * 24 * H && !(s.leaveUntil > now)).map((s) => s.name)],
  ].filter((x) => x[1].length);
  return { color: items.length ? C.pending : C.ok, author: B.head('每日提醒'), title: `${D.ymd(now)} 待跟進事項`, description: items.length ? '' : '沒有超時或待跟進的事項。', fields: items.map(([name, list]) => ({ name: `${name}（${list.length}）`, value: D.trunc(list.slice(0, 8).join('\n'), 1000) })), footer: { text: '由系統每日自動整理。請負責的同事到相應的工作台處理。' }, timestamp: new Date().toISOString() };
}
async function runDigest() {
  const S = await FB.settings(), ch = S.channels.management;
  if (!ch) return 'no management channel';
  await post(ch, { embeds: [await digestEmbed()] });
  return 'posted';
}

/* ---------- 試用期及每月表現評核 /review ---------- */
function mayReview(ctx, t) {
  ctx.need(can.manage(ctx), '只有助理經理或以上可以評核同事。');
  ctx.need(t.g > 0, `${t.name} 不是本公司員工。`); ctx.need(t.id !== ctx.uid, '不可以評核自己。');
  ctx.need(ctx.admin || (t.g < ctx.g && (ctx.g >= 6 || ctx.dept === 'hr' || ctx.dept === t.dept)), '你只可以評核所屬部門內職級比你低的同事（人力資源及行政部及總監或以上不限部門）。');
}
async function review(ctx) {
  const t = require('./hr').target(ctx), st = (await FB.getStaff(t.id)) || {}, comment = ctx.opt('comment');
  mayReview(ctx, t);
  if (ctx.sub === 'probation') {
    ctx.need(t.rank === 'trainee', '只有見習職級的同事需要試用期評核。');
    const res = ctx.opt('result'), zh = { pass: '通過', extend: '延長試用期', fail: '不通過' }[res];
    ctx.need(zh, '未知的結果。');
    await FB.saveStaff(t.id, { probation: res === 'pass' ? 'passed' : res === 'extend' ? '' : 'failed', probationAt: Date.now(), probationBy: ctx.name, probationNote: comment });
    await D.dm(t.id, { embeds: [{ color: res === 'pass' ? C.ok : C.pending, author: B.head('人力資源及行政部'), title: `試用期評核：${zh}`, description: `**評語：**${comment}\n評核：${ctx.name}（${ctx.title}）` + (res === 'pass' ? '\n\n通過試用期是晉升為第 2 級的條件之一。使用 `/profile` 查看其餘條件。' : res === 'extend' ? '\n\n試用期延長 14 日，屆時會再次評核。' : '\n\n人力資源及行政部會與你跟進。') }] });
    await ctx.log('hr', `試用期評核：${zh}`, `${t.name}（${st.no || '—'}）`, comment);
    return ctx.edit(`已記錄 ${t.name} 的試用期評核：${zh}。${res === 'fail' ? '如決定終止聘用，請以 /staff remove 辦理。' : ''}`);
  }
  const sc = ['output', 'quality', 'teamwork'].map((k) => Math.max(1, Math.min(5, parseInt(ctx.opt(k), 10) || 0)));
  const mine = (st.reviews || []).filter((r) => r.byId === ctx.uid && r.at > Date.now() - 25 * 864e5);
  ctx.need(!mine.length, '你在最近 25 日內已經評核過這位同事。表現評核每月一次。');
  const avg = Math.round(((sc[0] + sc[1] + sc[2]) / 3) * 10) / 10;
  await FB.saveStaff(t.id, { reviews: [...(st.reviews || []), { at: Date.now(), byId: ctx.uid, by: ctx.name, output: sc[0], quality: sc[1], teamwork: sc[2], avg, comment }].slice(-12) });
  await D.dm(t.id, { embeds: [{ color: C.hr, author: B.head('表現評核'), title: `${D.ymd(Date.now()).slice(0, 7)} 表現評核`, fields: [{ name: '工作量', value: `${sc[0]}／5`, inline: true }, { name: '工作質素', value: `${sc[1]}／5`, inline: true }, { name: '協作及紀律', value: `${sc[2]}／5`, inline: true }, { name: '評語', value: comment }], footer: { text: `平均 ${avg}／5｜評核：${ctx.name}（${ctx.title}）｜如有異議可用 /appeal 提出` } }] });
  await ctx.log('hr', '每月表現評核', `${t.name}（${st.no || '—'}）`, `平均 ${avg}／5｜${D.trunc(comment, 200)}`);
  return ctx.edit(`已記錄 ${t.name} 的表現評核：平均 ${avg}／5。對方已收到私訊。最近三次評核的平均分會計入晉升條件。`);
}

/* ---------- 輪值表 /roster ---------- */
const SHIFTS = { am: '早更 08:00 至 14:00', pm: '午更 14:00 至 20:00', night: '晚更 20:00 至 02:00' };
async function roster(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以使用輪值表。');
  const today = D.ymd(Date.now());
  if (ctx.sub === 'view') {
    const rows = (await all('roster')).filter((r) => r.date >= today).sort((a, b) => (a.date + Object.keys(SHIFTS).indexOf(a.shift)).localeCompare(b.date + Object.keys(SHIFTS).indexOf(b.shift)));
    const days = [...new Set(rows.map((r) => r.date))].slice(0, 7);
    return ctx.edit({ embeds: [{ color: C.duty, author: B.head('輪值表'), title: '未來的輪值安排', description: days.length ? '' : '暫時未有人登記輪值。使用 `/roster add` 登記。', fields: days.map((d) => ({ name: d, value: Object.entries(SHIFTS).map(([k, zh]) => { const who = rows.filter((r) => r.date === d && r.shift === k); return `${zh.slice(0, 2)}：${who.length ? who.map((r) => `<@${r.uid}>`).join('、') : '未有人'}`; }).join('\n') })), footer: { text: '輪值的同事須在該時段值勤，並優先處理審稿台及個案。' } }], allowed_mentions: { parse: [] } });
  }
  const date = String(ctx.opt('date') || '').trim(), shift = ctx.opt('shift');
  ctx.need(/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)), '日期格式須為 2026-10-12。'); ctx.need(SHIFTS[shift], '未知的更次。'); ctx.need(date >= today, '不可以登記已過去的日期。');
  let who = { id: ctx.uid, name: ctx.name };
  if (ctx.opt('user')) { who = require('./hr').target(ctx); ctx.need(can.manage(ctx) || who.id === ctx.uid, '只有助理經理或以上可以為其他同事編更。'); }
  const id = `${date}_${shift}_${who.id}`;
  if (ctx.sub === 'drop') { await FB.db().doc('roster/' + id).delete(); await ctx.log('duty', '取消輪值', '', `${who.name}｜${date} ${SHIFTS[shift]}`); return ctx.edit(`已取消 ${who.name} 在 ${date} ${SHIFTS[shift]} 的輪值。請確保有其他同事補上。`); }
  await FB.setDoc('roster/' + id, { date, shift, uid: who.id, name: who.name, by: ctx.name, at: Date.now() });
  await ctx.log('duty', '登記輪值', '', `${who.name}｜${date} ${SHIFTS[shift]}`);
  return ctx.edit(`已登記 ${who.name}：${date} ${SHIFTS[shift]}。`);
}

/* ---------- 稿件數據 ---------- */
async function storyStats(ctx) {
  ctx.need(can.senior(ctx) || can.review(ctx), '只有審稿人員及經理或以上可以查看稿件數據。');
  const by = {};
  for (const s of await all('stories')) {
    const a = (by[s.authorId] = by[s.authorId] || { name: s.authorName, pub: 0, ret: 0, cor: 0, rej: 0, wd: 0 });
    a.ret += s.returns || 0; if (s.status === 'rejected') a.rej++; if (s.publishedAt) { a.pub++; a.cor += (s.corrections || []).filter((c) => c.kind !== 'clarify').length; } if (s.status === 'retracted') a.wd++;
  }
  const rows = Object.values(by).sort((a, b) => b.pub - a.pub).slice(0, 20);
  return ctx.edit({ embeds: [{ color: C.ink, author: B.head('稿件數據'), title: '各撰稿人的稿件紀錄', description: rows.length ? '```\n發佈 退回 更正 撤回 不採用  撰稿人\n' + rows.map((a) => `${String(a.pub).padStart(3)} ${String(a.ret).padStart(4)} ${String(a.cor).padStart(4)} ${String(a.wd).padStart(4)} ${String(a.rej).padStart(5)}   ${a.name}`).join('\n') + '\n```' : '尚未有稿件。', footer: { text: '退回次數多：建議重溫 P201。更正次數多：建議重溫 P202 並檢查審稿清單。數據用於安排培訓，不作處分依據。' } }] });
}

/* ---------- 讀者投票 /poll ---------- */
function pollMsg(p) {
  const total = Object.keys(p.votes).length, n = (i) => Object.values(p.votes).filter((v) => v === i).length;
  return { embeds: [{ color: C.feature, author: B.head('讀者投票'), title: D.trunc(p.question, 250), description: p.options.map((o, i) => `**${o}**　${n(i)} 票${total ? `（${Math.round((n(i) / total) * 100)}%）` : ''}`).join('\n'), footer: { text: p.open ? `共 ${total} 人投票｜每人一票，可更改｜結果只反映參與投票者的意見` : `投票已結束｜共 ${total} 人投票` }, timestamp: new Date(p.at).toISOString() }], components: p.open ? [row(...p.options.map((o, i) => btn(`pl:v:${p.id}:${i}`, D.trunc(o, 40), 2))), row(btn(`pl:end:${p.id}`, '結束投票', 4))] : [], allowed_mentions: { parse: [] } };
}
async function poll(ctx) {
  ctx.need(can.review(ctx) || can.senior(ctx), '只有審稿人員及經理或以上可以發起讀者投票。');
  const options = String(ctx.opt('options')).split(/[|｜]/).map((x) => x.trim()).filter(Boolean).slice(0, 4), ch = ctx.needChannel('lounge', '讀者交流');
  ctx.need(options.length >= 2, '請最少提供兩個選項，以「|」分隔，例如：支持|反對|沒有意見。');
  const id = 'PL-' + FB.pad(await FB.next('poll')), p = { id, at: Date.now(), by: ctx.uid, question: ctx.opt('question'), options, votes: {}, open: true };
  const m = await post(ch, pollMsg(p));
  await FB.setDoc('polls/' + id, { ...p, msgId: m.id, channelId: ch });
  await ctx.log('editorial', '發起讀者投票', id, p.question);
  return ctx.edit(`已在 <#${ch}> 發起投票 ${id}。`);
}
async function pollButton(ctx) {
  const [, b, id, n] = ctx.cid, p = await FB.getDoc('polls/' + id);
  ctx.need(p, '找不到這個投票。'); ctx.need(p.open, '投票已經結束。');
  if (b === 'end') { ctx.need(p.by === ctx.uid || can.senior(ctx), '只有發起人或經理或以上可以結束投票。'); await FB.setDoc('polls/' + id, { open: false }); return ctx.edit(pollMsg({ ...p, open: false })); }
  const votes = { ...p.votes, [ctx.uid]: parseInt(n, 10) };
  await FB.db().doc('polls/' + id).update({ votes });
  return ctx.edit(pollMsg({ ...p, votes }));
}

/* ---------- 現場課堂 /class ---------- */
function classMsg(ctx, k) {
  const { COURSE } = require('./courses'), c = COURSE[k.cid], ST = { open: '接受報名', live: '上課中', done: '已完結' };
  const list = (a) => (a.length ? D.trunc(a.map((x) => `<@${x}>`).join('、'), 1000) : '—');
  return { embeds: [{ color: C.academy, author: B.head('培訓學院｜現場課堂'), title: `${k.id}｜${c.id} ${c.name}`, fields: [{ name: '時間', value: k.when, inline: true }, { name: '導師', value: `<@${k.tutor}>`, inline: true }, { name: '狀態', value: ST[k.status], inline: true }, { name: `已報名（${k.joined.length}）`, value: list(k.joined) }, { name: `已簽到（${k.present.length}）`, value: list(k.present) }], footer: { text: '導師按「開始上課」後才可以簽到。出席紀錄會記入員工檔案。' } }], components: k.status === 'done' ? [] : [row(btn(`cl:join:${k.id}`, '報名', 1, { disabled: k.status !== 'open' }), btn(`cl:in:${k.id}`, '簽到', 3, { disabled: k.status !== 'live' }), btn(`cl:start:${k.id}`, '開始上課', 2, { disabled: k.status !== 'open' }), btn(`cl:end:${k.id}`, '結束', 2, { disabled: k.status !== 'live' }))], allowed_mentions: { parse: [] } };
}
async function klass(ctx) {
  ctx.need(can.manage(ctx), '只有助理經理或以上可以開辦現場課堂。');
  const { COURSE } = require('./courses'), c = COURSE[ctx.opt('course')], ch = ctx.needChannel('meetings', '會議安排');
  ctx.need(c, '找不到這一科。');
  const id = 'LS-' + FB.pad(await FB.next('class')), k = { id, cid: c.id, when: ctx.opt('when'), tutor: ctx.uid, status: 'open', joined: [], present: [], at: Date.now() };
  const m = await post(ch, classMsg(ctx, k));
  await FB.setDoc('classes/' + id, { ...k, msgId: m.id, channelId: ch });
  await ctx.log('academy', '開辦現場課堂', id, `${c.id} ${c.name}｜${k.when}`);
  return ctx.edit(`已開辦現場課堂 ${id}：<#${ch}>`);
}
async function classButton(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以參加。');
  const [, b, id] = ctx.cid, k = await FB.getDoc('classes/' + id);
  ctx.need(k, '找不到這個課堂。'); ctx.need(k.status !== 'done', '課堂已經完結。');
  const patch = {};
  if (b === 'join') { ctx.need(k.status === 'open', '報名已經截止。'); patch.joined = k.joined.includes(ctx.uid) ? k.joined.filter((x) => x !== ctx.uid) : [...k.joined, ctx.uid]; }
  else if (b === 'in') { ctx.need(k.status === 'live', '導師尚未開始上課。'); ctx.need(k.tutor !== ctx.uid, '導師無需簽到。'); patch.present = [...new Set([...k.present, ctx.uid])]; }
  else { ctx.need(k.tutor === ctx.uid || can.senior(ctx), '只有導師可以開始或結束課堂。'); patch.status = b === 'start' ? 'live' : 'done'; }
  await FB.setDoc('classes/' + id, patch);
  const nk = { ...k, ...patch };
  if (patch.status === 'done') {
    for (const uid of nk.present) { const st = (await FB.getStaff(uid)) || {}; await FB.saveStaff(uid, { classes: { ...(st.classes || {}), [k.cid]: ((st.classes || {})[k.cid] || 0) + 1 } }); }
    await ctx.log('academy', '現場課堂完結', id, `${k.cid}｜出席 ${nk.present.length} 人`);
  }
  return ctx.edit(classMsg(ctx, nk));
}

/* ---------- 個人專頁 /portal ---------- */
const sign = (uid, exp) => { const body = `${uid}.${exp}`; return Buffer.from(body).toString('base64url') + '.' + D.hmac('portal:' + body).slice(0, 32); };
function readToken(t) {
  try { const [b, sig] = String(t || '').split('.'), body = Buffer.from(b, 'base64url').toString(), [uid, exp] = body.split('.'); return D.safeEq(sig, D.hmac('portal:' + body).slice(0, 32)) && +exp > Date.now() ? uid : ''; } catch { return ''; }
}
async function portal(ctx) {
  ctx.need(can.staff(ctx), '個人專頁只供本公司員工使用。'); ctx.need(D.site(), '尚未設定網站網址。');
  const url = `${D.site()}/#/me/${sign(ctx.uid, Date.now() + 30 * 60e3)}`;
  return ctx.edit({ content: '這是你的個人專頁連結，30 分鐘內有效。專頁顯示你的檔案、課程、任務及申請。**請勿把連結交給其他人。**', components: [row(D.linkBtn(url, '開啟個人專頁'))] });
}
/** 供 /api/me 使用：只回傳該同事自己的資料 */
async function portalData(token) {
  const uid = readToken(token);
  if (!uid) return null;
  const st = await FB.getStaff(uid);
  if (!st || !st.active) return null;
  const { COURSES, CERTS } = require('./courses'), S = await FB.settings();
  const mine = async (c, k) => (await FB.db().collection(c).where(k, '==', uid).get()).docs.map((d) => d.data());
  const [tasks, reqs, logs] = await Promise.all([mine('tasks', 'to'), mine('requests', 'uid'), mine('dutylog', 'uid')]);
  const nx = ORG.nextGrade(st.rank), rv = (st.reviews || []).slice(-3);
  return {
    name: st.name, no: st.no || '', title: ORG.title(st.rank, st.dept), titleEn: ORG.titleEn(st.rank, st.dept), dept: st.dept ? DEPT[st.dept].zh : '', grade: GRADE[st.rank].g, joinedAt: st.joinedAt || 0,
    dutyMins: st.dutyMins || 0, weekMins: logs.filter((x) => x.end > Date.now() - 7 * 864e5).reduce((n, x) => n + x.mins, 0), published: st.published || 0, kudos: st.kudos || 0,
    probation: st.probation || '', review: rv.length ? Math.round((rv.reduce((n, x) => n + x.avg, 0) / rv.length) * 10) / 10 : null,
    next: nx ? { title: ORG.title(nx.key, st.dept), missing: ORG.unmet(nx.key, st, st.dept) } : null,
    courses: COURSES.map((c) => ({ id: c.id, name: c.name, open: !!(S.openCourses && S.openCourses[c.id]), exam: !!(st.exams && st.exams[c.id]), score: st.exams && st.exams[c.id] ? st.exams[c.id].score : null, essay: st.essays && st.essays[c.id] ? st.essays[c.id].grade : c.essay && c.essay.required ? 'required' : '', done: !!(st.courses && st.courses[c.id]), left: require('./academy').missing(st, c) })),
    certs: CERTS.filter((k) => st.certs && st.certs[k.key]).map((k) => ({ zh: k.zh, serial: st.certs[k.key].serial })),
    tasks: tasks.filter((t) => t.status !== 'done').map((t) => ({ id: t.id, title: t.title, due: t.due, status: t.status })),
    requests: reqs.sort((a, b) => b.n - a.n).slice(0, 8).map((r) => ({ id: r.id, type: ORG.REQ_TYPES[r.type].zh, status: ORG.REQ_STATUS[r.status], at: r.at })),
  };
}

module.exports = { digestEmbed, runDigest, review, roster, storyStats, poll, pollButton, klass, classButton, portal, portalData, readToken, sign, SHIFTS };
