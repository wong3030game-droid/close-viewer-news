'use strict';
// 公司架構：職級、部門、職銜、權限、晉升條件。
// 想改職銜、加部門或調整晉升門檻，改這個檔案即可，其他程式會自動跟隨。
const { SIGN } = require('./brand');

/**
 * 職級由低至高。g 為級數。
 * 第 1 至 3 級的職銜是「職位」：新聞部是記者，編輯部是編輯，客戶及市務部是客戶主任……（{j} 會換成部門的職位名稱）。
 * 第 4 至 6 級的職銜是「部門職能＋管理職級」：例如助理新聞經理 Assistant Press Manager（{f} 會換成部門職能）。
 * 第 7 至 9 級是公司高層，不分部門。tier：1 員工、2 管理人員、3 高層管理及董事會。
 */
const GRADES = [
  { key: 'trainee', g: 1, tier: 1, name: '見習職員', nameEn: 'Trainee', zh: '見習{j}', en: 'Trainee {j}', color: 0x8d97a5 },
  { key: 'officer', g: 2, tier: 1, name: '職員', nameEn: 'Staff', zh: '{j}', en: '{s}', color: 0xa7b0bc },
  { key: 'senior', g: 3, tier: 1, name: '高級職員', nameEn: 'Senior Staff', zh: '高級{j}', en: 'Senior {j}', color: 0xc3cad3 },
  { key: 'am', g: 4, tier: 2, name: '助理經理', nameEn: 'Assistant Manager', zh: '助理{f}經理', en: 'Assistant {f} Manager', color: 0xe3d9b8 },
  { key: 'manager', g: 5, tier: 2, name: '經理', nameEn: 'Manager', zh: '{f}經理', en: '{f} Manager', color: 0xd8c998 },
  { key: 'director', g: 6, tier: 2, name: '總監', nameEn: 'Director', zh: '{f}總監', en: '{f} Director', color: 0xcebd8a },
  { key: 'gm', g: 7, tier: 3, name: '總經理', nameEn: 'General Manager', zh: '總經理', en: 'General Manager', color: 0xbfa968 },
  { key: 'ed', g: 8, tier: 3, name: '執行董事', nameEn: 'Executive Director', zh: '執行董事', en: 'Executive Director', color: 0xb0954a },
  { key: 'chairman', g: 9, tier: 3, name: '董事會主席', nameEn: 'Chairman', zh: '董事會主席', en: 'Chairman', color: 0xa07a14 },
];
for (const r of GRADES) r.role = `${[SIGN.talk, SIGN.desk, SIGN.official][r.tier - 1]} ${r.name}｜${r.nameEn}`;
const GRADE = Object.fromEntries(GRADES.map((r) => [r.key, r]));
const TIER = { 1: '員工', 2: '管理人員', 3: '高層管理及董事會' };

