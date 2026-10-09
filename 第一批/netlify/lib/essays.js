'use strict';
// 書面評核：同事提交文章或案例分析 → 系統標示關鍵詞、計算涵蓋率、與講義的相似度及文字特徵參考值 → 評卷人員在「評卷台」評分。
// 系統只提供輔助資料及建議，最終評分一律由評卷人員決定。
// kind：'essay' 文章（ES 編號）｜'case' 案例分析（CA 編號，管理系列必須）。員工檔案內，案例分析記錄在 essays['<課程>-CS']。
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const { COURSE } = require('./courses');
const { can } = require('./org');
const { UserError } = require('./work');
const { row, btn } = D;
const C = B.COLOR;
const GRADE = { pending: '待評分', pass: '合格', dist: '優異', fail: '不合格' };
/** 文字特徵參考值或講義相似度達到這個百分比，文章會被標記為「須口試覆核」：評卷人員必須先與同事對話確認，並記下結果，才可以評為合格。 */
const FLAG_AI = 60, FLAG_SIM = 35;
const KIND = { essay: { zh: '文章', prefix: 'ES', seq: 'essay' }, case: { zh: '案例分析', prefix: 'CA', seq: 'casestudy' } };
/** 題目設定：文章為 c.essay，案例分析為 c.case */
const spec = (c, kind) => (kind === 'case' ? c.case : c.essay);
/** 員工檔案內的鍵 */
const ekey = (cid, kind) => (kind === 'case' ? `${cid}-CS` : cid);

/**
 * 可選功能：人工智能評語。只有在 Netlify 環境變數設定了 AI_MARKER_KEY（Anthropic API 金鑰）時才會啟用；未設定時完全不會連接任何外部服務。
 * 評語只供評卷人員參考，不會自動評分。
 */
async function aiComment(c, text, kind = 'essay') {
  const sp = spec(c, kind);
  const key = process.env.AI_MARKER_KEY;
  if (!key) return '';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: process.env.AI_MARKER_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: `你是一間新聞機構培訓學院的評卷助理。請用繁體中文書面語，以不多於 150 字評論以下文章：答對了甚麼、遺漏了甚麼、有沒有錯誤理解。不要評分，不要使用表情符號。\n\n題目：${sp.prompt}\n評分重點：${sp.keywords.join('、')}\n\n文章：\n${text.slice(0, 3500)}` }] }) });
    if (!r.ok) return '';
    const j = await r.json();
    return String((j.content || []).map((x) => x.text || '').join('')).replace(/\p{Extended_Pictographic}/gu, '').trim().slice(0, 900);
  } catch (e) { console.log('ai marker failed', e.message); return ''; }
}

/* ---------- 分析 ---------- */
const STOCK = ['首先', '其次', '此外', '另外', '最後', '總括而言', '總而言之', '綜上所述', '總的來說', '值得注意的是', '不僅', '與此同時', '在當今', '至關重要', '扮演著', '不可或缺', '由此可見', '換言之', '簡而言之', '毋庸置疑', '眾所周知', '不容忽視', '有助於', '確保', '從而', '進而'];
const clamp = (x) => Math.max(0, Math.min(1, x));
/**
 * 文字特徵參考值（0 至 100）：句子長度是否過於平均、套語密度、條列式結構、是否欠缺個人經驗及具體細節。
 * 這只是文字特徵的統計，不能證明文章由誰撰寫，不可單憑這個數值判定同事不誠實。
 */
function aiScore(t) {
  const sents = t.split(/[。！？!?；\n]+/).map((s) => s.trim()).filter((s) => s.length > 3);
  if (sents.length < 4 || t.length < 120) return 0;
  const lens = sents.map((s) => s.length), mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const cv = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) / mean;
  const uniform = clamp((0.6 - cv) / 0.4);
  const stock = clamp((STOCK.reduce((n, w) => n + t.split(w).length - 1, 0) * 100) / t.length / 1.6);
  const struct = clamp(((t.match(/(^|\n)\s*(\d+[.、]|[一二三四五]、|第[一二三四五]|[•\-＊*])/g) || []).length - 1) / 3);
  const specific = clamp((/我|本人|我們/.test(t) ? 0.5 : 0) + (/\d/.test(t) ? 0.25 : 0) + (/上次|曾經|有一次|例如我|當時/.test(t) ? 0.25 : 0));
  return Math.round(100 * (0.3 * uniform + 0.35 * stock + 0.15 * struct + 0.2 * (1 - specific)));
}
/** 與講義的相似度：文章內每八個字的片段，有多少百分比原樣出現在講義內 */
function similarity(t, c) {
  const norm = (s) => s.replace(/[\s*`，。、；：！？「」『』（）()《》\n]/g, '');
  const src = norm(c.material.map((m) => m.t).join('')), e = norm(t);
  if (e.length < 16) return 0;
  let hit = 0, n = 0;
  for (let i = 0; i + 8 <= e.length; i += 2) { n++; if (src.includes(e.slice(i, i + 8))) hit++; }
  return Math.round((hit / n) * 100);
}
/** 關鍵詞：回傳 { hits: [已提及], miss: [未提及], marked: 已標示關鍵詞的文章 } */
function keywords(t, c, kind = 'essay') {
  const hits = [], miss = [], found = new Set();
  for (const k of spec(c, kind).keywords) { const alts = k.split('|').filter((a) => t.includes(a)); if (alts.length) { hits.push(k.split('|')[0]); alts.forEach((a) => found.add(a)); } else miss.push(k.split('|')[0]); }
  let marked = t.replace(/[*_~`|]/g, '');
  for (const a of [...found].sort((x, y) => y.length - x.length)) marked = marked.split(a).join(`\u0001${a}\u0002`);
  return { hits, miss, marked: marked.replace(/\u0001/g, '__**').replace(/\u0002/g, '**__') };
}
function assess(t, c, kind = 'essay') {
  const sp = spec(c, kind), k = keywords(t, c, kind), len = t.replace(/\s/g, '').length, cover = k.hits.length / sp.keywords.length, ai = aiScore(t), sim = similarity(t, c);
  let hint = len < sp.min ? `字數不足（最少 ${sp.min} 字）` : cover >= 0.85 && len >= sp.min * 1.8 ? '重點齊備，可考慮評為優異' : cover >= 0.6 ? '重點大致齊備，可考慮評為合格' : '提及的重點不足，可考慮評為不合格';
  if (ai >= 65 || sim >= 40) hint += '；請細閱是否為同事本人的理解';
  return { ...k, len, cover: Math.round(cover * 100), ai, sim, hint };
}

