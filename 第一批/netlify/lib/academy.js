'use strict';
// 培訓學院（第六版）：課程講義 → 考試（單選、多項選擇、排序）→ 文章／案例分析／實務評核 → 自動頒發證書及持證身份組。
// 課程之間沒有先後限制：已開放的課程，同事可以按自己的需要同時修讀；「建議先修」只作參考。
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
const ABC = ['A', 'B', 'C', 'D', 'E', 'F'];
const TYPE = { mc: '單選題', multi: '多項選擇題：選出全部正確答案', order: '排序題：按正確次序逐一點選' };

/* ---------- 狀態 ---------- */
const passed = (st, id) => !!(st && st.courses && st.courses[id]);
/** 課程必須由管理層開放後才可以報讀（/course open 或學院管理台）。 */
const isOpen = (S, id) => !!(S && S.openCourses && S.openCourses[id]);
const examOk = (st, id) => !!(st && st.exams && st.exams[id]);
const essayOk = (st, id) => !!(st && st.essays && st.essays[id] && st.essays[id].ok);
const caseOk = (st, id) => !!(st && st.essays && st.essays[id + '-CS'] && st.essays[id + '-CS'].ok);
const prOk = (st, id) => !!(st && st.practicals && st.practicals[id] && st.practicals[id].ok);
/** 修畢一科尚欠的考核項目（空陣列即修畢） */
function missing(st, c) {
  const out = [];
  if (!examOk(st, c.id)) out.push('考試');
  if (c.essay && c.essay.required && !essayOk(st, c.id)) out.push('文章');
  if (c.case && c.case.required && !caseOk(st, c.id)) out.push('案例分析');
  if (c.practical && c.practical.required && !prOk(st, c.id)) out.push('實務評核');
  return out;
}
const parts = (c) => ['考試', ...(c.essay && c.essay.required ? ['文章'] : []), ...(c.case ? ['案例分析'] : []), ...(c.practical ? ['實務評核'] : [])];
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** 連續不合格的等候時間：首次為 cooldownHours，之後每次加倍，最長 maxCooldownHours */
const cooldownMs = (c, n) => Math.min(c.exam.maxCooldownHours, c.exam.cooldownHours * 2 ** Math.max(0, (n || 1) - 1)) * 3600e3;

