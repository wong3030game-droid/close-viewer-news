'use strict';
// 培訓學院：課程講義（文字、PDF、PNG）→ 考試（按鈕作答）→ 即時成績 → 自動頒發證書。
// 合格紀錄寫入員工檔案，晉升時會核對。證書以圖像及 PDF 發出，並可在網站以編號核實。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { COURSES, COURSE, CERTS, CERT, TRACKS } = require('./courses');
const HANDOUTS = require('./handouts.json');
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const ABCD = ['A', 'B', 'C', 'D'];

const passed = (st, id) => !!(st && st.courses && st.courses[id]);
/** 課程必須由管理層開放後才可以報讀（/course open）。未開放的課程不能閱讀講義、應考或提交文章。 */
const isOpen = (S, id) => !!(S && S.openCourses && S.openCourses[id]);
const examOk = (st, id) => !!(st && st.exams && st.exams[id]);
const essayOk = (st, id) => !!(st && st.essays && st.essays[id] && st.essays[id].ok);
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function homeMsg(ctx, st, note) {
  const ok = ctx.em('ok');
  const fields = TRACKS.map((t) => ({ name: `${t.zh} ${t.en}`, value: COURSES.filter((c) => c.track === t.key).map((c) => `${passed(st, c.id) ? ok : ''}**${c.id}** ${c.name}${passed(st, c.id) ? `｜已修畢 ${st.courses[c.id].score}／${c.exam.draw}` : !isOpen(ctx.settings, c.id) ? '｜未開放' : examOk(st, c.id) ? '｜考試合格，尚欠文章' : ''}${essayOk(st, c.id) ? `｜文章${st.essays[c.id].grade === 'dist' ? '優異' : '合格'}` : ''}`).join('\n') }));
  const certs = CERTS.map((k) => { const got = st && st.certs && st.certs[k.key], n = k.courses.filter((id) => passed(st, id)).length; return `${got ? ok : ''}《${k.zh}》${got ? `｜已取得 \`${got.serial}\`` : `｜${n}／${k.courses.length} 科（${k.courses.join('、')}）`}`; });
  fields.push({ name: '證書', value: certs.join('\n') });
  return {
    content: note || '', embeds: [{ color: C.academy, author: B.head('培訓學院'), title: '課程及證書', description: '選擇一科開始修讀：先閱讀講義，再應考；每科另設文章題目。標示「未開放」的課程須待管理層開放後才可報讀。修畢一張證書所需的全部課程，系統會即時頒發證書。', fields, footer: { text: `考試每次隨機抽 ${COURSES[0].exam.draw} 題，答對 ${COURSES[0].exam.pass} 題合格；不合格須等候 ${COURSES[0].exam.cooldownHours} 小時才可重考。` } }],
    components: [D.select('ac:pick', '選擇課程', COURSES.map((c) => ({ label: `${c.id} ${c.name}${isOpen(ctx.settings, c.id) ? '' : '（未開放）'}`, value: c.id, description: D.trunc(c.who, 90), emoji: passed(st, c.id) ? ctx.emo('ok') : ctx.emo('academy') })))],
  };
}
function pageMsg(ctx, c, n) {
  n = Math.max(0, Math.min(c.material.length - 1, n));
  const m = c.material[n], last = n === c.material.length - 1, h = HANDOUTS[c.id];
  const btns = [btn(`ac:pg:${c.id}:${n - 1}`, '上一頁', 2, { disabled: n === 0 }), btn(`ac:pg:${c.id}:${n + 1}`, '下一頁', 2, { disabled: last }), btn(`ac:start:${c.id}`, '開始考試', last ? 3 : 2, { emoji: ctx.emo('edit') })];
  const more = [];
  if (c.essay) more.push(btn(`ac:essay:${c.id}`, c.essay.required ? '撰寫文章（必須）' : '撰寫文章', 2, { emoji: ctx.emo('doc') }));
  if (h) more.push(btn(`ac:file:${c.id}`, '講義檔案', 2, { emoji: ctx.emo('doc') }));
  more.push(btn('ac:home', '課程表'));
  return {
    content: '', embeds: [{ color: C.academy, author: B.head(`培訓學院｜${c.id} ${c.name}`), title: m.h, description: m.t, fields: last && c.essay ? [{ name: `文章題目${c.essay.required ? '（必須合格才算修畢）' : '（選做）'}`, value: `${c.essay.prompt}\n最少 ${c.essay.min} 字。評分重點共 ${c.essay.keywords.length} 項。` }] : [], footer: { text: `講義第 ${n + 1}／${c.material.length} 頁${c.need.length ? `｜先修：${c.need.join('、')}` : ''}` } }],
    components: [row(...btns), row(...more)],
  };
}
function questionMsg(c, sid, sess) {
  const cur = sess.qs[sess.n], q = c.q[cur.i];
  return {
    content: '', embeds: [{ color: C.academy, author: B.head(`培訓學院｜${c.id} ${c.name}`), title: `第 ${sess.n + 1}／${sess.qs.length} 題`, description: `**${q.q}**\n\n` + cur.ord.map((k, x) => `**${ABCD[x]}.** ${q.o[k]}`).join('\n'), footer: { text: `每題限時 ${c.exam.perQuestionSec} 秒，逾時作答當作答錯。考核須獨立完成，不得使用人工智能工具或翻查資料。` } }],
    components: [row(...cur.ord.map((k, x) => btn(`ac:ans:${sid}:${sess.n}:${x}`, ABCD[x], 1)))],
  };
}

async function home(ctx) {
  ctx.need(ctx.g > 0, '培訓學院只開放予本公司員工。有意加入可到「職位空缺」頻道應徵。');
  return ctx.edit(homeMsg(ctx, ctx.staff));
}

/* ---------- 證書 ---------- */
/** 頒發證書：寫入紀錄、製作圖像及 PDF、在「證書頒授」頻道公佈、私訊持有人。圖像製作失敗時仍然頒發（只發文字）。 */
async function issue(ctx, who, st, k) {
  const now = Date.now(), year = D.ymd(now).slice(0, 4);
  const serial = `CVC-${year}-${FB.pad(await FB.next('cert-' + year))}`;
  const rec = { serial, uid: who.uid, name: who.name, no: st.no || '', key: k.key, zh: k.zh, en: k.en, courses: k.courses, at: now, status: 'valid' };
  await FB.setDoc('certs/' + serial, rec);
  const files = await render(rec);
  const e = { color: C.academy, author: B.head('培訓學院'), title: `頒授《${k.zh}》`, description: `${ctx.em('cert')}<@${who.uid}>（${who.title}）已修畢 ${k.courses.join('、')}，獲頒 **${k.zh}**（${k.en}）。`, fields: [{ name: '證書編號', value: `\`${serial}\``, inline: true }, { name: '頒發日期', value: D.ymd(now), inline: true }], footer: { text: '可在公司網站「證書核實」頁以編號核實。' } };
  if (files) e.image = { url: `attachment://${serial}.png` };
  const ch = ctx.settings.channels.certs;
  if (ch) { try { await D.api('POST', `/channels/${ch}/messages`, { embeds: [e], allowed_mentions: { parse: [] } }, files ? [files[0]] : null); } catch (err) { console.log('cert post failed', err.message); } }
  await D.dm(who.uid, { embeds: [{ ...e, description: `恭喜你獲頒 **${k.zh}**（${k.en}）。證書圖像及 PDF 已附上，日後可使用 \`/cert show\` 重新領取。` }] }, files);
  await ctx.log('academy', '頒發證書', serial, `${who.name}｜《${k.zh}》`);
  return { serial, at: now };
}
/**
 * 結算：考試合格（及如有需要，文章合格）的課程記為修畢，並頒發新符合資格的證書。回傳新頒發的證書。
 * 考試合格或文章獲評合格後都會呼叫；who 為該同事（評卷時並非操作者本人）。
 */