/* ---------- 訊息 ---------- */
function cardMsg(ctx, e, a) {
  const c = COURSE[e.cid], kind = e.kind || 'essay', sp = spec(c, kind);
  const emb = {
    color: { pending: C.pending, pass: C.ok, dist: C.ok, fail: C.alert }[e.status], author: B.head('培訓學院｜評卷台'), title: `${e.id}｜${c.id} ${c.name}｜${KIND[kind].zh}`,
    description: D.trunc(`**題目：**${sp.prompt}\n\n${a.marked}`, 3900),
    fields: [
      { name: '撰寫人', value: `<@${e.uid}>（${e.title}）`, inline: true }, { name: '字數', value: `${a.len}（最少 ${sp.min}）`, inline: true }, { name: '狀態', value: GRADE[e.status], inline: true },
      { name: `已提及的重點（${a.hits.length}／${sp.keywords.length}，${a.cover}%）`, value: a.hits.join('、') || '沒有', inline: true }, { name: '未提及的重點', value: a.miss.join('、') || '沒有', inline: true },
      { name: '文字特徵參考值', value: `疑似由人工智能生成：**${a.ai}%**\n與講義原文相似：**${a.sim}%**`, inline: true },
      { name: '系統建議', value: a.hint },
    ],
    footer: { text: e.status === 'pending' ? '加上底線的粗體字是評分重點。百分比只是統計參考，不能證明文章由誰撰寫；偏高時須口試覆核。評分由評卷人員決定。' : `${GRADE[e.status]}｜${e.by}｜${D.hkText(e.doneAt)}` }, timestamp: new Date(e.at).toISOString(),
  };
  if (e.flag && e.status === 'pending') emb.fields.push({ name: '須口試覆核', value: '這篇文章的文字特徵參考值或講義相似度偏高。評為合格之前，請先與同事對話，請他不看文章，用自己的說話解釋其中兩個重點，並把對話結果寫在評語內。' });
  if (e.aiNote) emb.fields.push({ name: '人工智能評語（只供評卷人員參考）', value: D.trunc(e.aiNote, 1000) });
  if (e.feedback) emb.fields.push({ name: e.viva ? '口試覆核紀錄及評語' : '評語', value: D.trunc(e.feedback, 1000) });
  return { embeds: [emb], components: e.status === 'pending' ? [row(btn(`es:${e.flag ? 'vpass' : 'pass'}:${e.id}`, e.flag ? '口試後合格' : '合格', 3, { emoji: ctx.emo('ok') }), btn(`es:${e.flag ? 'vdist' : 'dist'}:${e.id}`, e.flag ? '口試後優異' : '優異', 1, { emoji: ctx.emo('cert') }), btn(`es:fail:${e.id}`, '不合格', 4))] : [], allowed_mentions: { parse: [] } };
}