/** 部門。j／jEn 為第 1 至 3 級的職位名稱（sEn 為第 2 級的英文職銜）；f／fEn 為管理職銜內的部門職能；cert 為該部門的專業證書（晉升高級主任時需要）；icon 為自家圖示。 */
const DEPTS = [
  { key: 'press', zh: '新聞部', en: 'Press Department', j: '記者', jEn: 'Reporter', sEn: 'Staff Reporter', f: '新聞', fEn: 'Press', cert: 'CP', icon: 'news', does: '採訪、跟進報料、撰寫新聞稿及專題' },
  { key: 'editorial', zh: '編輯部', en: 'Editorial Department', j: '編輯', jEn: 'Editor', sEn: 'Editor', f: '編輯', fEn: 'Editorial', cert: 'CE', icon: 'edit', does: '審稿、事實查核、決定發佈、發出更正' },
  { key: 'production', zh: '製作部', en: 'Production Department', j: '製作員', jEn: 'Producer', sEn: 'Producer', f: '製作', fEn: 'Production', cert: 'CD', icon: 'camera', does: '新聞圖片、圖表、版面及影片製作' },
  { key: 'client', zh: '客戶及市務部', en: 'Client Services and Marketing Department', j: '客戶主任', jEn: 'Account Executive', sEn: 'Account Executive', f: '客戶服務', fEn: 'Client Services', cert: 'CS', icon: 'client', does: '處理查詢及合作個案、管理客戶名冊、拓展讀者' },
  { key: 'hr', zh: '人力資源及行政部', en: 'Human Resources and Administration Department', j: '人事主任', jEn: 'HR Executive', sEn: 'HR Executive', f: '人力資源', fEn: 'Human Resources', cert: 'CH', icon: 'hr', does: '招聘、入職、培訓、晉升、申請審批及紀律事宜' },
  { key: 'it', zh: '資訊科技部', en: 'Information Technology Department', j: '系統主任', jEn: 'Systems Executive', sEn: 'Systems Executive', f: '資訊科技', fEn: 'IT', cert: 'CI', icon: 'it', does: '維護系統、網站及資料安全' },
  { key: 'compliance', zh: '合規部', en: 'Compliance Department', j: '合規主任', jEn: 'Compliance Executive', sEn: 'Compliance Executive', f: '合規', fEn: 'Compliance', cert: 'CC', icon: 'shield', does: '處理投訴及更正要求、內部審核、監察守則執行' },
];
for (const d of DEPTS) d.role = `${SIGN.dept} ${d.zh}｜${d.fEn}`;
const DEPT = Object.fromEntries(DEPTS.map((d) => [d.key, d]));
const STAFF_ROLE = `${SIGN.dept} 近觀者員工｜Staff`;

const CATS = [
  { key: 'local', zh: '本地' }, { key: 'gov', zh: '政府' }, { key: 'court', zh: '法庭' }, { key: 'police', zh: '警務' },
  { key: 'biz', zh: '財經' }, { key: 'community', zh: '社區' },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c.zh]));
const TYPES = { news: '新聞', feature: '專題', opinion: '評論', flash: '突發' };
const STATUS = { draft: '草稿', review: '審稿中', published: '已發佈', rejected: '不採用', retracted: '已撤回' };

/** 由成員的 Discord 身份組找出職級及部門。伺服器管理員未有職級時視為主席（方便初次設定）。 */
function resolve(member, settings) {
  const roles = (member && member.roles) || [];
  let rank = null;
  for (const r of GRADES) if (settings.roles[r.key] && roles.includes(settings.roles[r.key])) rank = r;
  if (!rank && require('./discord').isAdmin(member)) rank = GRADE.chairman;
  const dept = DEPTS.find((d) => settings.depts[d.key] && roles.includes(settings.depts[d.key])) || null;
  return { rank: rank ? rank.key : '', g: rank ? rank.g : 0, dept: dept ? dept.key : '' };
}
const fill = (tpl, d, en) => tpl.replace('{f}', d ? (en ? d.fEn : d.f) : '').replace('{j}', d ? (en ? d.jEn : d.j) : en ? 'Staff' : '職員').replace('{s}', d ? d.sEn : 'Staff').replace(/\s+/g, ' ').replace('Trainee Staff', 'Trainee').trim();
/** 中文職銜，例如 title('officer','press') → 記者；title('am','press') → 助理新聞經理 */
const title = (rankKey, deptKey) => { const r = GRADE[rankKey]; return r ? fill(r.zh, DEPT[deptKey], false) : ''; };
/** 英文職銜，例如 titleEn('officer','press') → Staff Reporter；titleEn('am','press') → Assistant Press Manager */
const titleEn = (rankKey, deptKey) => { const r = GRADE[rankKey]; return r ? fill(r.en, DEPT[deptKey], true) : ''; };

