'use strict';
// 近觀者培訓學院：課程目錄、考核組成及證書架構。講義及題庫在 courses/ 資料夾內，按系列分檔。
// 修改講義後，如要更新 PDF／PNG 講義檔，請執行 tools/build_handouts.py（見《公司手冊》）。

/**
 * 考試規則（第六版）：按系列分三個程度。
 *   draw：每次抽題數目；pass：合格所需答對題數；hard：每次最少抽出的高難度題（多項選擇、排序及進階情境題）。
 *   perQuestionSec：單選題時限（秒）；longSec：多項選擇及排序題時限；totalMin：全卷時限（分鐘）。逾時作答當作答錯。
 *   cooldownHours：首次不合格的等候時間；之後每次連續不合格加倍，最長 maxCooldownHours。合格後重新計算。
 * 答錯的題目只列出題目，不顯示答案或解釋，以免同事背答案重考。
 */
const LEVELS = {
  F: { level: '基礎', draw: 12, pass: 10, hard: 4, perQuestionSec: 60, longSec: 100, totalMin: 22, cooldownHours: 24, maxCooldownHours: 168 },
  PRO: { level: '專業', draw: 12, pass: 10, hard: 5, perQuestionSec: 60, longSec: 100, totalMin: 22, cooldownHours: 24, maxCooldownHours: 168 },
  M: { level: '管理', draw: 14, pass: 12, hard: 6, perQuestionSec: 60, longSec: 110, totalMin: 28, cooldownHours: 48, maxCooldownHours: 168 },
};
const levelOf = (track) => LEVELS[track === 'F' ? 'F' : track === 'M' ? 'M' : 'PRO'];

const TRACKS = [
  { key: 'F', zh: '基礎系列', en: 'Foundation' },
  { key: 'P', zh: '新聞系列', en: 'Press' },
  { key: 'E', zh: '編輯系列', en: 'Editorial' },
  { key: 'D', zh: '製作系列', en: 'Production' },
  { key: 'S', zh: '客戶服務系列', en: 'Client Services' },
  { key: 'M', zh: '管理系列', en: 'Management' },
  { key: 'T', zh: '資訊保安系列', en: 'Information Security' },
];
const TRACK = Object.fromEntries(TRACKS.map((t) => [t.key, t]));

const ADV = require('./courses/advanced'), EXTRA = require('./courses/extra');
/** 題目統一格式：{ t: 'mc'|'multi'|'order', lv: 1|2, q, o, a?, why }。舊題庫的 Q() 沒有 t 及 lv，在此補上。 */
const norm = (lv) => (x) => ({ t: 'mc', lv, ...x });
const COURSES = [...require('./courses/foundation'), ...require('./courses/newsroom'), ...require('./courses/business'), ...require('./courses/management')]
  .map((c) => ({ ...c, exam: levelOf(c.track), q: [...c.q.map(norm(1)), ...(ADV[c.id] || []).map(norm(2)), ...(EXTRA[c.id] || [])] }))
  .sort((a, b) => TRACKS.findIndex((t) => t.key === a.track) - TRACKS.findIndex((t) => t.key === b.track) || a.id.localeCompare(b.id));
const COURSE = Object.fromEntries(COURSES.map((c) => [c.id, c]));

/**
 * 文章題目（書面評核，在「評卷台」評分）。required：true 表示必須合格才算修畢。
 * keywords：評分重點，系統會在文章內標示；「甲|乙」表示任何一個寫法都算。
 */