async function settle(ctx, who) {
  const st = (await FB.getStaff(who.uid)) || {}, courses = { ...(st.courses || {}) }, certs = { ...(st.certs || {}) }, awarded = [];
  for (const c of COURSES) if (!courses[c.id] && examOk(st, c.id) && (!(c.essay && c.essay.required) || essayOk(st, c.id))) courses[c.id] = st.exams[c.id];
  await FB.saveStaff(who.uid, { courses });
  for (const kc of CERTS) if (!certs[kc.key] && kc.courses.every((id) => courses[id])) { certs[kc.key] = await issue(ctx, who, st, kc); awarded.push(kc); }
  if (awarded.length) await FB.saveStaff(who.uid, { certs });
  return awarded;
}
/** 製作證書檔案：[PNG, PDF]；失敗時回傳 null */
async function render(rec) {
  try {
    const chair = (await FB.db().collection('staff').where('rank', '==', 'chairman').get()).docs.map((d) => d.data()).find((s) => s.active);
    const doc = await require('./docs').certificate({ name: rec.name, zh: rec.zh, en: rec.en, serial: rec.serial, date: D.zhDate(rec.at), courses: rec.courses.map((id) => `${id}　${COURSE[id].name}　${COURSE[id].en}`), signer: chair ? chair.name : '' });
    return [{ name: `${rec.serial}.png`, data: doc.png, type: 'image/png' }, { name: `${rec.serial}.pdf`, data: doc.pdf, type: 'application/pdf' }];
  } catch (e) { console.log('cert render failed', e.message); return null; }
}
const normSerial = (x) => { const m = /(\d{4})\D*(\d{1,6})\s*$/.exec(String(x || '')); return m ? `CVC-${m[1]}-${FB.pad(parseInt(m[2], 10))}` : ''; };
const verifyEmbed = (rec, serial) => (rec
  ? { color: rec.status === 'valid' ? C.ok : C.alert, author: B.head('證書核實'), title: rec.status === 'valid' ? '證書有效' : '證書已撤銷', fields: [{ name: '證書編號', value: `\`${rec.serial}\``, inline: true }, { name: '頒發日期', value: D.ymd(rec.at), inline: true }, { name: '持有人', value: rec.name, inline: true }, { name: '證書', value: `${rec.zh}\n${rec.en}` }, { name: '修畢課程', value: rec.courses.map((id) => `${id} ${COURSE[id] ? COURSE[id].name : ''}`).join('\n') }, ...(rec.status !== 'valid' ? [{ name: '撤銷原因', value: rec.revokeReason || '—' }] : [])] }
  : { color: C.alert, author: B.head('證書核實'), title: '找不到這張證書', description: `本公司沒有編號為 \`${serial || '（格式不正確）'}\` 的證書紀錄。證書編號的格式為 CVC-年份-四位數字，例如 CVC-2026-0001。` });

