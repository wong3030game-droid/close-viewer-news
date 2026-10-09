'use strict';
// /setup：建立整個伺服器的身份組、分類、頻道、面板及自家圖示。設定存放在資料庫 settings/main，無需修改環境變數。
// 想增減頻道，修改下面的 LAYOUT 後重新執行 /setup auto 即可（已存在的不會重複建立）。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { GRADES, GRADE, DEPTS, DEPT, STAFF_ROLE } = ORG;
const { UserError, LOGS } = require('./work');
const { P, row, btn } = D;
const { SIGN, BRAND } = B;

/**
 * 伺服器藍圖。access：
 *   public 公眾可發言｜public_ro 公眾只可閱讀｜desk 公眾只可在自己的個案討論串發言
 *   staff 全體員工｜staff_ro 全體員工只可閱讀｜[…] 指定身份組（'dept:press' 部門、'g>=5' 職級）
 * ro：指定身份組只可閱讀（按鈕仍可使用）。news：公告頻道，其他伺服器可以追蹤。
 */
const LAYOUT = [
  { key: 'info', name: '資訊｜INFORMATION', access: 'public_ro', ch: [
    { key: 'about', sign: 'official', name: '公司簡介', topic: '公司理念、編採守則及聯絡方法。' },
    { key: 'notice', sign: 'official', name: '公司公告', news: true, topic: '本公司的正式公告。' },
    { key: 'news', sign: 'official', name: '新聞發佈', news: true, topic: '近觀者新聞正式發佈頻道。其他伺服器可按「追蹤」，新聞會自動送達。' },
    { key: 'corrections', sign: 'official', name: '更正及澄清', news: true, topic: '所有更正、澄清及撤回的公開紀錄。' },
    { key: 'careers', sign: 'desk', name: '職位空缺', topic: '各部門簡介及應徵方法。' },
  ] },
  { key: 'service', name: '服務台｜SERVICE DESK', access: 'public', ch: [
    { key: 'desk', sign: 'desk', name: '服務台', access: 'desk', topic: '報料、查詢、投訴、更正要求、合作及授權。按下方按鈕開立個案。' },
    { key: 'lounge', sign: 'talk', name: '讀者交流', topic: '讀者討論新聞的地方。請保持禮貌。' },
  ] },
  { key: 'staff', name: '員工｜STAFF', access: 'staff', ch: [
    { key: 'staffnotice', sign: 'official', name: '員工通告', access: 'staff_ro', topic: '管理層發出的內部通告。' },
    { key: 'selfservice', sign: 'desk', name: '員工服務', access: 'staff_ro', topic: '值勤、員工檔案、員工證、內部申請。' },
    { key: 'academy', sign: 'desk', name: '培訓學院', access: 'staff_ro', topic: '課程、講義、考試及證書。' },
    { key: 'certs', sign: 'official', name: '證書頒授', access: 'staff_ro', topic: '同事獲頒證書的公佈。' },
    { key: 'kudos', sign: 'official', name: '嘉許榜', access: 'staff_ro', topic: '同事之間的嘉許。使用 /kudos。' },
    { key: 'meetings', sign: 'desk', name: '會議安排', access: 'staff_ro', topic: '會議通知、出席回覆及會議紀錄。' },
    { key: 'tasks', sign: 'desk', name: '任務板', access: 'staff_ro', topic: '上司分派的任務。負責人按「確認接收」及「完成」。' },
    { key: 'staffchat', sign: 'talk', name: '員工大堂', topic: '同事日常交流。' },
    { key: 'newcomers', sign: 'talk', name: '新人問答', topic: '新同事有任何問題都可以在這裡發問。' },
  ] },
  { key: 'newsroom', name: '編採｜NEWSROOM', access: ['dept:press', 'dept:editorial', 'dept:production', 'g>=5'], ch: [
    { key: 'conference', sign: 'talk', name: '編採會議', topic: '每日選題、分工及跟進。' },
    { key: 'tips', sign: 'desk', name: '報料箱', ro: true, topic: '公眾報料。按「跟進」認領。' },
    { key: 'review', sign: 'desk', name: '審稿台', ro: true, topic: '待審稿件。未發佈的內容一律保密。' },
    { key: 'assets', sign: 'record', name: '素材庫', ro: true, topic: '稿件圖片存檔。請勿刪除這裡的訊息，否則未發佈稿件的圖片會失效。' },
  ] },
  { key: 'depts', name: '部門｜DEPARTMENTS', access: ['g>=6'], ch: DEPTS.map((d) => ({ key: 'd_' + d.key, sign: 'talk', name: d.zh, access: ['dept:' + d.key, 'g>=6'], topic: `${d.zh}（${d.en}）：${d.does}。` })) },
  { key: 'client', name: '客戶服務｜CLIENT SERVICES', access: ['dept:client', 'dept:compliance', 'g>=5'], ch: [
    { key: 'cases', sign: 'desk', name: '個案處理', ro: true, topic: '服務台個案。按「接手處理」跟進，完成後按「結案」。' },
    { key: 'clients', sign: 'record', name: '客戶名冊', ro: true, topic: '合作夥伴及客戶紀錄，由 /client 指令維護。' },
  ] },
  { key: 'admin', name: '行政｜ADMINISTRATION', access: ['g>=4'], ch: [
    { key: 'recruit', sign: 'desk', name: '招聘審批', access: ['dept:hr', 'g>=6'], ro: true, topic: '應徵申請。由人力資源及行政部助理經理或以上處理。' },
    { key: 'marking', sign: 'desk', name: '評卷台', access: ['g>=4', 'role:examiner'], ro: true, topic: '文章、案例分析及實務評核。系統已標示評分重點；文章由助理經理或以上評分，案例分析及實務評核由經理或以上或學院評核員負責。' },
    { key: 'academyadmin', sign: 'desk', name: '學院管理台', access: ['dept:hr', 'g>=6', 'role:examiner'], ro: true, topic: '開放及關閉課程、評核隊列、學院統計、持證身份組。' },
    { key: 'requests', sign: 'desk', name: '申請審批', ro: true, topic: '同事的內部申請。由部門或人力資源及行政部助理經理或以上審批。' },
  ] },
  { key: 'mgmt', name: '管理層｜MANAGEMENT', access: ['g>=5'], ch: [
    { key: 'management', sign: 'talk', name: '管理層會議', topic: '經理或以上。' },
    { key: 'feedback', sign: 'desk', name: '意見及申訴', ro: true, topic: '同事的意見及申訴。申訴由沒有參與原決定的經理或以上處理。' },
    { key: 'board', sign: 'talk', name: '董事會', access: ['g>=7'], topic: '董事會成員。' },
  ] },
  { key: 'records', name: '紀錄｜RECORDS', access: ['g>=5', 'dept:it', 'dept:compliance'], ch: Object.entries(LOGS).map(([k, zh]) => ({ key: 'log_' + k, sign: 'record', name: zh, ro: true, topic: `${zh}：由系統自動記錄，不可發言。` })) },
];
const CH = Object.fromEntries(LAYOUT.flatMap((c) => c.ch.map((x) => [x.key, x])));
/** 可用 /setup channel 重新指定的用途（系統會在這些頻道發訊息） */
const PURPOSES = ['about', 'notice', 'news', 'corrections', 'careers', 'desk', 'staffnotice', 'selfservice', 'academy', 'certs', 'tips', 'review', 'assets', 'cases', 'clients', 'recruit', 'requests', 'marking', 'academyadmin', 'feedback', 'kudos', 'meetings', 'tasks', ...Object.keys(LOGS).map((k) => 'log_' + k)];
const PURPOSE_CHOICES = PURPOSES.filter((k) => !['about', 'careers', 'kudos', 'meetings', 'tasks'].includes(k)).slice(0, 25);
const chName = (x) => `${SIGN[x.sign]}｜${x.name}`;