/* ---------- 課程表 ---------- */
function line(ctx, st, c) {
  const ok = ctx.em('ok');
  if (passed(st, c.id)) return `${ok}**${c.id}** ${c.name}｜已修畢 ${st.courses[c.id].score}／${c.exam.draw}`;
  if (!isOpen(ctx.settings, c.id)) return `**${c.id}** ${c.name}｜未開放`;
  const lack = missing(st, c), all = parts(c);
  return `**${c.id}** ${c.name}｜${lack.length === all.length ? '可報讀' : `已完成 ${all.length - lack.length}／${all.length}，尚欠${lack.join('、')}`}`;
}
function homeMsg(ctx, st, note) {
  const ok = ctx.em('ok');
  const fields = TRACKS.map((t) => ({ name: `${t.zh} ${t.en}`, value: D.trunc(COURSES.filter((c) => c.track === t.key).map((c) => line(ctx, st, c)).join('\n'), 1024) }));
  const certs = CERTS.map((k) => { const got = st && st.certs && st.certs[k.key], n = k.courses.filter((id) => passed(st, id)).length; return `${got ? ok : ''}《${k.zh}》${got ? `｜已取得 \`${got.serial}\`` : `｜${n}／${k.courses.length} 科（${k.courses.join('、')}）`}`; });
  fields.push({ name: '證書', value: D.trunc(certs.join('\n'), 1024) });
  return {
    content: note || '', embeds: [{ color: C.academy, author: B.head('培訓學院'), title: '課程及證書', description: '已開放的課程可以任意選讀，沒有先後限制；「建議先修」只作參考。每科先閱讀講義，再完成所需的考核：考試、文章、案例分析（管理系列）及實務評核（部分管理課程）。修畢一張證書所需的全部課程，系統會即時頒發證書及持證身份組。', fields, footer: { text: '基礎及專業課程：抽 12 題答對 10 題；管理課程：抽 14 題答對 12 題。題目包括多項選擇及排序題。不合格須等候 24 至 48 小時，連續不合格等候時間加倍。' } }],
    components: [
      D.select('ac:pick', '選擇課程', COURSES.map((c) => ({ label: `${c.id} ${c.name}${isOpen(ctx.settings, c.id) ? '' : '（未開放）'}`, value: c.id, description: D.trunc(`${c.exam.level}｜${parts(c).join('＋')}`, 90), emoji: passed(st, c.id) ? ctx.emo('ok') : ctx.emo('academy') }))),
      row(btn('ac:mycerts', '我的證書', 2, { emoji: ctx.emo('cert') }), btn('ac:certname', '設定證書姓名', 2, { emoji: ctx.emo('id') })),
    ],
  };
}
function pageMsg(ctx, c, n, st) {
  n = Math.max(0, Math.min(c.material.length - 1, n));
  const m = c.material[n], last = n === c.material.length - 1, h = HANDOUTS[c.id];
  const btns = [btn(`ac:pg:${c.id}:${n - 1}`, '上一頁', 2, { disabled: n === 0 }), btn(`ac:pg:${c.id}:${n + 1}`, '下一頁', 2, { disabled: last }), btn(`ac:start:${c.id}`, examOk(st, c.id) ? '考試已合格' : '開始考試', last ? 3 : 2, { emoji: ctx.emo('edit'), disabled: examOk(st, c.id) })];
  const more = [];
  if (c.essay) more.push(btn(`ac:essay:${c.id}`, c.essay.required ? '撰寫文章（必須）' : '撰寫文章', 2, { emoji: ctx.emo('doc'), disabled: essayOk(st, c.id) }));
  if (c.case) more.push(btn(`ac:case:${c.id}`, '案例分析（必須）', 2, { emoji: ctx.emo('doc'), disabled: caseOk(st, c.id) }));
  if (c.practical) more.push(btn(`ac:prac:${c.id}`, '預約實務評核', 2, { emoji: ctx.emo('team'), disabled: prOk(st, c.id) }));
  if (h) more.push(btn(`ac:file:${c.id}`, '講義檔案', 2, { emoji: ctx.emo('doc') }));
  more.push(btn('ac:home', '課程表'));
  const f = [];
  if (last) {
    f.push({ name: `考試（${c.exam.level}程度）`, value: `每次由 ${c.q.length} 題中抽 ${c.exam.draw} 題，最少 ${c.exam.hard} 題為高難度題（多項選擇、排序或情境題）；答對 ${c.exam.pass} 題合格。單選題每題 ${c.exam.perQuestionSec} 秒，多項選擇及排序題每題 ${c.exam.longSec} 秒，全卷 ${c.exam.totalMin} 分鐘。` });
    if (c.essay) f.push({ name: `文章${c.essay.required ? '（必須合格才算修畢）' : '（選做）'}`, value: `${c.essay.prompt}\n最少 ${c.essay.min} 字。評分重點共 ${c.essay.keywords.length} 項。` });
    if (c.case) f.push({ name: '案例分析（必須合格才算修畢）', value: D.trunc(`${c.case.prompt}\n評分重點共 ${c.case.keywords.length} 項，由經理或以上或學院評核員評分。`, 1024) });
    if (c.practical) f.push({ name: `實務評核：${c.practical.title}（必須，須先通過考試）`, value: D.trunc(`${c.practical.task}\n\n準則：${c.practical.criteria.join('；')}`, 1024) });
  }
  return {
    content: '', embeds: [{ color: C.academy, author: B.head(`培訓學院｜${c.id} ${c.name}`), title: m.h, description: m.t, fields: f, footer: { text: `講義第 ${n + 1}／${c.material.length} 頁｜修畢要求：${parts(c).join('＋')}${c.need.length ? `｜建議先修：${c.need.join('、')}` : ''}` } }],
    components: [row(...btns), row(...more)],
  };
}

/* ---------- 題目 ---------- */
const limitSec = (c, q) => (q.t === 'mc' ? c.exam.perQuestionSec : c.exam.longSec);
function questionMsg(c, sid, sess) {
  const cur = sess.qs[sess.n], q = c.q[cur.i], picks = sess.picks || [];
  const opts = cur.ord.map((k, x) => `**${ABC[x]}.** ${q.o[k]}`).join('\n');
  const desc = `**${q.q}**\n\n${opts}` + (q.t === 'order' ? `\n\n已選次序：${picks.length ? picks.map((x) => ABC[x]).join(' → ') : '（未選）'}` : '');
  let comps;
  if (q.t === 'multi') comps = [D.select(`ac:ms:${sid}:${sess.n}`, '選出全部正確答案（可多選）', cur.ord.map((k, x) => ({ label: `${ABC[x]}. ${D.trunc(q.o[k], 90)}`, value: String(x) })), { min: 1, max: cur.ord.length })];
  else if (q.t === 'order') {
    const b = cur.ord.map((_, x) => btn(`ac:od:${sid}:${sess.n}:${x}`, ABC[x], 1, { disabled: picks.includes(x) }));
    comps = [row(...b.slice(0, 5)), row(...b.slice(5), btn(`ac:or:${sid}:${sess.n}`, '重選', 2, { disabled: !picks.length }))];
  } else comps = [row(...cur.ord.map((_, x) => btn(`ac:ans:${sid}:${sess.n}:${x}`, ABC[x], 1)))];
  return {
    content: '', embeds: [{ color: C.academy, author: B.head(`培訓學院｜${c.id} ${c.name}`), title: `第 ${sess.n + 1}／${sess.qs.length} 題｜${TYPE[q.t]}`, description: desc, footer: { text: `本題限時 ${limitSec(c, q)} 秒，逾時作答當作答錯。考核須獨立完成，不得使用人工智能工具、翻查資料或請人代答。` } }],
    components: comps,
  };
}
/** 抽題：先由高難度題抽出最少 hard 題，再由其餘題目補足，最後打亂次序。 */
function draw(c) {
  const idx = c.q.map((_, i) => i), hard = shuffle(idx.filter((i) => c.q[i].lv === 2)).slice(0, c.exam.hard);
  const rest = shuffle(idx.filter((i) => !hard.includes(i))).slice(0, c.exam.draw - hard.length);
  return shuffle([...hard, ...rest]).map((i) => ({ i, ord: shuffle(c.q[i].o.map((_, k) => k)) }));
}
/** 判斷答案。pick：mc 為顯示位置；multi 為顯示位置陣列；order 為依次點選的顯示位置陣列。 */
function correct(q, cur, pick) {
  if (q.t === 'multi') { const got = [...new Set(pick.map((x) => cur.ord[x]))].sort(), want = [...q.a].sort(); return got.length === want.length && got.every((v, n) => v === want[n]); }
  if (q.t === 'order') return pick.length === q.o.length && pick.every((x, n) => cur.ord[x] === n);
  return cur.ord[pick] === q.a;
}

async function home(ctx) {
  ctx.need(ctx.g > 0, '培訓學院只開放予本公司員工。有意加入可到「職位空缺」頻道應徵。');
  return ctx.edit(homeMsg(ctx, ctx.staff));
}

/* ---------- 證書 ---------- */
/** 取得某位成員的後備名稱（Discord 顯示名稱、用戶名稱），用於證書姓名無法顯示時 */
async function altNames(ctx, uid) {
  if (uid === ctx.uid) return [ctx.name, ...(ctx.nameAlts || [])];
  try { const m = await D.api('GET', `/guilds/${ctx.guild}/members/${uid}`); return [m.nick, m.user && m.user.global_name, m.user && m.user.username].filter(Boolean); } catch { return []; }
}
/** 證書上印的姓名：證書姓名（/cert name）優先；否則由 Discord 名稱還原為可印出的字元 */
async function printName(ctx, uid, st, fallback) {
  const alts = await altNames(ctx, uid);
  try { const DOC = require('./docs'), f = await DOC.font(); return DOC.nm(f, (st && st.certName) || fallback || alts[0], alts, fallback || alts[0] || '持證人'); } catch { return (st && st.certName) || fallback || alts[0] || '持證人'; }
}
async function roleOp(ctx, method, uid, roleId) {
  if (!roleId) return false;
  try { await D.api(method, `/guilds/${ctx.guild}/members/${uid}/roles/${roleId}`, null, null, { reason: '近觀者培訓學院：持證身份組' }); return true; } catch (e) { console.log('cert role failed', e.message); return false; }
}
/** 頒發證書：寫入紀錄、派發持證身份組、製作圖像及 PDF、在「證書頒授」頻道公佈、私訊持有人。圖像製作失敗時仍然頒發（只發文字）。 */
async function issue(ctx, who, st, k) {
  const now = Date.now(), year = D.ymd(now).slice(0, 4);
  const serial = `CVC-${year}-${FB.pad(await FB.next('cert-' + year))}`;
  const name = await printName(ctx, who.uid, st, who.name);
  const rec = { serial, uid: who.uid, name, rawName: who.name, no: st.no || '', key: k.key, zh: k.zh, en: k.en, courses: k.courses, at: now, status: 'valid' };
  await FB.setDoc('certs/' + serial, rec);
  await roleOp(ctx, 'PUT', who.uid, (ctx.settings.certRoles || {})[k.key]);
  const files = await render(rec);
  await announce(ctx, rec, who, files, false);
  await D.dm(who.uid, { embeds: [{ ...certEmbed(ctx, rec, who, files), description: `恭喜你獲頒 **${k.zh}**（${k.en}）。證書圖像及 PDF 已附上，日後可使用 \`/cert show\` 重新領取。證書上的姓名是「${name}」；如需更改，請用 \`/cert name\` 設定後以 \`/cert reissue\` 重新製作。` }] }, files);
  await ctx.log('academy', '頒發證書', serial, `${name}｜《${k.zh}》`);
  return { serial, at: now };
}
function certEmbed(ctx, rec, who, files, again) {
  const e = { color: C.academy, author: B.head('培訓學院'), title: `${again ? '補發' : '頒授'}《${rec.zh}》`, description: `${ctx.em('cert')}<@${rec.uid}>${who && who.title ? `（${who.title}）` : ''}已修畢 ${rec.courses.join('、')}，獲頒 **${rec.zh}**（${rec.en}）。${again ? '\n本證書已按更正後的資料重新製作，證書編號不變，原有圖像作廢。' : ''}`, fields: [{ name: '證書編號', value: `\`${rec.serial}\``, inline: true }, { name: '頒發日期', value: D.ymd(rec.at), inline: true }, { name: '持證人', value: rec.name, inline: true }], footer: { text: '可在公司網站「證書核實」頁以編號核實。' } };
  if (files) e.image = { url: `attachment://${rec.serial}.png` };
  return e;
}
async function announce(ctx, rec, who, files, again) {
  const ch = ctx.settings.channels.certs;
  if (!ch) return;
  try { await D.api('POST', `/channels/${ch}/messages`, { embeds: [certEmbed(ctx, rec, who, files, again)], allowed_mentions: { parse: [] } }, files ? [files[0]] : null); } catch (err) { console.log('cert post failed', err.message); }
}
/**
 * 結算：所有必須的考核項目都合格的課程記為修畢，並頒發新符合資格的證書。回傳新頒發的證書。
 * 考試合格、文章或案例分析獲評合格、實務評核合格後都會呼叫；who 為該同事（評卷時並非操作者本人）。
 */