/** /verify：任何人都可以核實證書 */
async function verify(ctx) {
  const serial = normSerial(ctx.opt('serial'));
  return ctx.edit({ embeds: [verifyEmbed(serial ? await FB.getDoc('certs/' + serial) : null, serial)] });
}
/** /cert list｜show｜revoke */
async function cert(ctx) {
  ctx.need(ctx.g > 0, '只有本公司員工可以使用這個指令。公眾核實證書請用 /verify。');
  if (ctx.sub === 'list') {
    const uid = ctx.opt('user') || ctx.uid;
    const all = (await FB.db().collection('certs').where('uid', '==', uid).get()).docs.map((d) => d.data()).sort((a, b) => a.at - b.at);
    return ctx.edit({ embeds: [{ color: C.academy, author: B.head('培訓學院'), title: uid === ctx.uid ? '我的證書' : '證書紀錄', description: all.length ? all.map((r) => `\`${r.serial}\`《${r.zh}》｜${D.ymd(r.at)}${r.status !== 'valid' ? '｜已撤銷' : ''}`).join('\n') : '尚未取得任何證書。使用 `/academy` 開始修讀。' }] });
  }
  const serial = normSerial(ctx.opt('serial')), rec = serial && (await FB.getDoc('certs/' + serial));
  ctx.need(rec, `找不到證書 ${serial || ctx.opt('serial')}。`);
  if (ctx.sub === 'show') {
    ctx.need(rec.uid === ctx.uid || ORG.can.hr(ctx), '只有持有人或人力資源及行政部可以領取證書檔案。其他人可使用 /verify 核實。');
    ctx.need(rec.status === 'valid', '這張證書已被撤銷。');
    const files = await render(rec);
    ctx.need(files, '證書檔案暫時未能製作，請稍後再試；如持續出現，請通知資訊科技部。');
    return ctx.edit({ embeds: [{ ...verifyEmbed(rec), image: { url: `attachment://${serial}.png` } }] }, files);
  }
  if (ctx.sub === 'revoke') {
    ctx.need(ORG.can.hr(ctx), '只有人力資源及行政部的助理經理或以上，或董事會成員，可以撤銷證書。');
    ctx.need(rec.status === 'valid', '這張證書已被撤銷。');
    await FB.setDoc('certs/' + serial, { status: 'revoked', revokeReason: ctx.opt('reason'), revokedBy: ctx.name, revokedAt: Date.now() });
    const st = (await FB.getStaff(rec.uid)) || {}, certs = { ...(st.certs || {}) };
    delete certs[rec.key];
    await FB.db().doc('staff/' + rec.uid).update({ certs });
    await ctx.log('academy', '撤銷證書', serial, `${rec.name}｜${ctx.opt('reason')}`);
    return ctx.edit(`已撤銷證書 ${serial}。網站及 /verify 會顯示為已撤銷。`);
  }
  throw new UserError('未支援的指令。');
}