/* ---------- 權限 ---------- */
const WRITE = P.SEND | P.PUBLIC_THREADS | P.PRIVATE_THREADS;
function overwrites(access, ro, S, guild, botId) {
  const ow = [], add = (id, type, allow, deny) => { if (id) ow.push({ id, type, allow: String(allow), deny: String(deny) }); };
  const roleIds = (spec) => { const m = /^g>=(\d)$/.exec(spec); return m ? GRADES.filter((r) => r.g >= +m[1]).map((r) => S.roles[r.key]) : [spec.startsWith('dept:') ? S.depts[spec.slice(5)] : spec === 'role:examiner' ? S.examinerRole : null]; };
  if (access === 'public') { /* 預設權限 */ }
  else if (access === 'public_ro') add(guild, 0, 0n, WRITE);
  else if (access === 'desk') add(guild, 0, P.SEND_THREADS, WRITE);
  else if (access === 'staff' || access === 'staff_ro') { add(guild, 0, 0n, P.VIEW | (access === 'staff_ro' ? WRITE : 0n)); add(S.staffRole, 0, P.VIEW, 0n); }
  else { add(guild, 0, 0n, P.VIEW | (ro ? WRITE : 0n)); for (const id of new Set(access.flatMap(roleIds))) add(id, 0, P.VIEW, 0n); }
  add(botId, 1, P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.HISTORY | P.MANAGE_THREADS | P.PRIVATE_THREADS | P.SEND_THREADS, 0n);
  return ow;
}