async function settle(ctx, who) {
  const st = (await FB.getStaff(who.uid)) || {}, courses = { ...(st.courses || {}) }, certs = { ...(st.certs || {}) }, awarded = [];
  for (const c of COURSES) if (!courses[c.id] && !missing(st, c).length) courses[c.id] = { ...st.exams[c.id], done: Date.now() };
  await FB.saveStaff(who.uid, { courses });
  for (const kc of CERTS) if (!certs[kc.key] && kc.courses.every((id) => courses[id])) { certs[kc.key] = await issue(ctx, who, st, kc); awarded.push(kc); }
  if (awarded.length) await FB.saveStaff(who.uid, { certs });
  return awarded;
}
/** 製作證書檔案：[PNG, PDF]；失敗時回傳 null */
async function render(rec) {
  try {
    const chair = (await FB.db().collection('staff').where('rank', '==', 'chairman').get()).docs.map((d) => d.data()).find((s) => s.active);
    const doc = await require('./docs').certificate({ name: rec.name, alts: [rec.rawName].filter(Boolean), zh: rec.zh, en: rec.en, serial: rec.serial, date: D.zhDate(rec.at), courses: rec.courses.map((id) => `${id}　${COURSE[id].name}　${COURSE[id].en}`), signer: chair ? chair.certName || chair.name : '' });
    return [{ name: `${rec.serial}.png`, data: doc.png, type: 'image/png' }, { name: `${rec.serial}.pdf`, data: doc.pdf, type: 'application/pdf' }];
  } catch (e) { console.log('cert render failed', e.message); return null; }
}
const normSerial = (x) => { const m = /(\d{4})\D*(\d{1,6})\s*$/.exec(String(x || '')); return m ? `CVC-${m[1]}-${FB.pad(parseInt(m[2], 10))}` : ''; };
const verifyEmbed = (rec, serial) => (rec
  ? { color: rec.status === 'valid' ? C.ok : C.alert, author: B.head('證書核實'), title: rec.status === 'valid' ? '證書有效' : '證書已撤銷', fields: [{ name: '證書編號', value: `\`${rec.serial}\``, inline: true }, { name: '頒發日期', value: D.ymd(rec.at), inline: true }, { name: '持有人', value: rec.name || '—', inline: true }, { name: '證書', value: `${rec.zh}\n${rec.en}` }, { name: '修畢課程', value: rec.courses.map((id) => `${id} ${COURSE[id] ? COURSE[id].name : ''}`).join('\n') }, ...(rec.status !== 'valid' ? [{ name: '撤銷原因', value: rec.revokeReason || '—' }] : [])] }
  : { color: C.alert, author: B.head('證書核實'), title: '找不到這張證書', description: `本公司沒有編號為 \`${serial || '（格式不正確）'}\` 的證書紀錄。證書編號的格式為 CVC-年份-四位數字，例如 CVC-2026-0001。` });

