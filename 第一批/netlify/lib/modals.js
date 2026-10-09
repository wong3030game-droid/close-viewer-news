'use strict';
// 彈出表單。這個檔案不可以 require 資料庫：入口程式必須在 3 秒內回應 Discord。
// 表單 custom_id 規則：m:… 提交後另發只有本人可見的回覆；mu:… 提交後更新按鈕所在的訊息。
const { CAT, TYPES, DEPT, DEPTS, REQ_TYPES, CASE_TYPES } = require('./org');
const { BRAND } = require('./brand');

const input = (custom_id, label, o = {}) => ({ type: 1, components: [{ type: 4, custom_id, label, style: o.long ? 2 : 1, required: o.required !== false, max_length: o.max || 300, min_length: o.min || undefined, placeholder: o.ph || undefined, value: o.value ? String(o.value).slice(0, o.max || 300) : undefined }] });

const storyInputs = (v = {}) => [
  input('title', '標題', { max: 100, min: 4, ph: '一句說清楚：誰做了甚麼', value: v.title }),
  input('lede', '導語（第一段，一至兩句說出重點）', { long: true, max: 200, required: false, value: v.lede }),
  input('body', '內文', { long: true, max: 3800, min: 30, ph: '倒金字塔：最重要的放最前。引述須寫明出處。', value: v.body }),
  input('source', '消息來源（只供編輯核實，不會公開）', { long: true, max: 500, ph: '例：在場目擊；政府公告原文連結；訪問某某', value: v.source }),
];