/* ---------- 面板（固定在頻道內、帶按鈕的訊息） ---------- */
function panels(S) {
  const e = (k) => B.emo(S, k), em = (k) => B.em(S, k);
  const { COURSES, CERTS, TRACKS } = require('./courses');
  return {
    about: { embeds: [require('./help').aboutEmbed()] },
    careers: { embeds: [{ color: B.COLOR.hr, author: B.head('人力資源及行政部'), title: '職位空缺', description: `本公司各部門長期招聘見習人員，例如見習記者、見習編輯、見習客戶主任。取錄後會獲發聘書及員工編號，並可修讀培訓學院的課程，按公開條件晉升。\n\n` + DEPTS.map((d) => `${em(d.icon)}**${d.zh}** ${d.fEn}\n${d.does}。`).join('\n'), fields: [
      { name: '晉升階梯', value: GRADES.map((r) => `第 ${r.g} 級　${r.name} ${r.nameEn}`).join('\n') },
      { name: '應徵方法', value: '按下方「應徵」，選擇部門並填寫申請表。人力資源及行政部會在七日內以私訊回覆。' },
    ] }], components: [row(btn('p:apply', '應徵', 1, { emoji: e('hr') }))] },
    desk: { embeds: [{ color: B.COLOR.client, author: B.head('服務台'), title: '我們可以怎樣協助你？', description: '請選擇類別。系統會開立個案，並建立一條只有你及負責同事看得到的討論串。我們會在 24 小時內回覆。', fields: Object.values(ORG.CASE_TYPES).map((t, n) => ({ name: t.zh, value: ['查詢公司、服務或報道的一般問題。', '對報道或同事的工作提出投訴。', '指出報道有錯，要求更正。', '邀請合作、刊登廣告或贊助。', '申請轉載本公司的內容。', '機構向本公司提交新聞稿。', '邀請本公司派員採訪。', '就新聞發表意見，獲選的來信會刊登。'][n], inline: true })).concat([{ name: '報料', value: '提供新聞線索。可選擇匿名；匿名報料我們無法聯絡你跟進。', inline: true }]) }], components: [
      row(...Object.entries(ORG.CASE_TYPES).slice(0, 4).map(([k, t]) => btn(`p:case:${k}`, t.zh, 2, { emoji: e(t.icon) }))),
      row(...Object.entries(ORG.CASE_TYPES).slice(4).map(([k, t]) => btn(`p:case:${k}`, t.zh, 2, { emoji: e(t.icon) }))),
      row(btn('p:tip:0', '報料', 1, { emoji: e('tip') }), btn('p:tip:1', '匿名報料', 2, { emoji: e('lock') })),
    ] },
    selfservice: { embeds: [{ color: B.COLOR.hr, author: B.head('員工服務'), title: '員工自助服務', description: '日常事務在這裡辦理。所有回覆只有你自己看得到。', fields: [
      { name: '值勤', value: '開始工作時按「開始值勤」，完成後按「結束值勤」並寫下工作摘要。' },
      { name: '檔案及證件', value: '查看職級、證書及晉升進度；領取員工證。' },
      { name: '申請', value: '請假、資源、經費、權限、調職及離職通知，一律在這裡提交。' },
      { name: '交接、任務及意見', value: '離開前未完成的工作請填寫交接；查看上司分派的任務；向管理層提出意見（可匿名）。' },
    ] }], components: [
      row(btn('p:duty:on', '開始值勤', 3, { emoji: e('duty') }), btn('p:duty:off', '結束值勤', 2), btn('p:duty:status', '我的值勤紀錄', 2), btn('p:duty:board', '現正值勤', 2, { emoji: e('team') })),
      row(btn('p:profile', '員工檔案', 2, { emoji: e('hr') }), btn('p:card', '員工證', 2, { emoji: e('id') }), btn('p:req', '提交申請', 1, { emoji: e('request') }), btn('p:reqs', '我的申請', 2)),
      row(btn('p:handover', '工作交接', 2, { emoji: e('doc') }), btn('p:tasks', '我的任務', 2), btn('p:suggest:0', '意見箱', 2, { emoji: e('tip') }), btn('p:suggest:1', '匿名意見', 2, { emoji: e('lock') })),
      row(btn('p:academy', '培訓學院', 2, { emoji: e('academy') }), btn('p:transcript', '成績單', 2), btn('p:proof', '在職證明', 2), btn('p:help', '指令一覽', 2, { emoji: e('info') })),
      row(btn('p:portal', '個人專頁', 2, { emoji: e('web') }), btn('p:roster', '輪值表', 2, { emoji: e('leave') })),
    ] },
    academyadmin: { embeds: [require('./academy').adminEmbed()], components: require('./academy').adminButtons({ emo: e }) },
    academy: { embeds: [{ color: B.COLOR.academy, author: B.head('培訓學院'), title: '課程及證書', description: `學院現開辦 ${COURSES.length} 科課程、${CERTS.length} 張證書。已開放的課程可以任意選讀，沒有先後限制。每科有文字講義、PDF 及圖像講義；考試包括單選、多項選擇及排序題，管理課程另設案例分析及實務評核。修畢一張證書所需的課程，系統會即時頒發證書及持證身份組（◎）。`, fields: [
      ...TRACKS.map((t) => ({ name: `${t.zh} ${t.en}`, value: COURSES.filter((c) => c.track === t.key).map((c) => `**${c.id}** ${c.name}`).join('\n'), inline: true })),
      { name: '證書', value: CERTS.map((k) => `《${k.zh}》${k.courses.join('＋')}｜${k.for}`).join('\n') },
      { name: '證書上的姓名', value: '證書及員工證只能印出普通中文字及英文字母。Discord 名稱使用花式字體或表情符號的同事，請先按「設定證書姓名」。' },
    ] }], components: [row(btn('p:academy', '進入學院', 1, { emoji: e('academy') }))] },
  };
}
async function postPanels(S, report) {
  const all = panels(S);
  for (const [k, msg] of Object.entries(all)) {
    const ch = S.channels[k];
    if (!ch) { report.warn.push(`未設定「${CH[k].name}」頻道，未能張貼面板。`); continue; }
    const body = { ...msg, allowed_mentions: { parse: [] } }, old = S.panels[k];
    try {
      if (old && old.ch === ch) { try { await D.api('PATCH', `/channels/${ch}/messages/${old.id}`, body); report.kept.push(`面板：${CH[k].name}（已更新）`); continue; } catch (e) { if (e.status !== 404) throw e; } }
      const m = await D.api('POST', `/channels/${ch}/messages`, body);
      S.panels[k] = { ch, id: m.id }; report.made.push(`面板：${CH[k].name}`);
    } catch (e) { report.warn.push(`未能在 <#${ch}> 張貼面板：${e.message}`); }
  }
  await FB.saveSettings({ panels: S.panels });
}