/** /verify：任何人都可以核實證書 */
async function verify(ctx) {
  const serial = normSerial(ctx.opt('serial'));
  return ctx.edit({ embeds: [verifyEmbed(serial ? await FB.getDoc('certs/' + serial) : null, serial)] });
}
async function myCerts(ctx, uid) {
  const all = (await FB.db().collection('certs').where('uid', '==', uid).get()).docs.map((d) => d.data()).sort((a, b) => a.at - b.at);
  const st = (await FB.getStaff(uid)) || {};
  return { embeds: [{ color: C.academy, author: B.head('培訓學院'), title: uid === ctx.uid ? '我的證書' : '證書紀錄', description: all.length ? all.map((r) => `\`${r.serial}\`《${r.zh}》｜${D.ymd(r.at)}｜持證人：${r.name}${r.status !== 'valid' ? '｜已撤銷' : ''}`).join('\n') : '尚未取得任何證書。使用 `/academy` 開始修讀。', fields: [{ name: '證書姓名', value: st.certName ? `${st.certName}（已設定）` : '未設定：系統會使用你的 Discord 名稱，並自動刪去花式字體及表情符號。可用 `/cert name` 或「設定證書姓名」按鈕設定。' }] }] };
}
/** 設定證書姓名：本人，或人力資源代為設定。回傳錯誤或確認訊息。 */
async function setCertName(ctx, uid, name) {
  name = String(name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  let f = null;
  try { f = await require('./docs').font(); } catch { /* 字形檔讀取不到時只作基本檢查 */ }
  const err = require('./names').validate(name, f);
  ctx.need(!err, err);
  await FB.saveStaff(uid, { certName: name });
  await ctx.log('academy', '設定證書姓名', name, uid === ctx.uid ? '本人' : `代 <@${uid}> 設定`);
  const n = (await FB.db().collection('certs').where('uid', '==', uid).get()).docs.filter((d) => d.data().status === 'valid').length;
  return `已把證書姓名設定為「${name}」。之後頒發的證書、員工證會使用這個姓名。${n ? `已取得的 ${n} 張證書，可用 \`/cert reissue\` 按新姓名重新製作。` : ''}`;
}
async function certNameSubmit(ctx) {
  ctx.need(ctx.g > 0, '只有本公司員工可以設定證書姓名。');
  return ctx.edit(await setCertName(ctx, ctx.uid, ctx.fields.name));
}
/** 補發：按現時的證書姓名重新製作，編號不變，並在證書頒授頻道公佈更正。 */
async function reissue(ctx, rec) {
  ctx.need(rec.uid === ctx.uid || ORG.can.hr(ctx) || ORG.can.academy(ctx), '只有持有人、人力資源或學院管理人員可以補發證書。');
  ctx.need(rec.status === 'valid', '這張證書已被撤銷。');
  ctx.need(!rec.reissuedAt || Date.now() - rec.reissuedAt > 600e3 || ORG.can.hr(ctx), '這張證書剛剛補發過，請十分鐘後再試。');
  const st = (await FB.getStaff(rec.uid)) || {}, name = await printName(ctx, rec.uid, st, st.certName || rec.rawName || rec.name);
  const upd = { ...rec, name, reissuedAt: Date.now(), reissues: (rec.reissues || 0) + 1, reissuedBy: ctx.name };
  await FB.setDoc('certs/' + rec.serial, { name, reissuedAt: upd.reissuedAt, reissues: upd.reissues, reissuedBy: ctx.name });
  const files = await render(upd);
  ctx.need(files, '證書檔案暫時未能製作，請稍後再試；如持續出現，請通知資訊科技部。');
  await announce(ctx, upd, null, files, true);
  if (rec.uid !== ctx.uid) await D.dm(rec.uid, { embeds: [{ ...certEmbed(ctx, upd, null, files, true), description: `你的《${rec.zh}》已由 ${ctx.name} 重新製作，持證人姓名為「${name}」。新的圖像及 PDF 已附上。` }] }, files);
  await ctx.log('academy', '補發證書', rec.serial, `${rec.name || '（空白）'} → ${name}`);
  return ctx.edit({ content: `已重新製作 ${rec.serial}，持證人姓名為「${name}」，並已在證書頒授頻道公佈。`, embeds: [{ ...verifyEmbed(upd), image: { url: `attachment://${rec.serial}.png` } }] }, files);
}
/** 同步持證身份組：按有效證書紀錄派發，撤銷的收回。用於第六版之前已頒發的證書，或身份組被人手移除後。 */
async function syncRoles(ctx) {
  ctx.need(ORG.can.hr(ctx) || ORG.can.academy(ctx), '只有人力資源或學院管理人員可以同步持證身份組。');
  const R = ctx.settings.certRoles || {};
  ctx.need(Object.keys(R).length, '尚未建立持證身份組。請管理員執行 /setup auto。');
  const all = (await FB.db().collection('certs').get()).docs.map((d) => d.data());
  let add = 0, del = 0, fail = 0;
  for (const r of all) { const ok = await roleOp(ctx, r.status === 'valid' ? 'PUT' : 'DELETE', r.uid, R[r.key]); if (!ok) fail++; else if (r.status === 'valid') add++; else del++; }
  await ctx.log('academy', '同步持證身份組', '', `派發 ${add}｜收回 ${del}｜失敗 ${fail}`);
  return `已同步 ${all.length} 張證書的持證身份組：派發 ${add} 個，收回 ${del} 個${fail ? `，${fail} 個未能處理（對方可能已離開伺服器，或機器人的身份組排位不夠高）` : ''}。`;
}