/** /story new：分類及體裁由指令選項帶入 custom_id */
function newStory(cat, type) {
  return { custom_id: `m:new:${CAT[cat] ? cat : 'local'}:${TYPES[type] && type !== 'flash' ? type : 'news'}`, title: '新稿件', components: storyInputs() };
}
/** 改稿：由訊息上的稿件內容預填（無需讀取資料庫） */
function editStory(id, message) {
  const e = (message && message.embeds && message.embeds[0]) || {};
  const f = (name) => { const x = (e.fields || []).find((y) => String(y.name).startsWith(name)); return x && x.value !== '—' ? x.value : ''; };
  return { custom_id: `mu:edit:${id}`, title: `改稿 ${id}`, components: storyInputs({ title: e.title || '', lede: f('導語'), body: e.description || '', source: f('消息來源') }) };
}
function breaking(cat) {
  return { custom_id: `m:brk:${CAT[cat] ? cat : 'local'}`, title: '突發消息（即時發佈）', components: [
    input('title', '標題', { max: 100, min: 4 }),
    input('body', '內文（只寫已確認的事實）', { long: true, max: 1200, min: 10 }),
    input('source', '消息來源（不會公開）', { long: true, max: 500 }),
  ] };
}
function tip(anon) {
  return { custom_id: `m:tip:${anon ? 1 : 0}`, title: anon ? '匿名報料' : '向近觀者報料', components: [
    input('what', '發生了甚麼事', { long: true, max: 1000, min: 10 }),
    input('when', '時間及地點', { max: 200, required: false, ph: '例：今晚九時，政府總部門外' }),
    input('proof', '證據（截圖或訊息連結）', { long: true, max: 400, required: false }),
  ] };
}
function apply(dept) {
  const d = DEPT[dept] ? dept : 'press';
  return { custom_id: `m:apply:${d}`, title: `應徵${DEPT[d].zh}`, components: [
    input('hours', '每星期可投入的時間及通常上線時段', { max: 150 }),
    input('exp', '相關經驗（沒有亦請如實填寫）', { long: true, max: 600, required: false }),
    input('why', '為何希望加入本公司', { long: true, max: 600, min: 10 }),
    input('offer', '你可以為這個部門帶來甚麼', { long: true, max: 600, required: false }),
  ] };
}
/** 內部申請 */
function request(type) {
  const k = REQ_TYPES[type] ? type : 'other', t = REQ_TYPES[k];
  return { custom_id: `m:req:${k}`, title: `提交申請：${t.zh}`, components: t.f.map(([id, label, o]) => input(id, label, o)) };
}
/** 客戶個案 */
function service(type) {
  const k = CASE_TYPES[type] ? type : 'enquiry', t = CASE_TYPES[k];
  const story = k === 'complaint' || k === 'correction';
  return { custom_id: `m:case:${k}`, title: `服務台：${t.zh}`, components: [
    input('subject', '主題', { max: 80, min: 2 }),
    input('detail', k === 'correction' ? '哪一處有誤？正確資料及依據是甚麼？' : '詳情', { long: true, max: 1500, min: 10 }),
    input('ref', story ? '有關報道的編號或連結' : '有關連結（如有）', { max: 200, required: k === 'correction' }),
    input('org', '所屬機構或伺服器（如適用）', { max: 100, required: false }),
  ] };
}
function notice(scope) {
  const pub = scope === 'public';
  return { custom_id: `m:notice:${pub ? 'public' : 'staff'}`, title: pub ? '發出公司公告' : '發出員工通告', components: [
    input('title', '標題', { max: 100, min: 2 }),
    input('body', '內容', { long: true, max: 3000, min: 10 }),
    input('effective', '生效日期或適用範圍（如有）', { max: 100, required: false }),
  ] };
}
const dutyOff = () => ({ custom_id: 'm:dutyoff', title: '結束值勤', components: [input('summary', '這段時間完成了甚麼（一至兩句）', { long: true, max: 300, min: 2 })] });
/** 案例分析（管理系列） */
const caseStudy = (id) => ({ custom_id: `m:cstudy:${id}`, title: `${id} 案例分析`, components: [input('text', '案例分析（題目見課程最後一頁；最少 350 字）', { long: true, max: 4000, min: 20, ph: '按題目逐部分作答，寫出具體步驟、理由及你會說的話。' }), input('declare', '聲明：請輸入「本人獨立完成」', { max: 20, min: 6, ph: '本人獨立完成' })] });
/** 證書姓名 */
const certName = () => ({ custom_id: 'm:certname', title: '設定證書姓名', components: [input('name', '印在證書及員工證上的姓名（2 至 40 字）', { max: 40, min: 2, ph: '例：陳大文 或 Maverick Chan' })] });
const essay = (id) => ({ custom_id: `m:essay:${id}`, title: `${id} 文章`, components: [input('text', '文章（題目見課程最後一頁；最少 200 字）', { long: true, max: 4000, min: 20, ph: '用自己的說話作答，並舉出親身或具體的例子。' }), input('declare', '聲明：請輸入「本人獨立完成」', { max: 20, min: 6, ph: '本人獨立完成' })] });
const { KINDS: LETTERS } = require('./lettertpl');
/** 公函：按類別預填範本。target：c<個案號碼>、u<用戶 ID> 或 - */
const letter = (kind, target) => { const k = LETTERS[kind] ? kind : 'reply', t = LETTERS[k]; return { custom_id: `m:letter:${k}:${target || '-'}`, title: `公函：${t.zh}`, components: [input('to', '收件人（全稱及稱謂）', { max: 60, min: 2, ph: '例：陳大文先生／模擬市政府新聞處' }), input('subject', '標題', { max: 40, min: 2, value: t.subject }), input('body', '正文（把每個〔 〕換成實際內容；段落之間空一行）', { long: true, max: 2000, min: 40, value: t.body })] }; };
const suggest = (anon) => ({ custom_id: `m:suggest:${anon ? 1 : 0}`, title: anon ? '匿名意見' : '意見箱', components: [input('title', '主題', { max: 100, min: 2 }), input('body', '意見及建議的做法', { long: true, max: 1500, min: 10 })] });
const appeal = () => ({ custom_id: 'm:appeal', title: '提出申訴', components: [input('about', '針對哪一項決定（日期、內容、由誰作出）', { long: true, max: 400, min: 4 }), input('why', '申訴理由', { long: true, max: 1200, min: 10 }), input('want', '希望的結果', { max: 200, required: false })] });
const meeting = () => ({ custom_id: 'm:meeting', title: '召開會議', components: [input('title', '會議名稱', { max: 100, min: 2 }), input('when', '日期及時間', { max: 80, ph: '例：10 月 12 日（星期一）晚上 9 時' }), input('agenda', '議程（要討論及決定的事項）', { long: true, max: 1000, min: 4 })] });
const handover = () => ({ custom_id: 'm:handover', title: '工作交接', components: [input('done', '已完成', { long: true, max: 500 }), input('pending', '未完成（卡在哪裡）', { long: true, max: 500 }), input('next', '下一步（誰接手、何時之前）', { long: true, max: 500 })] });
const resolution = () => ({ custom_id: 'm:resolution', title: '提出董事會決議案', components: [input('title', '決議案標題', { max: 100, min: 2 }), input('body', '內容及理由', { long: true, max: 2500, min: 10 })] });
/** 需要填寫原因的操作。kind：return 退回稿件、reject 不採用、hrno 不取錄、rqno 不批准申請、csclose 結案 */
const REASONS = {
  return: ['退回修改', '需要修改甚麼（請具體說明，記者會收到）', 800],
  reject: ['不採用', '原因（記者會收到）', 800],
  hrno: ['不取錄', '原因（申請人會收到）', 400],
  rqno: ['不批准申請', '原因及可行的替代安排（申請人會收到）', 600],
  csclose: ['結案', '處理摘要：對方的要求、如何處理、結果', 800],
  esfail: ['文章不合格', '評語：欠缺甚麼、應該怎樣改善（同事會收到）', 800],
  apkeep: ['維持原決定', '理由（申訴人會收到）', 800],
  apchange: ['修改或撤銷原決定', '新的決定及理由（申訴人會收到）', 800],
  tkdone: ['完成任務', '完成摘要：做了甚麼、結果或連結', 600],
  esvpass: ['口試後合格', '口試覆核紀錄：問了甚麼、同事怎樣回答；以及評語', 800],
  esvdist: ['口試後優異', '口試覆核紀錄：問了甚麼、同事怎樣回答；以及評語', 800],
  ltno: ['退回公函', '需要修改甚麼（草擬人會收到）', 600],
  papass: ['實務評核合格', '評核紀錄：逐項說明考生符合哪些準則（最少 80 字）', 1000],
  pafail: ['實務評核不合格', '未符合哪些準則及改善方向（考生會收到）', 1000],
};
const reason = (kind, id) => ({ custom_id: `mu:${kind}:${id}`, title: `${REASONS[kind][0]} ${id}`.slice(0, 45), components: [input('note', REASONS[kind][1], { long: true, max: REASONS[kind][2], min: 4 })] });