/* ---------- 開放及關閉課程 /course ---------- */
async function course(ctx) {
  const S = ctx.settings, open = { ...(S.openCourses || {}) };
  if (ctx.sub === 'status') { ctx.need(ctx.g > 0, '只有本公司員工可以查看。'); return ctx.edit({ embeds: [{ color: C.academy, author: B.head('培訓學院'), title: '課程開放狀況', description: COURSES.map((c) => `**${c.id}** ${c.name}｜${open[c.id] ? '已開放' : '未開放'}`).join('\n'), footer: { text: '人力資源及行政部助理經理或以上、總監或以上可用 /course open 及 /course close 更改。' } }] }); }
  ctx.need(ORG.can.academy(ctx), '只有人力資源及行政部的助理經理或以上，或總監或以上，可以開放或關閉課程。');
  const id = ctx.opt('id'), list = id === 'all' ? COURSES : [COURSE[id]].filter(Boolean), on = ctx.sub === 'open';
  ctx.need(list.length, '找不到這一科。');
  const changed = list.filter((c) => !!open[c.id] !== on);
  for (const c of list) { if (on) open[c.id] = true; else delete open[c.id]; }
  await FB.db().doc('settings/main').update({ openCourses: open });
  if (!changed.length) return ctx.edit(`所選課程本來已經${on ? '開放' : '關閉'}。`);
  await ctx.log('academy', on ? '開放課程' : '關閉課程', changed.map((c) => c.id).join('、'), '');
  const ch = S.channels.staffnotice;
  if (on && ch) { try { await D.api('POST', `/channels/${ch}/messages`, { embeds: [{ color: C.academy, author: B.head('培訓學院'), title: '課程開放報讀', description: changed.map((c) => `**${c.id}** ${c.name}　${c.en}\n${c.intro}`).join('\n\n'), footer: { text: `使用 /academy 或到「培訓學院」頻道報讀｜${ctx.name}　${ctx.title}` }, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } }); } catch (e) { console.log('course notice failed', e.message); } }
  return ctx.edit(`已${on ? '開放' : '關閉'}：${changed.map((c) => `${c.id} ${c.name}`).join('、')}。${on && ch ? `已在 <#${ch}> 公佈。` : ''}${on ? '' : '已修畢的同事不受影響；正在修讀的同事須待重新開放才可繼續。'}`);
}

/** 成績單（PNG 及 PDF）：列出已修畢課程、成績、文章評級及證書 */
async function transcript(ctx) {
  const HR = require('./hr'), other = ctx.opt('user');
  const t = other ? HR.target(ctx) : { id: ctx.uid, name: ctx.name, rank: ctx.rank, g: ctx.g, dept: ctx.dept };
  ctx.need(t.g > 0, '只有本公司員工有成績單。');
  ctx.need(t.id === ctx.uid || ORG.can.hr(ctx) || ORG.can.academy(ctx), '只可以領取自己的成績單。');
  const st = (await FB.getStaff(t.id)) || {}, done = COURSES.filter((c) => passed(st, c.id));
  ctx.need(done.length, '尚未修畢任何課程。');
  const lines = done.map((c) => `${c.id}　${c.name}　考試 ${st.courses[c.id].score}／${c.exam.draw}${essayOk(st, c.id) ? `　文章${st.essays[c.id].grade === 'dist' ? '優異' : '合格'}` : ''}`);
  const certs = CERTS.filter((k) => st.certs && st.certs[k.key]).map((k) => `《${k.zh}》${st.certs[k.key].serial}`);
  const year = D.ymd(Date.now()).slice(0, 4), ref = `AC/${year}/${FB.pad(await FB.next('transcript-' + year))}`;
  const doc = await require('./docs').letter({ ref, date: D.zhDate(Date.now()), to: t.name, toLine: `${ORG.title(t.rank, t.dept)}（員工編號 ${st.no || '—'}）`, subject: '培訓成績單', paras: [`茲證明上述員工已修畢本公司培訓學院以下 ${done.length} 科課程：`, lines.join('\n'), certs.length ? '已取得證書：\n' + certs.join('\n') : '尚未取得證書。', '本成績單由系統按考核紀錄發出。'], signName: '培訓學院', signTitle: 'Academy', unit: '' });
  const fn = ref.replace(/\//g, '-');
  return ctx.edit({ embeds: [{ color: C.academy, author: B.head('培訓學院'), title: `培訓成績單｜${t.name}`, description: `已修畢 ${done.length}／${COURSES.length} 科；證書 ${certs.length} 張。`, image: { url: `attachment://${fn}.png` }, footer: { text: `檔號 ${ref}` } }] }, [{ name: fn + '.png', data: doc.png, type: 'image/png' }, { name: fn + '.pdf', data: doc.pdf, type: 'application/pdf' }]);
}

/* ---------- 講義及考試 ---------- */
async function button(ctx) {
  ctx.need(ctx.g > 0, '培訓學院只開放予本公司員工。');
  const [, act, a, b, k] = ctx.cid, st = ctx.staff || {};
  if (act === 'home') return ctx.edit(homeMsg(ctx, st));
  if (act === 'pick' || act === 'pg') {
    const c = COURSE[act === 'pick' ? ctx.values[0] : a];
    ctx.need(c, '找不到這一科。');
    ctx.need(isOpen(ctx.settings, c.id), `${c.id}《${c.name}》尚未開放報讀。管理層開放後會在「員工通告」公佈。`);
    return ctx.edit(pageMsg(ctx, c, act === 'pick' ? 0 : parseInt(b, 10) || 0));
  }
  if (act === 'file') {
    const c = COURSE[a], h = HANDOUTS[a];
    ctx.need(c && h, '這一科暫時未有講義檔案，請閱讀文字版講義。');
    const DOC = require('./docs'), files = [];
    try {
      files.push({ name: `${c.id}.pdf`, data: await DOC.pub(`handouts/${c.id}.pdf`), type: 'application/pdf' });
      for (let p = 1; p <= Math.min(h.pages, 9); p++) files.push({ name: `${c.id}-${p}.png`, data: await DOC.pub(`handouts/${c.id}-${p}.png`), type: 'image/png' });
    } catch (e) { throw new UserError(`講義檔案暫時讀取不到（${e.message}）。請先閱讀文字版講義。`); }
    await ctx.follow({ content: `**${c.id} ${c.name}**　講義 PDF（可列印）及逐頁圖像（共 ${h.pages} 頁，可直接在 Discord 閱讀）。` }, files);
    return null;
  }
  if (act === 'start') {
    const c = COURSE[a];
    ctx.need(c, '找不到這一科。');
    ctx.need(isOpen(ctx.settings, c.id), `${c.id} 尚未開放報讀。`);
    ctx.need(!examOk(st, c.id), `你已通過 ${c.id} 的考試。`);
    const lack = c.need.filter((id) => !passed(st, id) && !examOk(st, id));
    ctx.need(!lack.length, `須先修畢 ${lack.join('、')} 才可以應考 ${c.id}。`);
    const lastFail = (st.examFail || {})[c.id] || 0, wait = lastFail + c.exam.cooldownHours * 3600e3 - Date.now();
    ctx.need(wait <= 0, `上次未合格，<t:${D.unix(lastFail + c.exam.cooldownHours * 3600e3)}:R> 才可以重考。請趁這段時間重溫講義。`);
    const qs = shuffle(c.q.map((_, i) => i)).slice(0, c.exam.draw).map((i) => ({ i, ord: shuffle([0, 1, 2, 3].slice(0, c.q[i].o.length)) }));
    const sess = { uid: ctx.uid, cid: c.id, qs, n: 0, score: 0, wrong: [], late: 0, at: Date.now(), shown: Date.now() };
    const ref = await FB.db().collection('exams').add(sess);
    return ctx.edit(questionMsg(c, ref.id, sess));
  }
  if (act === 'ans') {
    const ref = FB.db().doc('exams/' + a), snap = await ref.get();
    ctx.need(snap.exists, '這次考試已經完結。請使用 /academy 重新開始。');
    const sess = snap.data(), c = COURSE[sess.cid], n = parseInt(b, 10);
    ctx.need(sess.uid === ctx.uid, '這不是你的試卷。');
    ctx.need(Date.now() - sess.at < c.exam.totalMin * 60e3, `考試超過 ${c.exam.totalMin} 分鐘，已經作廢。請使用 /academy 重新開始。`);
    if (sess.n !== n) return null; // 連按兩下：不重複計分
    const cur = sess.qs[n], q = c.q[cur.i], pick = cur.ord[parseInt(k, 10)];
    const late = Date.now() - (sess.shown || sess.at) > (c.exam.perQuestionSec + 8) * 1000; // 預留數秒的網絡延誤
    if (late) { sess.late = (sess.late || 0) + 1; sess.wrong.push({ i: cur.i, pick, late: true }); } else if (pick === q.a) sess.score += 1; else sess.wrong.push({ i: cur.i, pick });
    sess.n += 1; sess.shown = Date.now();
    if (sess.n < sess.qs.length) { await ref.update({ n: sess.n, score: sess.score, wrong: sess.wrong, late: sess.late || 0, shown: sess.shown }); return ctx.edit(questionMsg(c, a, sess)); }
    await ref.delete();
    const ok = sess.score >= c.exam.pass;
    const review = sess.wrong.slice(0, 6).map((w) => { const x = c.q[w.i]; return `**${D.trunc(x.q, 110)}**\n${w.late ? '逾時作答' : '你的答案：' + D.trunc(x.o[w.pick], 70)}\n${D.trunc(x.why, 150)}`; }).join('\n\n');
    let awarded = [];
    const needEssay = c.essay && c.essay.required && !essayOk(st, c.id);
    if (ok) {
      await FB.saveStaff(ctx.uid, { exams: { ...(st.exams || {}), [c.id]: { score: sess.score, at: Date.now() } } });
      await ctx.log('academy', '考試合格', `${c.id} ${c.name}`, `${sess.score}／${sess.qs.length}`);
      awarded = await settle(ctx, { uid: ctx.uid, name: ctx.name, title: ctx.title });
    } else {
      await FB.saveStaff(ctx.uid, { examFail: { ...(st.examFail || {}), [c.id]: Date.now() } });
      await ctx.log('academy', '考試未合格', `${c.id} ${c.name}`, `${sess.score}／${sess.qs.length}`);
    }
    const tail = ok ? (needEssay ? '考試合格。**這一科尚須提交文章並獲評為合格才算修畢**：請回到課程頁按「撰寫文章」。' : '成績已記入你的員工檔案。') + (awarded.length ? `\n\n${ctx.em('cert')}**你已獲頒${awarded.map((x) => `《${x.zh}》`).join('、')}。** 證書已以私訊發出。` : '') : `${c.exam.cooldownHours} 小時後可以重考。`;
    return ctx.edit({ content: '', embeds: [{ color: ok ? C.ok : C.alert, author: B.head(`培訓學院｜${c.id} ${c.name}`), title: ok ? '考核合格' : '未合格', description: `成績：**${sess.score}／${sess.qs.length}**（合格線 ${c.exam.pass}）\n${tail}` + (review ? `\n\n**答錯的題目**\n\n${D.trunc(review, 3000)}` : '') }], components: [row(btn('ac:home', '課程表'))] });
  }
  throw new UserError('未支援的操作。');
}

module.exports = { home, button, cert, verify, issue, settle, course, transcript, isOpen, normSerial, verifyEmbed };