/* ---------- 權限 ---------- */
const can = {
  staff: (p) => p.g >= 1,
  /** 審稿：編輯部助理經理或以上；新聞部經理或以上；董事會 */
  review: (p) => p.g >= 7 || (p.g >= 4 && p.dept === 'editorial') || (p.g >= 5 && p.dept === 'press'),
  /** 審批自己的稿件、撤回報道：編輯總監或董事會（全部留有紀錄） */
  selfApprove: (p) => p.g >= 7 || (p.g >= 6 && p.dept === 'editorial'),
  retract: (p) => p.g >= 7 || (p.g >= 6 && p.dept === 'editorial'),
  /** 人事：人力資源部助理經理或以上；董事會 */
  hr: (p) => p.g >= 7 || (p.g >= 4 && p.dept === 'hr'),
  /** 審批申請：申請人所屬部門的助理經理或以上、人力資源部助理經理或以上、董事會 */
  approve: (p, reqDept) => p.g >= 7 || (p.g >= 4 && (p.dept === 'hr' || (!!reqDept && p.dept === reqDept))),
  /** 處理客戶個案：客戶及市務部、合規部全體；編輯部助理經理或以上（更正及投訴）；任何經理或以上 */
  cases: (p) => p.g >= 5 || (p.g >= 1 && (p.dept === 'client' || p.dept === 'compliance')) || (p.g >= 2 && (p.dept === 'editorial' || p.dept === 'press')),
  clients: (p) => p.g >= 5 || (p.g >= 2 && p.dept === 'client'),
  /** 開放或關閉課程：人力資源及行政部助理經理或以上；總監或以上 */
  academy: (p) => p.g >= 6 || (p.g >= 4 && p.dept === 'hr'),
  /** 評卷、分派任務、召開會議：助理經理或以上 */
  manage: (p) => p.g >= 4,
  /** 評卷及實務評核：助理經理或以上，或持有「學院評核員」身份組的同事 */
  examine: (p) => p.g >= 4 || (p.g >= 1 && !!p.examiner),
  /** 處理申訴及意見、查看管理報告：經理或以上 */
  senior: (p) => p.g >= 5,
  board: (p) => p.g >= 7,
  noticeStaff: (p) => p.g >= 5,
  noticePublic: (p) => p.g >= 6,
  /** 查閱紀錄：總監或以上；合規部及資訊科技部助理經理或以上 */
  audit: (p) => p.g >= 6 || (p.g >= 4 && (p.dept === 'compliance' || p.dept === 'it')),
};

/* ---------- 晉升條件（升上這一級需要符合的條件） ---------- */
const REQ = {
  officer: { certs: ['CF'], tenureDays: 14, probation: true, press: { courses: ['P201'], stories: 3 } },
  senior: { deptCert: true, tenureDays: 30, cleanDays: 30, review: 3.5, press: { stories: 12 } },
  am: { certs: ['CM'], tenureDays: 60, cleanDays: 45, review: 4, press: { stories: 30 } },
  manager: { appoint: true }, director: { appoint: true }, gm: { appoint: true }, ed: { appoint: true }, chairman: { appoint: true },
};
/** 檢查晉升條件，回傳未達標的項目（空陣列即合資格）。 */
function unmet(toKey, staff, deptKey, now = Date.now()) {
  const q = REQ[toKey] || {}, out = [], s = staff || {}, d = DEPT[deptKey];
  const { CERT, COURSE } = require('./courses');
  if (q.appoint) return ['這個職級只可委任（使用 /staff set）'];
  const certs = [...(q.certs || []), ...(q.deptCert && d ? [d.cert] : [])];
  if (q.deptCert && !d) out.push('尚未編入部門');
  for (const c of certs) if (!(s.certs && s.certs[c])) out.push(`未取得《${CERT[c].zh}》`);
  const extra = (deptKey === 'press' && q.press) || {};
  for (const c of [...(q.courses || []), ...(extra.courses || [])]) if (!(s.courses && s.courses[c])) out.push(`未修畢 ${c}《${COURSE[c].name}》`);
  if (extra.stories && (s.published || 0) < extra.stories) out.push(`已發佈稿件 ${s.published || 0}／${extra.stories} 篇`);
  if (q.probation && s.probation !== 'passed') out.push('尚未通過試用期評核');
  if (q.review) { const rv = (s.reviews || []).slice(-3), avg = rv.length ? rv.reduce((n, x) => n + x.avg, 0) / rv.length : 0; if (avg < q.review) out.push(rv.length ? `最近表現評核平均 ${avg.toFixed(1)}／5（須達 ${q.review}）` : `未有表現評核（須達 ${q.review}／5）`); }
  if (q.tenureDays) { const days = s.joinedAt ? Math.floor((now - s.joinedAt) / 864e5) : 0; if (days < q.tenureDays) out.push(`入職日數 ${days}／${q.tenureDays} 日`); }
  if (q.cleanDays) {
    const last = Math.max(0, ...((s.strikes || []).map((x) => x.at)));
    if (last && now - last < q.cleanDays * 864e5) out.push(`最近 ${q.cleanDays} 日內有紀律記錄`);
  }
  return out;
}
const nextGrade = (key) => { const r = GRADE[key]; return r ? GRADES.find((x) => x.g === r.g + 1) || null : GRADES[0]; };