/* ---------- 面板按鈕即時回覆的選單（只有本人可見） ---------- */
const menu = (custom_id, placeholder, options) => ({ type: 1, components: [{ type: 3, custom_id, placeholder, options }] });
const applyMenu = () => ({ flags: 64, content: `請選擇想應徵的部門。選擇後會彈出申請表。`, components: [menu('ps:apply', '選擇部門', DEPTS.map((d) => ({ label: `${d.zh} ${d.fEn}`, value: d.key, description: d.does.slice(0, 95) })))] });
const requestMenu = () => ({ flags: 64, content: '請選擇申請類別。選擇後會彈出申請表。', components: [menu('ps:req', '選擇申請類別', Object.entries(REQ_TYPES).map(([k, t]) => ({ label: t.zh, value: k })))] });

/** 由表單提交取回各欄：{ title: '…', body: '…' } */
function fields(i) {
  const out = {};
  for (const r of (i.data && i.data.components) || []) for (const c of r.components || []) out[c.custom_id] = String(c.value || '').trim();
  return out;
}

module.exports = { newStory, editStory, breaking, tip, apply, request, service, notice, dutyOff, essay, caseStudy, certName, letter, suggest, appeal, meeting, handover, resolution, reason, applyMenu, requestMenu, fields, BRAND };