const ESSAY_MIN = 250;
const ESSAYS = {
  F101: { prompt: '用自己的說話解釋「編採獨立」，並舉一個你可能遇到的情況，說明你會怎樣處理。', keywords: ['編採獨立', '編輯部', '事實', '申報|利益衝突', '上司|上報', '合作夥伴|贊助|客戶'] },
  F102: { prompt: '描述一件工作由接收到完成的過程，並說明為甚麼「認領」及「記錄」兩個步驟不能省略。', keywords: ['接收', '認領', '覆核', '記錄|紀錄', '負責人', '編號', '交接'] },
  F103: { prompt: '舉一個寫得不好的工作訊息作例子，把它改寫，並解釋你改了甚麼、為甚麼。', keywords: ['結論先行|重點', '期限|何時之前', '編號|連結', '行動|需要對方', '一件事'] },
  P201: { required: true, prompt: '解釋「事實」與「判斷」在新聞稿內的分別，並各舉一個例子說明應該怎樣寫。', keywords: ['事實', '判斷|觀點', '來源', '引述', '形容詞', '涉嫌|被指', '回應'] },
  P202: { required: true, prompt: '你收到一張截圖，顯示某機構負責人說了不當言論。說明你由收到截圖到提交稿件之間會做的每一步。', keywords: ['原訊息|原文|連結', '獨立來源|第二個來源', '回應', '報料人', '偽造|造假', '編輯', '消息來源'] },
  E301: { required: true, prompt: '記者催促你盡快批准一篇稿件，但你對其中一項關鍵事實有疑問。說明你的處理方法及理由。', keywords: ['退回', '來源', '具體', '遲發|發錯', '核對', '清單', '記者'] },
  E302: { required: true, prompt: '解釋更正、澄清及撤回三者的分別，以及為甚麼本公司堅持公開更正。', keywords: ['更正', '澄清', '撤回', '公開', '讀者', '可信|信任', '刪除'] },
  D401: { required: true, prompt: '說明新聞圖片可以接受及不可接受的處理方法，並解釋判斷的準則。', keywords: ['裁剪', '合成', '真實', '示意圖|設計圖片', '原圖', '來源', '個人資料'] },
  S501: { required: true, prompt: '一位情緒激動的讀者要求刪除一篇報道。寫出你在個案討論串的回覆，並解釋你的處理思路。', keywords: ['聽|確認', '不刪除|不會刪除', '更正要求', '理由|原因', '下一步', '上報', '禮貌'] },
  S502: { prompt: '一位合作夥伴表示，如果公司不報道他的活動就終止合作。說明你會怎樣回應及跟進。', keywords: ['編採獨立|界線', '轉交', '新聞價值', '不能承諾|不可以承諾', '上報|經理', '客戶名冊|記錄|紀錄'] },
  M601: { required: true, prompt: '一位下屬連續三次遲交工作。說明你由了解情況到跟進的整個處理過程。', keywords: ['私下', '了解|原因', '具體', '改善計劃', '期限', '跟進', '記錄|紀錄', '人力資源'] },
  M602: { required: true, prompt: '解釋為甚麼作出紀律處分之前必須先調查及聽取當事人的回應，並說明申訴機制的作用。', keywords: ['調查', '回應', '相稱', '紀錄|記錄', '申訴', '48 小時|48小時', '沒有參與'] },
  T701: { prompt: '你發現自己誤把一份機密資料貼到公眾頻道。說明你會做的每一步及原因。', keywords: ['刪除', '通報|通知', '資訊科技部', '上司', '證據|截圖', '隱瞞', '機密'] },
};

/** 案例分析（管理系列必須）：較長的情境題，同樣在「評卷台」評分。新管理課程的案例寫在 courses/management.js 的 caseStudy。 */
const CASE_MIN = 350;
const CASES = {
  M601: { prompt: '【案例】你是助理新聞經理。見習記者阿明入職三星期，交來的三篇稿件都被退回，原因都是「來源不足」。他在部門頻道說「編輯故意針對我」。同時你要在今晚八時前分派一篇突發跟進稿，而部門只有阿明及一位高級記者在線。\n\n請寫出：一、今晚你會把突發跟進稿分派給誰，以及分派時會說清楚的內容；二、你會怎樣處理阿明的表現及他在部門頻道的言論；三、未來兩星期你對阿明的培育安排。最少 350 字。', keywords: ['做甚麼', '何時之前|期限', '標準', '權限', '複述', '私下', '了解|原因', '具體', '改善計劃', '導師', '跟進', '記錄|紀錄'] },
  M602: { prompt: '【案例】合規部發現一位高級編輯三個月內兩次在稿件發佈前，把稿件內容私訊給一位合作伙伴的管理人員「預覽」。該編輯表示「只是想確保沒有寫錯對方的名字」。他半年前曾因遲交收過口頭警告，現正申請晉升助理經理。\n\n請寫出：一、你作為人力資源經理的調查及聽取回應步驟；二、這件事屬於甚麼性質，處分應如何決定才算相稱；三、對他的晉升申請有甚麼影響；四、他如提出申訴，應怎樣處理。最少 350 字。', keywords: ['調查', '紀錄|證據', '聽取|回應', '保密|未發佈', '編採獨立|預先審閱', '嚴重', '相稱', '最後警告|書面警告', '45 日|紀律紀錄', '申訴', '48 小時', '沒有參與'] },
};
/** 實務評核：由評核員或管理人員觀察考生實際操作，按準則評定。新管理課程的實務評核寫在 courses/management.js 的 practical。 */
const PRACTICALS = {
  M601: { title: '分派工作面談', task: '評核員扮演一位新晉職員。考生把一項真實或模擬的工作分派給他，並處理他提出的疑問（約 10 分鐘）。', criteria: ['說清楚做甚麼及為甚麼', '給出明確的期限', '說明完成的標準', '說明對方可以自行決定及需要先問的事', '請對方複述，而不是問「明白嗎？」', '約定中途檢查的時間', '語氣尊重，沒有以職級壓人'] },
};

