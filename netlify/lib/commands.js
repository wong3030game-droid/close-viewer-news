'use strict';
// 斜線指令定義。名稱須為小寫英文；說明最多 100 字。
const { GRADES, DEPTS, CATS, REQ_TYPES, CASE_TYPES, CLIENT_KINDS, CLIENT_STATUS, WARN_LEVELS } = require('./org');
const { CH, PURPOSE_CHOICES } = require('./setup');
const { COURSES } = require('./courses');
const { CANNED } = require('./office');
const { KINDS: LETTER_KINDS } = require('./lettertpl');
const { SHIFTS } = require('./plus');
const { LOGS } = require('./work');
const SUB = 1, STR = 3, BOOL = 5, USER = 6, CHAN = 7, ROLE = 8, ATT = 11;
const pick = (o, f = (v) => v.zh) => Object.entries(o).map(([value, v]) => ({ name: f(v), value }));
const CAT_CHOICES = CATS.map((c) => ({ name: c.zh, value: c.key }));
const DEPT_CHOICES = DEPTS.map((d) => ({ name: `${d.zh} ${d.fEn}`, value: d.key }));
const GRADE_CHOICES = GRADES.map((r) => ({ name: `第 ${r.g} 級 ${r.name} ${r.nameEn}`, value: r.key }));
const id = (what, eg) => ({ type: STR, name: 'id', description: `${what}編號，例如 ${eg}（只輸入數字亦可）`, required: true, max_length: 12 });
const SID = id('稿件', 'CV-0012'), RID = id('申請', 'REQ-0012'), CID = id('個案', 'CS-0012'), LID = id('客戶', 'CL-0012');
const user = (description, required = true, name = 'user') => ({ type: USER, name, description, required });
const SERIAL = { type: STR, name: 'serial', description: '證書編號，例如 CVC-2026-0001', required: true, max_length: 20 };
const G = { dm_permission: false };