/** /cert list｜show｜revoke｜name｜reissue｜sync */
async function cert(ctx) {
  ctx.need(ctx.g > 0, '只有本公司員工可以使用這個指令。公眾核實證書請用 /verify。');
  if (ctx.sub === 'list') return ctx.edit(await myCerts(ctx, ctx.opt('user') || ctx.uid));
  if (ctx.sub === 'name') {
    const uid = ctx.opt('user') || ctx.uid;
    ctx.need(uid === ctx.uid || ORG.can.hr(ctx), '只可以設定自己的證書姓名；代他人設定只限人力資源。');
    return ctx.edit(await setCertName(ctx, uid, ctx.opt('name')));
  }
  if (ctx.sub === 'sync') return ctx.edit(await syncRoles(ctx));
  const serial = normSerial(ctx.opt('serial')), rec = serial && (await FB.getDoc('certs/' + serial));
  ctx.need(rec, `找不到證書 ${serial || ctx.opt('serial')}。`);
  if (ctx.sub === 'reissue') return reissue(ctx, rec);
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
    await roleOp(ctx, 'DELETE', rec.uid, (ctx.settings.certRoles || {})[rec.key]);
    await ctx.log('academy', '撤銷證書', serial, `${rec.name}｜${ctx.opt('reason')}`);
    return ctx.edit(`已撤銷證書 ${serial}，並收回持證身份組。網站及 /verify 會顯示為已撤銷。`);
  }
  throw new UserError('未支援的指令。');
}