/* ---------- 自家圖示 ---------- */
const dataUri = async (rel) => 'data:image/png;base64,' + (await require('./docs').pub(rel)).toString('base64');
async function uploadIcons(ctx, S, report) {
  const app = ctx.i.application_id;
  let have;
  try { have = (await D.api('GET', `/applications/${app}/emojis`)).items || []; } catch (e) { report.warn.push(`未能讀取應用程式圖示（${e.message}）。訊息會以純文字顯示，功能不受影響。`); return; }
  let n = 0;
  for (const k of B.ICONS) {
    const hit = have.find((x) => x.name === 'cv_' + k);
    if (hit) { S.emoji[k] = hit.id; continue; }
    try { const r = await D.api('POST', `/applications/${app}/emojis`, { name: 'cv_' + k, image: await dataUri(`icons/${k}.png`) }); S.emoji[k] = r.id; n++; } catch (e) { report.warn.push(`圖示 ${k} 上載失敗：${e.message}`); if (e.status === 403 || e.status === 401) break; }
  }
  await FB.saveSettings({ emoji: S.emoji });
  report.made.push(`自家圖示 ${n} 個（共 ${Object.keys(S.emoji).length} 個可用）`);
}
/** 身份組圖示：伺服器加成達到第 2 級才可使用，未達到時自動略過 */
async function roleIcons(ctx, S, report) {
  let guild;
  try { guild = await D.api('GET', `/guilds/${ctx.guild}`); } catch { return; }
  if (!(guild.features || []).includes('ROLE_ICONS')) { report.note.push('身份組圖示需要伺服器加成第 2 級；現時未達到，已略過。日後達到後執行 /setup icons 即可。'); return; }
  const jobs = [...GRADES.map((r) => [S.roles[r.key], 'tier' + r.tier]), ...DEPTS.map((d) => [S.depts[d.key], d.icon]), [S.staffRole, 'mark'], [S.examinerRole, 'academy'], ...Object.values(S.certRoles || {}).map((id) => [id, 'cert'])];
  let n = 0;
  for (const [id, icon] of jobs) { if (!id) continue; try { await D.api('PATCH', `/guilds/${ctx.guild}/roles/${id}`, { icon: await dataUri(`icons/${icon}.png`) }); n++; } catch (e) { report.warn.push(`身份組圖示設定失敗：${e.message}`); break; } }
  report.made.push(`身份組圖示 ${n} 個`);
}