for (const c of COURSES) {
  c.essay = ESSAYS[c.id] ? { required: false, min: ESSAY_MIN, ...ESSAYS[c.id] } : null;
  const cs = c.caseStudy || CASES[c.id];
  c.case = cs ? { required: true, min: CASE_MIN, ...cs } : null;
  const pr = c.practical !== undefined ? c.practical : PRACTICALS[c.id];
  c.practical = pr ? { required: true, ...pr } : null;
  delete c.caseStudy;
}

/**
 * 證書：修畢 courses 內所有課程，系統即自動頒發，並派發對應的持證身份組（◎ 開頭）。一科可以計入多於一張證書。
 * 部門專業證書（見 org.js 各部門的 cert）是晉升高級職員的條件；《基礎專業證書》是晉升職員的條件；《管理人員證書》是晉升助理經理的條件。
 */
const CERTS = [
  { key: 'CF', zh: '基礎專業證書', en: 'Foundation Certificate', courses: ['F101', 'F102', 'F103'], for: '全體員工；晉升職員的必要條件' },
  { key: 'CP', zh: '新聞實務證書', en: 'Certificate in Press Practice', courses: ['P201', 'P202'], for: '新聞部' },
  { key: 'CE', zh: '編輯實務證書', en: 'Certificate in Editorial Practice', courses: ['E301', 'E302'], for: '編輯部' },
  { key: 'CD', zh: '製作實務證書', en: 'Certificate in Production Practice', courses: ['D401', 'P201'], for: '製作部' },
  { key: 'CS', zh: '客戶服務證書', en: 'Certificate in Client Services', courses: ['S501', 'S502'], for: '客戶及市務部' },
  { key: 'CH', zh: '人力資源實務證書', en: 'Certificate in Human Resources Practice', courses: ['M602', 'T701'], for: '人力資源及行政部' },
  { key: 'CI', zh: '資訊保安證書', en: 'Certificate in Information Security', courses: ['T701'], for: '資訊科技部' },
  { key: 'CC', zh: '合規實務證書', en: 'Certificate in Compliance Practice', courses: ['E302', 'T701'], for: '合規部' },
  { key: 'CM', zh: '管理人員證書', en: 'Certificate in Management', courses: ['M601', 'M602', 'M603'], for: '晉升助理經理的必要條件' },
  { key: 'CX', zh: '高級管理證書', en: 'Certificate in Senior Management', courses: ['M604', 'M605', 'M606', 'M607'], for: '經理或以上；委任總監或以上時的參考' },
];
const CERT_SIGN = '◎';
for (const k of CERTS) k.role = `${CERT_SIGN} ${k.zh}`;
const CERT = Object.fromEntries(CERTS.map((c) => [c.key, c]));

/** 評核員身份組：可在評卷台評文章及案例、主持實務評核（不限職級）。由人力資源用 /course examiner 派發。 */
const EXAMINER_ROLE = '◆ 學院評核員｜Examiner';

module.exports = { LEVELS, EXAM: LEVELS.F, TRACKS, TRACK, COURSES, COURSE, CERTS, CERT, CERT_SIGN, EXAMINER_ROLE, ESSAY_MIN, CASE_MIN };
