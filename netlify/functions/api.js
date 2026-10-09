'use strict';
// 公開資料接口，供網站使用（日後 Roblox 新聞板亦會使用 /api/headlines）。
// 只會回傳已公開的資料：已發佈或已撤回的稿件、員工名單、課程目錄、證書核實結果。草稿、消息來源及內部紀錄一律不會外洩。
//   /api/roblox?id=Roblox用戶ID（須附 x-cv-key 標頭，供 Roblox 名牌使用）
//   /api/news（?cat=gov&limit=20）　/api/story?id=CV-0001　/api/headlines　/api/staff　/api/company　/api/verify?serial=CVC-2026-0001
const FB = require('../lib/fb');
const D = require('../lib/discord');
const ORG = require('../lib/org');
const { BRAND } = require('../lib/brand');
const { freshImage } = require('../lib/stories');

const out = (code, body, maxAge = 60) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}`, 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

/** Discord 附件連結有時限（網址內 ex= 為到期時間）。快將到期就向 Discord 取回新的並儲存。 */
async function imgUrl(s, budget) {
  if (!s.img || s.status !== 'published') return '';
  const m = /[?&]ex=([0-9a-f]+)/i.exec(s.img.url || '');
  const exp = m ? parseInt(m[1], 16) * 1000 : 0;
  if (exp - Date.now() > 15 * 60e3) return s.img.url;
  if (budget.n <= 0 || !process.env.DISCORD_BOT_TOKEN) return s.img.url || '';
  budget.n -= 1;
  const url = await freshImage(s);
  if (url && url !== s.img.url) { try { await FB.saveStory(s.id, { img: { ...s.img, url } }); } catch { /* 下次再試 */ } }
  return url || '';
}
const brief = (s, img) => ({
  id: s.id, title: s.title, cat: s.cat, catName: ORG.CAT[s.cat] || '本地', type: s.type, typeName: ORG.TYPES[s.type] || '新聞', status: s.status,
  lede: s.status === 'retracted' ? '' : s.lede || D.trunc(String(s.body || '').replace(/\s+/g, ' '), 110),
  author: s.authorName, editor: s.editorName || '', publishedAt: s.publishedAt, img,
  corrections: (s.corrections || []).map((c) => ({ at: c.at, text: c.text, kind: c.kind || 'correct' })),
  retractReason: s.status === 'retracted' ? s.retractReason || '' : undefined, retractedAt: s.retractedAt,
});
function company() {
  const { COURSES, CERTS, TRACKS, EXAM } = require('../lib/courses');
  return {
    brand: BRAND, ethics: require('../lib/help').ETHICS.map((x) => x.replace(/\*\*/g, '')), cats: ORG.CATS,
    depts: ORG.DEPTS.map((d) => ({ key: d.key, zh: d.zh, en: d.en, does: d.does, example: `${ORG.title('am', d.key)} ${ORG.titleEn('am', d.key)}` })),
    grades: ORG.GRADES.map((r) => ({ g: r.g, zh: r.name, en: r.nameEn, tier: ORG.TIER[r.tier] })),
    tracks: TRACKS, exam: EXAM,
    courses: COURSES.map((c) => ({ id: c.id, name: c.name, en: c.en, track: c.track, who: c.who, intro: c.intro, need: c.need, sections: c.material.map((m) => m.h.replace(/^.、/, '')) })),
    certs: CERTS.map((k) => ({ key: k.key, zh: k.zh, en: k.en, courses: k.courses, for: k.for })),
    caseTypes: Object.values(ORG.CASE_TYPES).map((t) => t.zh),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return out(204, {});
  if (event.httpMethod !== 'GET') return out(405, { error: 'GET only' }, 0);
  const q = event.queryStringParameters || {};
  const seg = String(event.path || '').split('/').filter(Boolean).pop() || '';
  const r = ['news', 'story', 'headlines', 'staff', 'company', 'verify', 'me', 'roblox'].includes(seg) ? seg : String(q.r || 'news');
  try {
    if (r === 'company') return out(200, company(), 3600);
    if (r === 'me') { const me = await require('../lib/plus').portalData(q.t); return me ? out(200, me, 0) : out(401, { error: '連結無效或已過期。請在 Discord 重新使用 /portal。' }, 0); }
    if (r === 'roblox') {
      // Roblox 遊戲伺服器讀取名牌資料。須附上 x-cv-key 標頭（Netlify 環境變數 ROBLOX_API_KEY）。
      const key = process.env.ROBLOX_API_KEY, h = event.headers || {};
      if (!key) return out(503, { error: '未設定 ROBLOX_API_KEY' }, 0);
      if ((h['x-cv-key'] || h['X-Cv-Key'] || '') !== key) return out(401, { error: 'invalid key' }, 0);
      const rid = String(q.id || '').replace(/\D/g, '');
      if (!rid) return out(400, { error: 'id required' }, 0);
      return out(200, await require('../lib/roblox').profileByRoblox(rid), 0);
    }
    const db = FB.db(), budget = { n: 6 };
    if (r === 'verify') {
      const serial = require('../lib/academy').normSerial(q.serial), c = serial && (await FB.getDoc('certs/' + serial));
      if (!c) return out(404, { found: false, serial }, 30);
      return out(200, { found: true, serial: c.serial, status: c.status, name: c.name, zh: c.zh, en: c.en, courses: c.courses, at: c.at }, 60);
    }
    if (r === 'story') {
      const s = await FB.getStory(q.id);
      if (!s || !['published', 'retracted'].includes(s.status)) return out(404, { error: '找不到這篇報道' }, 30);
      return out(200, { ...brief(s, await imgUrl(s, budget)), lede: s.status === 'retracted' ? '' : s.lede || '', body: s.status === 'retracted' ? '' : s.body });
    }
    if (r === 'staff') {
      const all = (await db.collection('staff').where('active', '==', true).get()).docs.map((d) => d.data()).filter((s) => ORG.GRADE[s.rank]);
      all.sort((a, b) => ORG.GRADE[b.rank].g - ORG.GRADE[a.rank].g || (a.joinedAt || 0) - (b.joinedAt || 0));
      return out(200, { staff: all.map((s) => ({ name: s.name, title: ORG.title(s.rank, s.dept), titleEn: ORG.titleEn(s.rank, s.dept), g: ORG.GRADE[s.rank].g, tier: ORG.GRADE[s.rank].tier, dept: s.dept ? ORG.DEPT[s.dept].zh : '', certs: Object.keys(s.certs || {}).length })) }, 300);
    }
    const limit = Math.max(1, Math.min(50, parseInt(q.limit, 10) || (r === 'headlines' ? 8 : 30)));
    let list = (await db.collection('stories').orderBy('publishedAt', 'desc').limit(80).get()).docs.map((d) => d.data()).filter((s) => s.publishedAt && ['published', 'retracted'].includes(s.status)).sort((a, b) => b.publishedAt - a.publishedAt || b.n - a.n);
    if (r === 'headlines') return out(200, { updated: Date.now(), items: list.filter((s) => s.status === 'published').slice(0, limit).map((s) => ({ id: s.id, title: (s.type === 'flash' ? '【突發】' : s.type === 'opinion' ? '【評論】' : '') + s.title, cat: ORG.CAT[s.cat] || '本地', time: D.hkText(s.publishedAt).slice(5) })) });
    if (q.cat && ORG.CAT[q.cat]) list = list.filter((s) => s.cat === q.cat);
    list = list.slice(0, limit);
    const items = [];
    for (const s of list) items.push(brief(s, await imgUrl(s, budget)));
    return out(200, { updated: Date.now(), cats: ORG.CATS, items });
  } catch (e) {
    console.error('api failed', e);
    return out(500, { error: '暫時讀取不到資料' }, 0);
  }
};