const COMMANDS = [
  /* ---------- 公眾 ---------- */
  { name: 'about', description: '公司簡介、編採守則及聯絡方法', ...G },
  { name: 'help', description: '按你的職級列出可以使用的指令', ...G },
  { name: 'tip', description: '向近觀者報料', ...G, options: [{ type: BOOL, name: 'anonymous', description: '匿名報料（我們不會知道你的身份）', required: false }] },
  { name: 'service', description: '服務台：查詢、投訴、更正要求、合作或內容授權', ...G, options: [{ type: STR, name: 'type', description: '類別', required: true, choices: pick(CASE_TYPES) }] },
  { name: 'apply', description: '應徵加入近觀者', ...G, options: [{ type: STR, name: 'dept', description: '應徵部門', required: true, choices: DEPT_CHOICES }] },
  { name: 'verify', description: '核實近觀者培訓學院發出的證書', ...G, options: [SERIAL] },

  /* ---------- 編採 ---------- */
  { name: 'story', description: '【員工】稿件：撰稿、修改、加入圖片、提交審稿', ...G, options: [
    { type: SUB, name: 'new', description: '撰寫新稿件', options: [
      { type: STR, name: 'category', description: '分類', required: true, choices: CAT_CHOICES },
      { type: STR, name: 'type', description: '體裁（預設為新聞）。評論會清楚標明屬於觀點', required: false, choices: [{ name: '新聞', value: 'news' }, { name: '專題', value: 'feature' }, { name: '評論', value: 'opinion' }] },
    ] },
    { type: SUB, name: 'view', description: '查看稿件（自己的草稿可在此修改及提交）', options: [SID] },
    { type: SUB, name: 'image', description: '為稿件加入一張圖片', options: [SID, { type: ATT, name: 'file', description: '圖片（8MB 以內）', required: true }] },
    { type: SUB, name: 'submit', description: '提交審稿', options: [SID] },
    { type: SUB, name: 'list', description: '我的稿件；審稿人員會同時看到待審稿件' },
  ] },
  { name: 'breaking', description: '【審稿人員】即時發佈突發消息', ...G, options: [{ type: STR, name: 'category', description: '分類', required: true, choices: CAT_CHOICES }] },
  { name: 'correct', description: '【審稿人員】為已發佈稿件加上更正或澄清（原文保留並公開列明）', ...G, options: [
    SID, { type: STR, name: 'text', description: '內容，例如「原文指出席人數為 210 人，應為 120 人」', required: true, max_length: 500 },
    { type: STR, name: 'kind', description: '類別（預設為更正）', required: false, choices: [{ name: '更正（事實有誤）', value: 'correct' }, { name: '澄清（內容無誤但易生誤解）', value: 'clarify' }] },
  ] },
  { name: 'retract', description: '【編輯總監或董事會】撤回已發佈的報道', ...G, options: [SID, { type: STR, name: 'reason', description: '撤回原因（會公開）', required: true, max_length: 300 }] },

  /* ---------- 員工自助 ---------- */
  { name: 'duty', description: '【員工】值勤', ...G, options: [
    { type: SUB, name: 'on', description: '開始值勤' },
    { type: SUB, name: 'off', description: '結束值勤', options: [{ type: STR, name: 'summary', description: '這段時間完成了甚麼', required: true, max_length: 300 }] },
    { type: SUB, name: 'status', description: '我的值勤紀錄及時數' },
    { type: SUB, name: 'board', description: '現正值勤的同事' },
  ] },
  { name: 'profile', description: '員工檔案：職銜、證書、值勤時數及晉升進度', ...G, options: [user('留空即查看自己', false)] },
  { name: 'card', description: '【員工】領取員工證（圖像）', ...G, options: [user('留空即領取自己的（查看他人只限人力資源）', false)] },
  { name: 'request', description: '【員工】內部申請：請假、資源、經費、權限、調職、離職通知', ...G, options: [
    { type: SUB, name: 'new', description: '提交申請', options: [{ type: STR, name: 'type', description: '申請類別', required: true, choices: pick(REQ_TYPES) }] },
    { type: SUB, name: 'list', description: '我的申請；審批人員會同時看到待審批的申請' },
    { type: SUB, name: 'view', description: '查看一項申請', options: [RID] },
    { type: SUB, name: 'cancel', description: '取消自己尚未審批的申請', options: [RID] },
  ] },
  { name: 'academy', description: '【員工】培訓學院：課程、講義及考試', ...G },
  { name: 'cert', description: '【員工】證書', ...G, options: [
    { type: SUB, name: 'list', description: '已取得的證書', options: [user('留空即查看自己', false)] },
    { type: SUB, name: 'show', description: '重新領取證書圖像及 PDF', options: [SERIAL] },
    { type: SUB, name: 'revoke', description: '【人事】撤銷證書', options: [SERIAL, { type: STR, name: 'reason', description: '原因', required: true, max_length: 200 }] },
  ] },

  { name: 'transcript', description: '【員工】領取培訓成績單（圖像及 PDF）', ...G, options: [user('留空即領取自己的（查看他人只限人力資源）', false)] },
  { name: 'proof', description: '【員工】領取在職證明（圖像及 PDF）', ...G, options: [user('留空即領取自己的（查看他人只限人力資源）', false)] },
  { name: 'course', description: '【人事／總監】開放或關閉課程；未開放的課程不能報讀', ...G, options: [
    { type: SUB, name: 'open', description: '開放課程報讀，並在員工通告公佈', options: [{ type: STR, name: 'id', description: '課程', required: true, choices: [{ name: '全部課程', value: 'all' }, ...COURSES.map((c) => ({ name: `${c.id} ${c.name}`, value: c.id }))] }] },
    { type: SUB, name: 'close', description: '關閉課程', options: [{ type: STR, name: 'id', description: '課程', required: true, choices: [{ name: '全部課程', value: 'all' }, ...COURSES.map((c) => ({ name: `${c.id} ${c.name}`, value: c.id }))] }] },
    { type: SUB, name: 'status', description: '查看各科是否已開放' },
  ] },

  /* ---------- 辦公室 ---------- */
  { name: 'kudos', description: '【員工】嘉許一位同事（每日最多三次）', ...G, options: [user('要嘉許的同事'), { type: STR, name: 'reason', description: '具體做了甚麼值得嘉許', required: true, max_length: 300 }] },
  { name: 'suggest', description: '【員工】向管理層提出意見', ...G, options: [{ type: BOOL, name: 'anonymous', description: '匿名提出（管理層不會知道是誰）', required: false }] },
  { name: 'appeal', description: '【員工】就人事決定提出申訴（收到決定後 48 小時內）', ...G },
  { name: 'handover', description: '【員工】填寫工作交接：已完成、未完成、下一步', ...G },
  { name: 'roblox', description: '【員工】Roblox：連結帳戶，令遊戲內名牌顯示職銜及部門', ...G, options: [
    { type: SUB, name: 'link', description: '連結你的 Roblox 帳戶', options: [{ type: STR, name: 'username', description: 'Roblox 用戶名稱（不是顯示名稱）', required: true, max_length: 20 }] },
    { type: SUB, name: 'unlink', description: '取消連結' },
    { type: SUB, name: 'me', description: '查看名牌會顯示的資料' },
    { type: SUB, name: 'seat', description: '【經理或以上／人事】編配同事的組別及座位', options: [user('同事'), { type: STR, name: 'team', description: '組別，例如「B 組」或「日更組」（留空即清除）', required: false, max_length: 20 }, { type: STR, name: 'seat', description: '座位編號，例如 2F-PB-03（留空即清除）', required: false, max_length: 20 }] },
  ] },
  { name: 'directory', description: '【員工】部門通訊錄：誰在哪個部門、是否值勤中', ...G, options: [{ type: STR, name: 'dept', description: '部門', required: true, choices: DEPT_CHOICES }] },
  { name: 'task', description: '【員工】任務板', ...G, options: [
    { type: SUB, name: 'new', description: '【助理經理或以上】分派任務', options: [user('負責人'), { type: STR, name: 'title', description: '要完成甚麼（具體成果）', required: true, max_length: 200 }, { type: STR, name: 'due', description: '期限，例如「10 月 12 日晚上 8 時」', required: true, max_length: 60 }] },
    { type: SUB, name: 'list', description: '由我負責或由我分派而未完成的任務' },
  ] },
  { name: 'meeting', description: '【助理經理或以上】會議', ...G, options: [
    { type: SUB, name: 'new', description: '召開會議：發出通知並收集出席回覆' },
    { type: SUB, name: 'minutes', description: '記錄會議紀錄：決定、負責人、期限', options: [id('會議', 'MT-0003'), { type: STR, name: 'text', description: '每項決定一句，例如「每晚九時發摘要｜李經理｜下星期一起」', required: true, max_length: 900 }] },
  ] },
  { name: 'report', description: '【經理或以上】管理報告', ...G, options: [
    { type: SUB, name: 'weekly', description: '每周概況：新聞、個案、申請、人事、培訓、任務、值勤' },
    { type: SUB, name: 'inactive', description: '超過 14 日沒有值勤而又不在休假的同事' },
    { type: SUB, name: 'digest', description: '即時整理所有超時及待跟進的事項（系統每日上午九時亦會自動發出）' },
    { type: SUB, name: 'stories', description: '各撰稿人的發佈、退回、更正及撤回次數' },
  ] },
  { name: 'resolution', description: '【董事會】提出決議案並進行表決', ...G },
  { name: 'canned', description: '【客戶服務】取得標準回覆的範本', ...G, options: [{ type: STR, name: 'topic', description: '類別', required: true, choices: Object.entries(CANNED).map(([value, v]) => ({ name: v[0], value })) }] },

  { name: 'letter', description: '【客戶服務／管理人員】公函：按範本草擬、預覽、發出正式函件', ...G, options: [
    { type: SUB, name: 'new', description: '草擬公函（可送到個案討論串或以私訊送達）', options: [
      { type: STR, name: 'kind', description: '類別（系統會提供範本）', required: true, choices: pick(LETTER_KINDS) },
      { type: STR, name: 'case', description: '送到這宗個案的討論串，例如 CS-0012', required: false, max_length: 12 }, user('或以私訊送達這位成員', false),
    ] },
    { type: SUB, name: 'guide', description: '公函寫作指南：格式、用字、語氣及審批規則' },
    { type: SUB, name: 'list', description: '公函紀錄' },
  ] },
  { name: 'review', description: '【助理經理或以上】評核同事', ...G, options: [
    { type: SUB, name: 'probation', description: '試用期評核（見習職級入職滿 14 日）', options: [user('見習同事'), { type: STR, name: 'result', description: '結果', required: true, choices: [{ name: '通過', value: 'pass' }, { name: '延長試用期', value: 'extend' }, { name: '不通過', value: 'fail' }] }, { type: STR, name: 'comment', description: '評語', required: true, max_length: 400 }] },
    { type: SUB, name: 'monthly', description: '每月表現評核（1 至 5 分）', options: [user('同事'), { type: 4, name: 'output', description: '工作量', required: true, min_value: 1, max_value: 5 }, { type: 4, name: 'quality', description: '工作質素', required: true, min_value: 1, max_value: 5 }, { type: 4, name: 'teamwork', description: '協作及紀律', required: true, min_value: 1, max_value: 5 }, { type: STR, name: 'comment', description: '評語：做得好的地方及需要改善的地方', required: true, max_length: 400 }] },
  ] },
  { name: 'roster', description: '【員工】輪值表', ...G, options: [
    { type: SUB, name: 'view', description: '未來七日的輪值安排' },
    { type: SUB, name: 'add', description: '登記輪值', options: [{ type: STR, name: 'date', description: '日期，例如 2026-10-12', required: true, max_length: 10 }, { type: STR, name: 'shift', description: '更次', required: true, choices: Object.entries(SHIFTS).map(([value, name]) => ({ name, value })) }, user('為其他同事編更（助理經理或以上）', false)] },
    { type: SUB, name: 'drop', description: '取消輪值', options: [{ type: STR, name: 'date', description: '日期，例如 2026-10-12', required: true, max_length: 10 }, { type: STR, name: 'shift', description: '更次', required: true, choices: Object.entries(SHIFTS).map(([value, name]) => ({ name, value })) }, user('為其他同事取消（助理經理或以上）', false)] },
  ] },
  { name: 'class', description: '【助理經理或以上】開辦現場課堂：報名、簽到、出席紀錄', ...G, options: [{ type: STR, name: 'course', description: '課程', required: true, choices: COURSES.map((c) => ({ name: `${c.id} ${c.name}`, value: c.id })) }, { type: STR, name: 'when', description: '日期及時間', required: true, max_length: 80 }] },
  { name: 'poll', description: '【審稿人員／經理或以上】在讀者交流頻道發起讀者投票', ...G, options: [{ type: STR, name: 'question', description: '問題', required: true, max_length: 200 }, { type: STR, name: 'options', description: '二至四個選項，以 | 分隔，例如：支持|反對|沒有意見', required: true, max_length: 200 }] },
  { name: 'portal', description: '【員工】取得個人專頁連結：在網站查看自己的檔案、課程、任務及申請', ...G },

  /* ---------- 客戶服務 ---------- */
  { name: 'case', description: '【客戶服務】服務台個案', ...G, options: [
    { type: SUB, name: 'list', description: '未結案的個案' },
    { type: SUB, name: 'view', description: '查看個案', options: [CID] },
    { type: SUB, name: 'note', description: '加入內部備註（對方不會看到）', options: [CID, { type: STR, name: 'text', description: '備註', required: true, max_length: 400 }] },
    { type: SUB, name: 'assign', description: '把個案轉交另一位同事', options: [CID, user('接手的同事')] },
  ] },
  { name: 'client', description: '【客戶服務】客戶名冊', ...G, options: [
    { type: SUB, name: 'add', description: '登記新客戶或合作夥伴', options: [
      { type: STR, name: 'name', description: '名稱', required: true, max_length: 80 }, { type: STR, name: 'kind', description: '類別', required: true, choices: pick(CLIENT_KINDS, (v) => v) },
      { type: STR, name: 'contact', description: '聯絡人（Discord 名稱）', required: false, max_length: 100 }, { type: BOOL, name: 'follows', description: '對方是否已追蹤我們的新聞頻道', required: false },
    ] },
    { type: SUB, name: 'list', description: '全部客戶' },
    { type: SUB, name: 'view', description: '查看客戶資料及聯絡紀錄', options: [LID] },
    { type: SUB, name: 'note', description: '記錄一次聯絡', options: [LID, { type: STR, name: 'text', description: '聯絡內容及下一步', required: true, max_length: 400 }] },
    { type: SUB, name: 'update', description: '更新狀態、聯絡人或客戶主任', options: [
      LID, { type: STR, name: 'status', description: '狀態', required: false, choices: pick(CLIENT_STATUS, (v) => v) }, { type: BOOL, name: 'follows', description: '是否已追蹤新聞頻道', required: false },
      { type: STR, name: 'contact', description: '聯絡人', required: false, max_length: 100 }, user('新的客戶主任', false, 'manager'),
    ] },
  ] },

  /* ---------- 人事及管理 ---------- */
  { name: 'promote', description: '【人事】按晉升條件把同事晉升一級', ...G, options: [user('要晉升的同事')] },
  { name: 'staff', description: '【人事】員工管理', ...G, options: [
    { type: SUB, name: 'list', description: '員工名冊' },
    { type: SUB, name: 'set', description: '委任或調整職級（不核對晉升條件）', options: [user('成員'), { type: STR, name: 'grade', description: '職級', required: true, choices: GRADE_CHOICES }, { type: STR, name: 'reason', description: '原因', required: true, max_length: 200 }] },
    { type: SUB, name: 'dept', description: '編入或調往另一個部門', options: [user('同事'), { type: STR, name: 'dept', description: '部門', required: true, choices: DEPT_CHOICES }] },
    { type: SUB, name: 'warn', description: '發出紀律警告', options: [user('同事'), { type: STR, name: 'level', description: '級別', required: true, choices: pick(WARN_LEVELS, (v) => v) }, { type: STR, name: 'reason', description: '事由', required: true, max_length: 400 }] },
    { type: SUB, name: 'remove', description: '辦理離職或終止聘用：收回所有公司身份組', options: [user('同事'), { type: STR, name: 'kind', description: '類別', required: true, choices: [{ name: '離職', value: 'resign' }, { name: '終止聘用', value: 'terminate' }] }, { type: STR, name: 'reason', description: '原因', required: true, max_length: 200 }] },
  ] },
  { name: 'notice', description: '【經理或以上】發出員工通告；總監或以上可發出公司公告', ...G, options: [{ type: STR, name: 'scope', description: '對象', required: true, choices: [{ name: '員工通告（內部）', value: 'staff' }, { name: '公司公告（對外）', value: 'public' }] }] },
  { name: 'audit', description: '【總監或以上、合規、資訊科技】查閱操作紀錄', ...G, options: [
    { type: STR, name: 'category', description: '紀錄類別', required: false, choices: Object.entries(LOGS).map(([value, name]) => ({ name, value })) },
    user('只看這位同事的操作', false), { type: STR, name: 'ref', description: '編號，例如 CV-0012、REQ-0003', required: false, max_length: 30 },
  ] },

  /* ---------- 設定 ---------- */
  { name: 'setup', description: '【伺服器管理員】設定近觀者系統', ...G, default_member_permissions: '8', options: [
    { type: SUB, name: 'auto', description: '一鍵建立身份組、分類、頻道、面板及自家圖示（已有的不會重複建立）' },
    { type: SUB, name: 'panels', description: '重新張貼或更新各頻道的面板' },
    { type: SUB, name: 'icons', description: '上載自家圖示，並在可行時設定身份組圖示' },
    { type: SUB, name: 'brand', description: '把公司標誌設定為機器人頭像及伺服器圖示' },
    { type: SUB, name: 'channel', description: '指定某個用途使用哪一個現有頻道', options: [
      { type: STR, name: 'purpose', description: '用途', required: true, choices: PURPOSE_CHOICES.map((k) => ({ name: CH[k].name, value: k })) },
      { type: CHAN, name: 'channel', description: '頻道', required: true, channel_types: [0, 5] },
    ] },
    { type: SUB, name: 'role', description: '指定某個職級或部門使用哪一個現有身份組', options: [
      { type: STR, name: 'key', description: '職級或部門', required: true, choices: [...GRADE_CHOICES, ...DEPTS.map((d) => ({ name: '部門：' + d.zh, value: 'dept:' + d.key })), { name: '全體員工', value: 'staff' }] },
      { type: ROLE, name: 'role', description: '身份組', required: true },
    ] },
    { type: SUB, name: 'show', description: '查看現時設定及尚欠的項目' },
  ] },
];

module.exports = { COMMANDS };