/* ---------- 顯示設定 ---------- */
function showMsg(S, note) {
  const mark = (ok) => (ok ? '已設定' : '**未設定**');
  const ch = PURPOSES.map((k) => `${CH[k].name}：${S.channels[k] ? `<#${S.channels[k]}>` : mark(false)}`);
  const rk = [...GRADES].reverse().map((r) => `第 ${r.g} 級 ${r.name}：${S.roles[r.key] ? `<@&${S.roles[r.key]}>` : mark(false)}`);
  const dp = DEPTS.map((d) => `${d.zh}：${S.depts[d.key] ? `<@&${S.depts[d.key]}>` : mark(false)}`);
  dp.push(`全體員工：${S.staffRole ? `<@&${S.staffRole}>` : mark(false)}`);
  dp.push(`學院評核員：${S.examinerRole ? `<@&${S.examinerRole}>` : mark(false)}`);
  const cr = require('./courses').CERTS.map((k) => `${k.zh}：${(S.certRoles || {})[k.key] ? `<@&${S.certRoles[k.key]}>` : mark(false)}`);
  const missing = [...ch, ...rk, ...dp, ...cr].some((x) => x.includes('未設定'));
  return { content: D.trunc(note || '', 1900), embeds: [{ color: B.COLOR.brand, author: B.head('系統設定'), fields: [
    { name: '頻道（一）', value: ch.slice(0, 10).join('\n') }, { name: '頻道（二）', value: ch.slice(10, 20).join('\n') }, { name: '頻道（三）', value: ch.slice(20).join('\n') },
    { name: '職級身份組', value: rk.join('\n'), inline: true }, { name: '部門身份組', value: dp.join('\n'), inline: true }, { name: '持證身份組', value: cr.join('\n'), inline: true },
    { name: '自家圖示', value: `${Object.keys(S.emoji).length}／${B.ICONS.length} 個已上載`, inline: true },
  ], footer: { text: missing ? '未設定的項目可用 /setup auto 一次過補齊，或用 /setup channel、/setup role 指定現有的。' : '全部已設定。' } }], allowed_mentions: { parse: [] } };
}
const summary = (r) => `**設定完成。**\n新建（${r.made.length}）：${D.trunc(r.made.join('、') || '沒有', 700)}\n沿用（${r.kept.length}）：${D.trunc(r.kept.join('、') || '沒有', 300)}` + (r.warn.length ? '\n\n**需要留意**\n' + r.warn.slice(0, 6).map((x) => '• ' + x).join('\n') : '') + (r.note.length ? '\n\n' + r.note.map((x) => '• ' + x).join('\n') : '');

/* ---------- /setup auto ---------- */
async function auto(ctx) {
  const g = ctx.guild, S = ctx.settings, report = { made: [], kept: [], warn: [], note: [] };
  let roles, chans, me;
  try { [roles, chans, me] = await Promise.all([D.api('GET', `/guilds/${g}/roles`), D.api('GET', `/guilds/${g}/channels`), D.api('GET', '/users/@me')]); } catch (e) {
    throw new UserError('讀取不到伺服器資料。請確認機器人已加入這個伺服器，而且 Netlify 的 DISCORD_BOT_TOKEN 正確。（' + e.message + '）');
  }
  const fail = (e, what) => { if (e.status === 403) throw new UserError(`機器人沒有權限建立${what}。請按《設定指南》給予機器人「管理員」權限，然後再次執行 /setup auto（已建立的不會重複）。`); throw e; };

  // 1. 身份組：由最高職級開始建立，成員名單會按職級由高至低排列
  const ensureRole = async (curId, name, color, hoist) => {
    const hit = roles.find((r) => r.id === curId) || roles.find((r) => r.name === name);
    if (hit) { report.kept.push(name); return hit.id; }
    try { const r = await D.api('POST', `/guilds/${g}/roles`, { name, color, hoist, mentionable: false, permissions: '0' }, null, { reason: '近觀者 /setup auto' }); report.made.push(name); return r.id; } catch (e) { return fail(e, '身份組'); }
  };
  for (const r of [...GRADES].reverse()) S.roles[r.key] = await ensureRole(S.roles[r.key], r.role, r.color, true);
  for (const d of DEPTS) S.depts[d.key] = await ensureRole(S.depts[d.key], d.role, 0, false);
  S.staffRole = await ensureRole(S.staffRole, STAFF_ROLE, 0, false);
  // 學院：評核員及持證身份組（第六版）
  const AC = require('./courses');
  S.examinerRole = await ensureRole(S.examinerRole, AC.EXAMINER_ROLE, 0, false);
  S.certRoles = S.certRoles || {};
  for (const k of AC.CERTS) S.certRoles[k.key] = await ensureRole(S.certRoles[k.key], k.role, 0, false);
  await FB.saveSettings({ roles: S.roles, depts: S.depts, staffRole: S.staffRole, examinerRole: S.examinerRole, certRoles: S.certRoles });

  // 2. 分類及頻道
  let community = true;
  for (const cat of LAYOUT) {
    let c = chans.find((x) => x.type === 4 && (x.id === S.cats[cat.key] || x.name === cat.name));
    if (!c) { try { c = await D.api('POST', `/guilds/${g}/channels`, { name: cat.name, type: 4, permission_overwrites: overwrites(cat.access, false, S, g, me.id) }); report.made.push('分類 ' + cat.name); } catch (e) { fail(e, '頻道'); } }
    S.cats[cat.key] = c.id;
    for (const x of cat.ch) {
      const name = chName(x), hit = chans.find((y) => y.id === S.channels[x.key]) || chans.find((y) => y.parent_id === c.id && y.name === name);
      if (hit) {
        S.channels[x.key] = hit.id; report.kept.push(name); if (x.news && hit.type !== 5) community = false;
        // 舊版建立的頻道：補上評核員的查看權限
        if ((x.access || []).includes('role:examiner') && S.examinerRole && !(hit.permission_overwrites || []).some((o) => o.id === S.examinerRole)) { try { await D.api('PUT', `/channels/${hit.id}/permissions/${S.examinerRole}`, { type: 0, allow: String(P.VIEW), deny: '0' }); } catch (e) { report.warn.push(`未能為「${x.name}」加入評核員權限：${e.message}`); } }
        continue;
      }
      const body = { name, parent_id: c.id, topic: x.topic, permission_overwrites: overwrites(x.access || cat.access, x.ro, S, g, me.id) };
      let made;
      if (x.news && community) { try { made = await D.api('POST', `/guilds/${g}/channels`, { ...body, type: 5 }); } catch (e) { if (e.status === 403) fail(e, '頻道'); community = false; } }
      if (!made) { try { made = await D.api('POST', `/guilds/${g}/channels`, { ...body, type: 0 }); } catch (e) { fail(e, '頻道'); } }
      S.channels[x.key] = made.id; report.made.push(name);
    }
    await FB.saveSettings({ channels: S.channels, cats: S.cats });
  }
  if (!community) report.warn.push('伺服器尚未啟用「社群」，所以公司公告、新聞發佈、更正及澄清三個頻道暫時是普通文字頻道，其他伺服器未能追蹤。請到 伺服器設定 → 啟用社群，再把這三個頻道的類型改為「公告頻道」；無需重新執行 /setup。');

  // 3. 自家圖示 → 身份組圖示 → 面板
  await uploadIcons(ctx, S, report);
  await roleIcons(ctx, S, report);
  await postPanels(S, report);

  // 4. 執行指令的管理員如未有職級，委任為董事會主席
  if (!GRADES.some((r) => (ctx.member.roles || []).includes(S.roles[r.key]))) {
    try {
      await D.api('PUT', `/guilds/${g}/members/${ctx.uid}/roles/${S.roles.chairman}`, null, null, { reason: '近觀者 /setup auto' });
      await D.api('PUT', `/guilds/${g}/members/${ctx.uid}/roles/${S.staffRole}`, null, null, { reason: '近觀者 /setup auto' });
      await FB.saveStaff(ctx.uid, { name: ctx.name, rank: 'chairman', dept: '', active: true });
      report.made.push(`已委任你為${GRADE.chairman.name}`);
    } catch { report.warn.push('未能自動派發主席身份組，請手動加入。'); }
  }
  await ctx.log('system', '系統設定', '/setup auto', `新建 ${report.made.length} 項`);
  return ctx.edit(showMsg(S, summary(report)));
}

async function command(ctx) {
  ctx.need(ctx.admin, '只有伺服器管理員可以使用 /setup。');
  const S = ctx.settings, report = { made: [], kept: [], warn: [], note: [] };
  if (ctx.sub === 'show') return ctx.edit(showMsg(S));
  if (ctx.sub === 'auto') return auto(ctx);
  if (ctx.sub === 'panels') { await postPanels(S, report); return ctx.edit(summary(report)); }
  if (ctx.sub === 'icons') { await uploadIcons(ctx, S, report); await roleIcons(ctx, S, report); await postPanels(S, report); return ctx.edit(summary(report)); }
  if (ctx.sub === 'brand') {
    const icon = await dataUri('brand/avatar.png'), done = [];
    try { await D.api('PATCH', '/users/@me', { avatar: icon }); done.push('機器人頭像'); } catch (e) { report.warn.push(`機器人頭像：${e.message}`); }
    try { await D.api('PATCH', `/guilds/${ctx.guild}`, { icon }); done.push('伺服器圖示'); } catch (e) { report.warn.push(`伺服器圖示：${e.message}`); }
    return ctx.edit(`已套用公司標誌：${done.join('、') || '沒有'}。` + (report.warn.length ? '\n未能完成：' + report.warn.join('；') + '\n（頭像短時間內只可更改數次；亦可在 Discord 開發者後台及伺服器設定手動上載 public/brand/avatar.png。）' : ''));
  }
  if (ctx.sub === 'channel') {
    const key = ctx.opt('purpose'), id = ctx.opt('channel'), c = (ctx.resolved.channels || {})[id];
    ctx.need(CH[key], '未知的用途。');
    S.channels[key] = id;
    await FB.saveSettings({ channels: S.channels });
    const note = CH[key].news && c && c.type !== 5 ? '\n注意：這個不是公告頻道，其他伺服器未能追蹤。請把頻道類型改為「公告頻道」。' : '';
    return ctx.edit(showMsg(S, `已把「${CH[key].name}」設定為 <#${id}>。如這個頻道需要面板，請執行 /setup panels。${note}`));
  }
  if (ctx.sub === 'role') {
    const key = ctx.opt('key'), id = ctx.opt('role');
    if (key === 'staff') S.staffRole = id;
    else if (key === 'examiner') S.examinerRole = id;
    else if (key.startsWith('cert:') && require('./courses').CERT[key.slice(5)]) S.certRoles = { ...(S.certRoles || {}), [key.slice(5)]: id };
    else if (key.startsWith('dept:') && DEPT[key.slice(5)]) S.depts[key.slice(5)] = id;
    else if (GRADE[key]) S.roles[key] = id;
    else throw new UserError('未知的職級或部門。');
    await FB.saveSettings({ roles: S.roles, depts: S.depts, staffRole: S.staffRole, examinerRole: S.examinerRole || '', certRoles: S.certRoles || {} });
    return ctx.edit(showMsg(S, `已更新。請確認機器人的身份組排在 <@&${id}> 之上，否則系統未能派發這個身份組。`));
  }
  throw new UserError('未支援的指令。');
}

module.exports = { command, LAYOUT, CH, PURPOSES, PURPOSE_CHOICES, chName, panels, overwrites, BRAND };