/** 提交文章（表單 m:essay:<課程>）或案例分析（表單 m:cstudy:<課程>） */
async function submit(ctx, kind = 'essay') {
  ctx.need(ctx.g > 0, '培訓學院只開放予本公司員工。');
  const c = COURSE[ctx.cid[2]], text = ctx.fields.text || '', K = KIND[kind], sp = c && spec(c, kind);
  ctx.need(c && sp, `這一科沒有${K.zh}題目。`);
  ctx.need(require('./academy').isOpen(ctx.settings, c.id), `${c.id} 尚未開放報讀。`);
  const st = ctx.staff || {}, key = ekey(c.id, kind);
  ctx.need(!(st.essays && st.essays[key] && st.essays[key].ok), `你的 ${c.id} ${K.zh}已獲評為合格，無需再次提交。`);
  const old = (await FB.db().collection('essays').where('uid', '==', ctx.uid).get()).docs.map((d) => d.data()).find((e) => e.cid === c.id && (e.kind || 'essay') === kind && e.status === 'pending');
  ctx.need(!old, `你已提交 ${c.id} 的${K.zh}（${old && old.id}），正在等候評分。`);
  ctx.need(/獨立完成/.test(ctx.fields.declare || ''), '請在聲明一欄輸入「本人獨立完成」。考核須由本人完成，不得使用人工智能工具代寫或抄襲。');
  ctx.need(text.replace(/\s/g, '').length >= sp.min, `${K.zh}最少 ${sp.min} 字，現時只有 ${text.replace(/\s/g, '').length} 字。請補充後重新提交。`);
  const ch = ctx.needChannel('marking', '評卷台'), a = assess(text, c, kind);
  const n = await FB.next(K.seq), id = `${K.prefix}-${FB.pad(n)}`;
  const e = { id, n, kind, cid: c.id, uid: ctx.uid, name: ctx.name, title: ctx.title, g: ctx.g, no: st.no || '', text, status: 'pending', at: Date.now(), ai: a.ai, sim: a.sim, cover: a.cover, flag: a.ai >= FLAG_AI || a.sim >= FLAG_SIM, aiNote: await aiComment(c, text, kind) };
  const m = await D.api('POST', `/channels/${ch}/messages`, cardMsg(ctx, e, a));
  await FB.setDoc('essays/' + id, { ...e, msgId: m.id, channelId: ch });
  await ctx.log('academy', `提交${K.zh}`, id, `${c.id} ${c.name}｜${a.len} 字｜重點 ${a.cover}%`);
  return ctx.edit(`${ctx.em('edit')}已提交 ${c.id} 的${K.zh}，編號 **${id}**。評卷人員評分後你會收到私訊。\n你提及了 ${a.hits.length}／${sp.keywords.length} 個評分重點${a.miss.length ? `；尚未提及：${a.miss.join('、')}` : ''}。`);
}

async function mark(ctx, id, status, feedback, viva) {
  ctx.need(can.examine(ctx), '只有助理經理或以上，或學院評核員，可以評卷。');
  const e = await FB.getDoc('essays/' + id);
  ctx.need(e, '找不到這份評核。');
  const kind = e.kind || 'essay', K = KIND[kind];
  ctx.need(kind !== 'case' || ctx.g >= 5 || ctx.examiner, '案例分析須由經理或以上，或學院評核員評分。');
  ctx.need(e.status === 'pending', `這篇文章已由 ${e.by || '其他同事'} 評分。`);
  ctx.need(e.uid !== ctx.uid, `不可以評自己的${K.zh}，請交由另一位評卷人員處理。`);
  ctx.need(status === 'fail' || !e.flag || viva, `這份${K.zh}須先口試覆核，並記下覆核結果，才可以評為合格。`);
  const c = COURSE[e.cid], patch = { status, by: ctx.name, byTitle: ctx.title, feedback: feedback || '', viva: !!viva, doneAt: Date.now() }, ok = status !== 'fail';
  await FB.setDoc('essays/' + id, patch);
  await ctx.edit(cardMsg(ctx, { ...e, ...patch }, assess(e.text, c, kind)));
  const st = (await FB.getStaff(e.uid)) || {};
  await FB.saveStaff(e.uid, { essays: { ...(st.essays || {}), [ekey(c.id, kind)]: { ok, grade: status, id, at: patch.doneAt } } });
  await ctx.log('academy', `${K.zh}評分：${GRADE[status]}`, id, `${c.id}｜${e.name}${feedback ? '｜' + D.trunc(feedback, 200) : ''}`);
  const awarded = ok ? await require('./academy').settle(ctx, { uid: e.uid, name: e.name, title: e.title }) : [];
  await D.dm(e.uid, { embeds: [{ color: ok ? C.ok : C.alert, author: B.head('培訓學院'), title: `${c.id} ${K.zh}評分：${GRADE[status]}`, description: (feedback ? `**評語：**${feedback}\n\n` : '') + `評卷：${ctx.name}（${ctx.title}）` + (ok ? (awarded.length ? `\n\n你已獲頒${awarded.map((k) => `《${k.zh}》`).join('、')}。` : '') : '\n\n你可以修改後在課程頁重新提交。'), footer: { text: id } }] });
  return null;
}
const button = (ctx) => { const [, b, id] = ctx.cid; if (b !== 'pass' && b !== 'dist') throw new UserError('未支援的操作。'); return mark(ctx, id, b, ''); };
const failSubmit = (ctx) => mark(ctx, ctx.cid[2], 'fail', ctx.fields.note);
const vivaSubmit = (ctx) => mark(ctx, ctx.cid[2], ctx.cid[1] === 'esvdist' ? 'dist' : 'pass', ctx.fields.note, true);

module.exports = { submit, button, failSubmit, vivaSubmit, FLAG_AI, FLAG_SIM, assess, aiScore, similarity, keywords, GRADE, KIND, spec, ekey };
