'use strict';
// 近觀者培訓學院：課程目錄及證書架構。講義及題庫在 courses/ 資料夾內，按系列分檔。
// 修改講義後，如要更新 PDF／PNG 講義檔，請執行 tools/build_handouts.py（見《公司手冊》）。

/**
 * 考試規則：每次由題庫隨機抽 draw 題，答對 pass 題合格；不合格須等候 cooldownHours 小時才可重考。
 * perQuestionSec：每題作答時限（秒），逾時作答當作答錯；totalMin：全卷時限（分鐘）。時限令考生沒有時間翻查或請人代答。
 */
const EXAM = { draw: 10, pass: 8, cooldownHours: 12, perQuestionSec: 75, totalMin: 20 };

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

const ADV = require('./courses/advanced');
const COURSES = [...require('./courses/foundation'), ...require('./courses/newsroom'), ...require('./courses/business')].map((c) => ({ exam: EXAM, ...c, q: [...c.q, ...(ADV[c.id] || [])] }));
const COURSE = Object.fromEntries(COURSES.map((c) => [c.id, c]));

/**
 * 文章題目（書面評核）。每科一題，同事在課程頁按「撰寫文章」提交，由助理經理或以上在「評卷台」評分。
 * keywords：評分重點。系統會在文章內標示出現了的關鍵詞，並列出未提及的重點，協助評卷；「甲|乙」表示任何一個寫法都算。
 * required：true 表示這一科必須考試及文章都合格才算修畢。min：最少字數。
 */
const ESSAY_MIN = 200;
const ESSAYS = {
  F101: { prompt: '用自己的說話解釋「編採獨立」，並舉一個你可能遇到的情況，說明你會怎樣處理。', keywords: ['編採獨立', '編輯部', '事實', '申報|利益衝突', '上司|上報', '合作夥伴|贊助|客戶'] },
  F102: { prompt: '描述一件工作由接收到完成的過程，並說明為甚麼「認領」及「記錄」兩個步驟不能省略。', keywords: ['接收', '認領', '覆核', '記錄|紀錄', '負責人', '編號', '交接'] },
  F103: { prompt: '舉一個寫得不好的工作訊息作例子，把它改寫，並解釋你改了甚麼、為甚麼。', keywords: ['結論先行|重點', '期限|何時之前', '編號|連結', '行動|需要對方', '一件事'] },
  P201: { prompt: '解釋「事實」與「判斷」在新聞稿內的分別，並各舉一個例子說明應該怎樣寫。', keywords: ['事實', '判斷|觀點', '來源', '引述', '形容詞', '涉嫌|被指', '回應'] },
  P202: { required: true, prompt: '你收到一張截圖，顯示某機構負責人說了不當言論。說明你由收到截圖到提交稿件之間會做的每一步。', keywords: ['原訊息|原文|連結', '獨立來源|第二個來源', '回應', '報料人', '偽造|造假', '編輯', '消息來源'] },
  E301: { required: true, prompt: '記者催促你盡快批准一篇稿件，但你對其中一項關鍵事實有疑問。說明你的處理方法及理由。', keywords: ['退回', '來源', '具體', '遲發|發錯', '核對', '清單', '記者'] },
  E302: { required: true, prompt: '解釋更正、澄清及撤回三者的分別，以及為甚麼本公司堅持公開更正。', keywords: ['更正', '澄清', '撤回', '公開', '讀者', '可信|信任', '刪除'] },
  D401: { prompt: '說明新聞圖片可以接受及不可接受的處理方法，並解釋判斷的準則。', keywords: ['裁剪', '合成', '真實', '示意圖|設計圖片', '原圖', '來源', '個人資料'] },
  S501: { required: true, prompt: '一位情緒激動的讀者要求刪除一篇報道。寫出你在個案討論串的回覆，並解釋你的處理思路。', keywords: ['聽|確認', '不刪除|不會刪除', '更正要求', '理由|原因', '下一步', '上報', '禮貌'] },
  S502: { prompt: '一位合作夥伴表示，如果公司不報道他的活動就終止合作。說明你會怎樣回應及跟進。', keywords: ['編採獨立|界線', '轉交', '新聞價值', '不能承諾|不可以承諾', '上報|經理', '客戶名冊|記錄|紀錄'] },
  M601: { required: true, prompt: '一位下屬連續三次遲交工作。說明你由了解情況到跟進的整個處理過程。', keywords: ['私下', '了解|原因', '具體', '改善計劃', '期限', '跟進', '記錄|紀錄', '人力資源'] },
  M602: { required: true, prompt: '解釋為甚麼作出紀律處分之前必須先調查及聽取當事人的回應，並說明申訴機制的作用。', keywords: ['調查', '回應', '相稱', '紀錄|記錄', '申訴', '48 小時|48小時', '沒有參與'] },
  T701: { prompt: '你發現自己誤把一份機密資料貼到公眾頻道。說明你會做的每一步及原因。', keywords: ['刪除', '通報|通知', '資訊科技部', '上司', '證據|截圖', '隱瞞', '機密'] },
};
for (const c of COURSES) c.essay = ESSAYS[c.id] ? { required: false, min: ESSAY_MIN, ...ESSAYS[c.id] } : null;


/**
 * 證書：修畢 courses 內所有課程，系統即自動頒發。一科可以計入多於一張證書。
 * 部門專業證書（見 org.js 各部門的 cert）是晉升高級職員的條件；《基礎專業證書》是晉升職員的條件。
 */
const CERTS = [
  { key: 'CF', zh: '基礎專業證書', en: 'Foundation Certificate', courses: ['F101', 'F102', 'F103'], for: '全體員工；晉升職員的必要條件' },
  { key: 'CP', zh: '新聞實務證書', en: 'Certificate in Press Practice', courses: ['P201', 'P202'], for: '新聞部' },
  { key: 'CE', zh: '編輯實務證書', en: 'Certificate in Editorial Practice', courses: ['E301', 'E302'], for: '編輯部' },
  { key: 'CD', zh: '製作實務證書', en: 'Certificate in Production Practice', courses: ['D401'], for: '製作部' },
  { key: 'CS', zh: '客戶服務證書', en: 'Certificate in Client Services', courses: ['S501', 'S502'], for: '客戶及市務部' },
  { key: 'CH', zh: '人力資源實務證書', en: 'Certificate in Human Resources Practice', courses: ['M602', 'T701'], for: '人力資源及行政部' },
  { key: 'CI', zh: '資訊保安證書', en: 'Certificate in Information Security', courses: ['T701'], for: '資訊科技部' },
  { key: 'CC', zh: '合規實務證書', en: 'Certificate in Compliance Practice', courses: ['E302', 'T701'], for: '合規部' },
  { key: 'CM', zh: '管理人員證書', en: 'Certificate in Management', courses: ['M601', 'M602'], for: '管理人員' },
];
const CERT = Object.fromEntries(CERTS.map((c) => [c.key, c]));

module.exports = { EXAM, TRACKS, TRACK, COURSES, COURSE, CERTS, CERT };