/* ---------- 開放及關閉課程、評核員 /course ---------- */
async function setOpen(ctx, ids, on) {
  const S = ctx.settings, open = { ...(S.openCourses || {}) }, list = ids.map((id) => COURSE[id]).filter(Boolean);
  ctx.need(list.length, '找不到這一科。');
  const changed = list.filter((c) => !!open[c.id] !== on);
  for (const c of list) { if (on) open[c.id] = true; else delete open[c.id]; }
  await FB.db().doc('settings/main').update({ openCourses: open });
  S.openCourses = open;
  if (!changed.length) return `所選課程本來已經${on ? '開放' : '關閉'}。`;
  await ctx.log('academy', on ? '開放課程' : '關閉課程', changed.map((c) => c.id).join('、'), '');
  const ch = S.channels.staffnotice;
  if (on && ch) { try { await D.api('POST', `/channels/${ch}/messages`, { embeds: [{ color: C.academy, author: B.head('培訓學院'), title: '課程開放報讀', description: D.trunc(changed.map((c) => `**${c.id}** ${c.name}　${c.en}\n${c.intro}\n修畢要求：${parts(c).join('＋')}`).join('\n\n'), 4000), footer: { text: `使用 /academy 或到「培訓學院」頻道報讀｜${ctx.name}　${ctx.title}` }, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } }); } catch (e) { console.log('course notice failed', e.message); } }
  return `已${on ? '開放' : '關閉'}：${changed.map((c) => `${c.id} ${c.name}`).join('、')}。${on && ch ? `已在 <#${ch}> 公佈。` : ''}${on ? '' : '已修畢的同事不受影響；正在修讀的同事須待重新開放才可繼續。'}`;
}
async function examiner(ctx) {
  ctx.need(ORG.can.hr(ctx) || ORG.can.academy(ctx), '只有人力資源或學院管理人員可以委任評核員。');
  const HR = require('./hr'), t = HR.target(ctx), on = ctx.opt('on') !== false;
  ctx.need(t.g > 0, `${t.name} 不是本公司員工。`);
  ctx.need(!on || t.g >= 3, '評核員須為高級職員或以上。');
  const id = ctx.settings.examinerRole;
  ctx.need(id, '尚未建立評核員身份組。請管理員執行 /setup auto。');
  ctx.need(await roleOp(ctx, on ? 'PUT' : 'DELETE', t.id, id), '未能更改身份組。請確認機器人的身份組排在評核員身份組之上。');
  await FB.saveStaff(t.id, { examiner: on });
  await ctx.log('academy', on ? '委任評核員' : '解除評核員', t.name, '');
  return ctx.edit(`已${on ? '委任' : '解除'} ${t.name} ${on ? '為' : '的'}學院評核員。${on ? '評核員可以在評卷台評文章及案例分析，並主持實務評核；不可以評核自己。' : ''}`);
}
async function course(ctx) {
  const S = ctx.settings, open = S.openCourses || {};
  if (ctx.sub === 'status') { ctx.need(ctx.g > 0, '只有本公司員工可以查看。'); return ctx.edit({ embeds: [{ color: C.academy, author: B.head('培訓學院'), title: '課程開放狀況', description: COURSES.map((c) => `**${c.id}** ${c.name}｜${open[c.id] ? '已開放' : '未開放'}｜${parts(c).join('＋')}`).join('\n'), footer: { text: '人力資源及行政部助理經理或以上、總監或以上可用 /course open 及 /course close 更改，或使用學院管理台。' } }] }); }
  if (ctx.sub === 'examiner') return examiner(ctx);
  if (ctx.sub === 'panel') { ctx.need(ORG.can.academy(ctx) || ORG.can.examine(ctx), '只有學院管理人員或評核員可以使用學院管理台。'); return ctx.edit(await adminMsg(ctx, 'menu')); }
  ctx.need(ORG.can.academy(ctx), '只有人力資源及行政部的助理經理或以上，或總監或以上，可以開放或關閉課程。');
  const id = ctx.opt('id');
  return ctx.edit(await setOpen(ctx, id === 'all' ? COURSES.map((c) => c.id) : [id], ctx.sub === 'open'));
}

/* ---------- 學院管理台（內部管理面板） ---------- */
async function adminMsg(ctx, what) {
  const S = ctx.settings, open = S.openCourses || {};
  const head = { color: C.academy, author: B.head('培訓學院｜學院管理台') };
  if (what === 'open' || what === 'close') {
    const on = what === 'open', list = COURSES.filter((c) => !!open[c.id] !== on);
    if (!list.length) return { content: on ? '全部課程已經開放。' : '目前沒有已開放的課程。', embeds: [], components: [] };
    return { content: `選擇要${on ? '開放' : '關閉'}的課程（可多選）。`, embeds: [], components: [D.select(`aa:${what}`, `選擇要${on ? '開放' : '關閉'}的課程`, list.map((c) => ({ label: `${c.id} ${c.name}`, value: c.id, description: D.trunc(`${c.exam.level}｜${parts(c).join('＋')}`, 90) })), { min: 1, max: list.length })] };
  }
  if (what === 'queue') {
    const all = (n) => FB.db().collection(n).get().then((s) => s.docs.map((d) => d.data()));
    const [es, pr] = await Promise.all([all('essays'), all('practicals')]);
    const pe = es.filter((e) => e.status === 'pending').sort((a, b) => a.at - b.at), pp = pr.filter((p) => p.status === 'open' || p.status === 'claimed').sort((a, b) => a.at - b.at);
    const age = (t) => `${Math.floor((Date.now() - t) / 3600e3)} 小時`;
    const link = (x) => (x.channelId && x.msgId ? `https://discord.com/channels/${ctx.guild}/${x.channelId}/${x.msgId}` : '');
    return { content: '', embeds: [{ ...head, title: '評核隊列', fields: [
      { name: `待評文章（${pe.filter((e) => (e.kind || 'essay') === 'essay').length}）`, value: D.trunc(pe.filter((e) => (e.kind || 'essay') === 'essay').map((e) => `[${e.id}](${link(e)}) ${e.cid} ${e.name}｜已等 ${age(e.at)}${e.flag ? '｜須口試' : ''}`).join('\n') || '沒有', 1024) },
      { name: `待評案例分析（${pe.filter((e) => e.kind === 'case').length}）`, value: D.trunc(pe.filter((e) => e.kind === 'case').map((e) => `[${e.id}](${link(e)}) ${e.cid} ${e.name}｜已等 ${age(e.at)}${e.flag ? '｜須口試' : ''}`).join('\n') || '沒有', 1024) },
      { name: `實務評核（${pp.length}）`, value: D.trunc(pp.map((p) => `[${p.id}](${link(p)}) ${p.cid} ${p.name}｜${p.status === 'open' ? '待接手' : `評核中：${p.byName}`}｜已等 ${age(p.at)}`).join('\n') || '沒有', 1024) },
    ], footer: { text: '超過 72 小時未處理的項目會列入每日提醒。' } }], components: [] };
  }
  if (what === 'stats') {
    const staff = (await FB.db().collection('staff').get()).docs.map((d) => d.data()).filter((s) => s.active);
    const certs = (await FB.db().collection('certs').get()).docs.map((d) => d.data()).filter((r) => r.status === 'valid');
    const rows = COURSES.map((c) => { const ex = staff.filter((s) => examOk(s, c.id)).length, done = staff.filter((s) => passed(s, c.id)).length, fail = staff.filter((s) => (s.examFailN || {})[c.id]).length; return `**${c.id}**｜${open[c.id] ? '開放' : '關閉'}｜考試合格 ${ex}｜修畢 ${done}｜正在重考 ${fail}`; });
    return { content: '', embeds: [{ ...head, title: '學院統計', description: D.trunc(rows.join('\n'), 4000), fields: [{ name: `有效證書（${certs.length}）`, value: CERTS.map((k) => `《${k.zh}》${certs.filter((r) => r.key === k.key).length}`).join('\n') }, { name: '在職員工', value: `${staff.length} 人；評核員 ${staff.filter((s) => s.examiner).length} 人`, inline: true }] }], components: [] };
  }
  if (what === 'sync') return { content: await syncRoles(ctx), embeds: [], components: [] };
  // menu：與面板相同的按鈕，供 /course panel 使用
  return { content: '', embeds: [adminEmbed()], components: adminButtons(ctx) };
}
const adminEmbed = () => ({ color: C.academy, author: B.head('培訓學院｜學院管理台'), title: '學院管理', description: '開放及關閉課程、查看評核隊列、學院統計及同步持證身份組。所有回覆只有你自己看得到，所有操作都寫入培訓紀錄。', fields: [
  { name: '課程', value: '開放後會在員工通告公佈；關閉不影響已修畢的同事。' },
  { name: '評核', value: '文章由助理經理或以上評分；案例分析及實務評核由經理或以上，或學院評核員負責。委任評核員：`/course examiner`。' },
  { name: '證書', value: '姓名有誤：`/cert reissue` 按證書姓名重新製作；撤銷：`/cert revoke`；舊證書補發身份組：按「同步持證身份組」。' },
] });
const adminButtons = (ctx) => [row(btn('p:aa:open', '開放課程', 3, { emoji: ctx.emo('academy') }), btn('p:aa:close', '關閉課程', 2), btn('p:aa:queue', '評核隊列', 1, { emoji: ctx.emo('review') }), btn('p:aa:stats', '學院統計', 2, { emoji: ctx.emo('log') }), btn('p:aa:sync', '同步持證身份組', 2, { emoji: ctx.emo('cert') }))];
/** 面板按鈕 p:aa:<動作>（另發只有本人可見的回覆） */
async function adminPanel(ctx) {
  const what = ctx.cid[2];
  if (what === 'queue') ctx.need(ORG.can.examine(ctx) || ORG.can.academy(ctx), '只有評卷人員或學院管理人員可以查看評核隊列。');
  else ctx.need(ORG.can.academy(ctx) || (what === 'sync' && ORG.can.hr(ctx)), '只有人力資源及行政部的助理經理或以上，或總監或以上，可以使用學院管理台。');
  return ctx.edit(await adminMsg(ctx, what));
}
/** 管理台選單 aa:open｜aa:close（修改同一則回覆） */
async function adminButton(ctx) {
  ctx.need(ORG.can.academy(ctx), '只有人力資源及行政部的助理經理或以上，或總監或以上，可以開放或關閉課程。');
  const on = ctx.cid[1] === 'open';
  return ctx.edit({ content: await setOpen(ctx, ctx.values, on), embeds: [], components: [] });
}

/** 成績單（PNG 及 PDF）：列出已修畢課程、成績、文章及案例評級、實務評核及證書 */
async function transcript(ctx) {
  const HR = require('./hr'), other = ctx.opt('user');
  const t = other ? HR.target(ctx) : { id: ctx.uid, name: ctx.name, alts: ctx.nameAlts, rank: ctx.rank, g: ctx.g, dept: ctx.dept };
  ctx.need(t.g > 0, '只有本公司員工有成績單。');
  ctx.need(t.id === ctx.uid || ORG.can.hr(ctx) || ORG.can.academy(ctx), '只可以領取自己的成績單。');
  const st = (await FB.getStaff(t.id)) || {}, done = COURSES.filter((c) => passed(st, c.id));
  ctx.need(done.length, '尚未修畢任何課程。');
  const g = (e) => (e.grade === 'dist' ? '優異' : '合格');
  const lines = done.map((c) => `${c.id}　${c.name}　考試 ${st.courses[c.id].score}／${c.exam.draw}${essayOk(st, c.id) ? `　文章${g(st.essays[c.id])}` : ''}${caseOk(st, c.id) ? `　案例${g(st.essays[c.id + '-CS'])}` : ''}${prOk(st, c.id) ? '　實務合格' : ''}`);
  const certs = CERTS.filter((k) => st.certs && st.certs[k.key]).map((k) => `《${k.zh}》${st.certs[k.key].serial}`);
  const year = D.ymd(Date.now()).slice(0, 4), ref = `AC/${year}/${FB.pad(await FB.next('transcript-' + year))}`;
  const doc = await require('./docs').letter({ ref, date: D.zhDate(Date.now()), to: st.certName || t.name, toAlts: [t.name, ...(t.alts || [])], toLine: `${ORG.title(t.rank, t.dept)}（員工編號 ${st.no || '—'}）`, subject: '培訓成績單', paras: [`茲證明上述員工已修畢本公司培訓學院以下 ${done.length} 科課程：`, lines.join('\n'), certs.length ? '已取得證書：\n' + certs.join('\n') : '尚未取得證書。', '本成績單由系統按考核紀錄發出。'], signName: '培訓學院', signTitle: 'Academy', unit: '' });
  const fn = ref.replace(/\//g, '-');
  return ctx.edit({ embeds: [{ color: C.academy, author: B.head('培訓學院'), title: `培訓成績單｜${t.name}`, description: `已修畢 ${done.length}／${COURSES.length} 科；證書 ${certs.length} 張。`, image: { url: `attachment://${fn}.png` }, footer: { text: `檔號 ${ref}` } }] }, [{ name: fn + '.png', data: doc.png, type: 'image/png' }, { name: fn + '.pdf', data: doc.pdf, type: 'application/pdf' }]);
}

/* ---------- 講義及考試 ---------- */
async function button(ctx) {
  ctx.need(ctx.g > 0, '培訓學院只開放予本公司員工。');
  const [, act, a, b, k] = ctx.cid, st = ctx.staff || {};
  if (act === 'home') return ctx.edit(homeMsg(ctx, st));
  if (act === 'mycerts') { await ctx.follow(await myCerts(ctx, ctx.uid)); return null; }
  if (act === 'pick' || act === 'pg') {
    const c = COURSE[act === 'pick' ? ctx.values[0] : a];
    ctx.need(c, '找不到這一科。');
    ctx.need(isOpen(ctx.settings, c.id), `${c.id}《${c.name}》尚未開放報讀。管理層開放後會在「員工通告」公佈。`);
    return ctx.edit(pageMsg(ctx, c, act === 'pick' ? 0 : parseInt(b, 10) || 0, st));
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
  if (act === 'prac') {
    const c = COURSE[a];
    ctx.need(c, '找不到這一科。');
    ctx.need(isOpen(ctx.settings, c.id), `${c.id} 尚未開放報讀。`);
    await require('./practical').book(ctx, c);
    return null;
  }
  if (act === 'start') {
    const c = COURSE[a];
    ctx.need(c, '找不到這一科。');
    ctx.need(isOpen(ctx.settings, c.id), `${c.id} 尚未開放報讀。`);
    ctx.need(!examOk(st, c.id), `你已通過 ${c.id} 的考試。`);
    const lastFail = (st.examFail || {})[c.id] || 0, until = lastFail + cooldownMs(c, (st.examFailN || {})[c.id]);
    ctx.need(until <= Date.now(), `上次未合格，<t:${D.unix(until)}:R> 才可以重考。請趁這段時間重溫講義。連續不合格，等候時間會加倍。`);
    const open = (await FB.db().collection('exams').where('uid', '==', ctx.uid).get()).docs.map((d) => d.data()).find((x) => x.cid === c.id && Date.now() - x.at < c.exam.totalMin * 60e3);
    ctx.need(!open, `你已有一份 ${c.id} 的試卷正在進行。請完成該份試卷，或等 ${c.exam.totalMin} 分鐘後作廢再重新開始。`);
    const sess = { uid: ctx.uid, cid: c.id, qs: draw(c), n: 0, score: 0, wrong: [], late: 0, picks: [], at: Date.now(), shown: Date.now() };
    const ref = await FB.db().collection('exams').add(sess);
    return ctx.edit(questionMsg(c, ref.id, sess));
  }
  if (act === 'ans' || act === 'ms' || act === 'od' || act === 'or') return answer(ctx, act, a, b, k, st);
  throw new UserError('未支援的操作。');
}

async function answer(ctx, act, sid, nStr, k, st) {
  const ref = FB.db().doc('exams/' + sid), snap = await ref.get();
  ctx.need(snap.exists, '這次考試已經完結。請使用 /academy 重新開始。');
  const sess = snap.data(), c = COURSE[sess.cid], n = parseInt(nStr, 10);
  ctx.need(sess.uid === ctx.uid, '這不是你的試卷。');
  if (Date.now() - sess.at >= c.exam.totalMin * 60e3) { await ref.delete(); return finish(ctx, c, { ...sess, expired: true }, st); }
  if (sess.n !== n) return null; // 連按兩下：不重複計分
  const cur = sess.qs[n], q = c.q[cur.i];
  let pick;
  if (act === 'or') { ctx.need(q.t === 'order', '未支援的操作。'); sess.picks = []; await ref.update({ picks: [] }); return ctx.edit(questionMsg(c, sid, sess)); }
  if (act === 'od') {
    ctx.need(q.t === 'order', '未支援的操作。');
    const x = parseInt(k, 10), picks = sess.picks || [];
    if (picks.includes(x) || !(x >= 0 && x < q.o.length)) return null;
    picks.push(x); sess.picks = picks;
    if (picks.length < q.o.length) { await ref.update({ picks }); return ctx.edit(questionMsg(c, sid, sess)); }
    pick = picks;
  } else if (act === 'ms') { ctx.need(q.t === 'multi', '未支援的操作。'); pick = ctx.values.map((v) => parseInt(v, 10)).filter((v) => v >= 0 && v < q.o.length); }
  else { ctx.need(q.t === 'mc', '未支援的操作。'); pick = parseInt(k, 10); }
  const late = Date.now() - (sess.shown || sess.at) > (limitSec(c, q) + 8) * 1000; // 預留數秒的網絡延誤
  if (late) { sess.late = (sess.late || 0) + 1; sess.wrong.push({ i: cur.i, late: true }); } else if (correct(q, cur, pick)) sess.score += 1; else sess.wrong.push({ i: cur.i });
  sess.n += 1; sess.shown = Date.now(); sess.picks = [];
  if (sess.n < sess.qs.length) { await ref.update({ n: sess.n, score: sess.score, wrong: sess.wrong, late: sess.late || 0, shown: sess.shown, picks: [] }); return ctx.edit(questionMsg(c, sid, sess)); }
  await ref.delete();
  return finish(ctx, c, sess, st);
}

/** 交卷：記錄成績、計算等候時間、結算修畢及證書。答錯的題目只列出題目，不顯示答案或解釋。 */
async function finish(ctx, c, sess, st) {
  const ok = !sess.expired && sess.score >= c.exam.pass;
  let awarded = [], tail;
  if (ok) {
    const fails = { ...(st.examFailN || {}) }; delete fails[c.id];
    await FB.saveStaff(ctx.uid, { exams: { ...(st.exams || {}), [c.id]: { score: sess.score, of: sess.qs.length, at: Date.now() } }, examFailN: fails });
    await ctx.log('academy', '考試合格', `${c.id} ${c.name}`, `${sess.score}／${sess.qs.length}`);
    awarded = await settle(ctx, { uid: ctx.uid, name: ctx.name, title: ctx.title });
    const lack = missing({ ...st, exams: { ...(st.exams || {}), [c.id]: { score: sess.score } } }, c);
    tail = (lack.length ? `考試合格。**這一科尚須完成：${lack.join('、')}**，請回到課程頁辦理。` : '成績已記入你的員工檔案。') + (awarded.length ? `\n\n${ctx.em('cert')}**你已獲頒${awarded.map((x) => `《${x.zh}》`).join('、')}。** 證書已以私訊發出。` : '');
  } else {
    const nFail = ((st.examFailN || {})[c.id] || 0) + 1, wait = cooldownMs(c, nFail);
    await FB.saveStaff(ctx.uid, { examFail: { ...(st.examFail || {}), [c.id]: Date.now() }, examFailN: { ...(st.examFailN || {}), [c.id]: nFail } });
    await ctx.log('academy', sess.expired ? '考試逾時作廢' : '考試未合格', `${c.id} ${c.name}`, `${sess.score}／${sess.qs.length}｜第 ${nFail} 次`);
    tail = `${sess.expired ? `全卷超過 ${c.exam.totalMin} 分鐘，試卷作廢並當作不合格。\n` : ''}這是連續第 ${nFail} 次未合格，<t:${D.unix(Date.now() + wait)}:R> 可以重考（${Math.round(wait / 3600e3)} 小時）。請重溫講義，特別是以下題目涉及的部分。`;
  }
  const review = ok ? '' : sess.wrong.slice(0, 8).map((w) => { const x = c.q[w.i]; return `• ${D.trunc(x.q, 120)}${w.late ? '（逾時）' : ''}`; }).join('\n');
  return ctx.edit({ content: '', embeds: [{ color: ok ? C.ok : C.alert, author: B.head(`培訓學院｜${c.id} ${c.name}`), title: ok ? '考試合格' : '未合格', description: `成績：**${sess.score}／${sess.qs.length}**（合格線 ${c.exam.pass}）${sess.late ? `；其中 ${sess.late} 題逾時` : ''}\n${tail}` + (review ? `\n\n**答錯或逾時的題目**（不提供答案）\n${D.trunc(review, 2500)}` : ''), footer: { text: '題目及答案不會公開。請勿把題目抄下與他人分享，違者按紀律程序處理。' } }], components: [row(btn('ac:home', '課程表'))] });
}

module.exports = { home, button, cert, verify, issue, settle, course, transcript, isOpen, normSerial, verifyEmbed, missing, parts, draw, correct, cooldownMs, adminPanel, adminButton, adminEmbed, adminButtons, certNameSubmit, syncRoles, printName };
