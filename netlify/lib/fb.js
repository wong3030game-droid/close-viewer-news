'use strict';
// 資料庫（Firestore）存取。所有資料只經服務帳戶讀寫，瀏覽器不會直接接觸資料庫。
const admin = require('firebase-admin');

function init() {
  if (!admin.apps.length) {
    // 一般使用 FIREBASE_SERVICE_ACCOUNT（整個 JSON）。如 Netlify 指環境變數過長，可改用三個欄位。
    const e = process.env;
    const cred = e.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(e.FIREBASE_SERVICE_ACCOUNT) : { projectId: e.FIREBASE_PROJECT_ID, clientEmail: e.FIREBASE_CLIENT_EMAIL, privateKey: String(e.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n') };
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  return admin;
}
const db = () => init().firestore();

/** 操作紀錄：誰、何時、做了甚麼。cat 為紀錄類別（editorial／hr／request／client／academy／duty／system）。 */
async function audit(who, cat, action, ref, detail) {
  try { await db().collection('audit').add({ at: Date.now(), cat, uid: who.uid || '', name: who.name || '', title: who.title || '', action, ref: ref || '', detail: detail || '' }); } catch (e) { console.warn('audit failed', e.message); }
}

async function settings() {
  const s = await db().doc('settings/main').get();
  const d = s.exists ? s.data() : {};
  const o = (k) => ({ ...(d[k] || {}) });
  return { staffRole: '', ...d, channels: o('channels'), roles: o('roles'), depts: o('depts'), cats: o('cats'), emoji: o('emoji'), panels: o('panels') };
}
const saveSettings = (patch) => db().doc('settings/main').set(patch, { merge: true });

/** 流水號。kind 例：story、request、case、client、staff、app；按年重新計算的用 `cert-2026` 這類名稱。 */
async function next(kind) {
  const ref = db().doc('counters/' + kind);
  return db().runTransaction(async (t) => {
    const s = await t.get(ref);
    const v = ((s.exists && s.data().n) || 0) + 1;
    t.set(ref, { n: v });
    return v;
  });
}
const pad = (n, w = 4) => String(n).padStart(w, '0');
/** 將使用者輸入的編號整理成標準格式：norm('CS', 'cs-12') → CS-0012；只輸入數字亦可。 */
function norm(prefix, x) {
  const m = /(\d{1,6})\s*$/.exec(String(x || '').trim());
  return m ? `${prefix}-${pad(parseInt(m[1], 10))}` : '';
}

const getDoc = async (path) => { const s = await db().doc(path).get(); return s.exists ? s.data() : null; };
const setDoc = (path, patch) => db().doc(path).set(patch, { merge: true });

/* 稿件：CV-0001 */
async function nextStoryId() { const n = await next('story'); return { n, id: 'CV-' + pad(n) }; }
const normId = (x) => norm('CV', x);
const getStory = (x) => { const id = normId(x); return id ? getDoc('stories/' + id) : null; };
const saveStory = (id, patch) => setDoc('stories/' + id, patch);

/* 員工 */
const getStaff = (uid) => getDoc('staff/' + uid);
const saveStaff = (uid, patch) => setDoc('staff/' + uid, patch);

module.exports = { init, db, audit, settings, saveSettings, next, pad, norm, getDoc, setDoc, nextStoryId, normId, getStory, saveStory, getStaff, saveStaff };