/* ---------- 內部申請類別（表單欄位：[欄位鍵, 標題, 選項]） ---------- */
const REQ_TYPES = {
  leave: { zh: '請假', icon: 'leave', f: [['when', '開始及結束日期', { max: 60, ph: '例：2026-10-12 至 2026-10-14' }], ['why', '原因', { long: true, max: 400 }], ['handover', '工作交接安排', { long: true, max: 500, ph: '未完成的工作交給哪一位同事' }]] },
  resource: { zh: '資源或器材', icon: 'request', f: [['what', '需要甚麼', { max: 200 }], ['why', '用途', { long: true, max: 400 }], ['when', '何時需要', { max: 60 }]] },
  expense: { zh: '經費或報銷', icon: 'money', f: [['amount', '金額（模擬貨幣）', { max: 40 }], ['why', '用途', { long: true, max: 400 }], ['proof', '單據或證明（連結）', { max: 300, required: false }]] },
  access: { zh: '權限開通', icon: 'key', f: [['what', '需要哪個頻道或系統的權限', { max: 200 }], ['why', '原因', { long: true, max: 400 }], ['when', '需要至何時', { max: 60, required: false }]] },
  transfer: { zh: '調職', icon: 'team', f: [['what', '希望調往的部門', { max: 60 }], ['why', '理由', { long: true, max: 500 }]] },
  resign: { zh: '離職通知', icon: 'doc', f: [['when', '最後工作日', { max: 60, ph: '例：2026-10-20' }], ['handover', '交接安排', { long: true, max: 500 }], ['why', '原因（可不填）', { long: true, max: 400, required: false }]] },
  other: { zh: '其他申請', icon: 'request', f: [['what', '事項', { max: 100 }], ['why', '詳情', { long: true, max: 800 }]] },
};
const REQ_STATUS = { pending: '待審批', approved: '已批准', rejected: '不批准', cancelled: '已取消' };

/* ---------- 客戶個案類別。dept：負責跟進的部門 ---------- */
const CASE_TYPES = {
  enquiry: { zh: '一般查詢', dept: 'client', icon: 'info' },
  complaint: { zh: '投訴', dept: 'compliance', icon: 'shield' },
  correction: { zh: '更正要求', dept: 'compliance', icon: 'correct' },
  partner: { zh: '合作及廣告', dept: 'client', icon: 'client' },
  licence: { zh: '內容授權', dept: 'client', icon: 'doc' },
  release: { zh: '提交新聞稿', dept: 'press', icon: 'news' },
  invite: { zh: '記者會或活動邀請', dept: 'press', icon: 'notice' },
  letter: { zh: '讀者來信', dept: 'editorial', icon: 'edit' },
};
const CASE_STATUS = { open: '待接手', active: '處理中', closed: '已結案' };
const CLIENT_KINDS = { server: '伺服器夥伴', advertiser: '廣告客戶', agency: '機構聯絡', other: '其他' };
const CLIENT_STATUS = { lead: '洽談中', active: '合作中', paused: '已暫停', ended: '已終止' };
const WARN_LEVELS = { verbal: '口頭警告', written: '書面警告', final: '最後警告' };

module.exports = { REQ_TYPES, REQ_STATUS, CASE_TYPES, CASE_STATUS, CLIENT_KINDS, CLIENT_STATUS, WARN_LEVELS, GRADES, GRADE, TIER, DEPTS, DEPT, STAFF_ROLE, CATS, CAT, TYPES, STATUS, REQ, resolve, title, titleEn, can, unmet, nextGrade };
