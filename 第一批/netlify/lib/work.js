'use strict';
// 背景程式的總機：整理好「誰、甚麼職級、按了甚麼」，再分派到各系統的處理程式。
const D = require('./discord');
const FB = require('./fb');
const ORG = require('./org');
const B = require('./brand');
const { fields } = require('./modals');

class UserError extends Error {}

/** 回覆工具。edit：修改「處理中」訊息，或（按鈕）修改按鈕所在的訊息。follow：另發一則只有本人可見的訊息。兩者都可附檔案。 */
function hook(i) {
  const base = `/webhooks/${i.application_id}/${i.token}`;
  const body = (p) => (typeof p === 'string' ? { content: p } : p);
  return {
    edit: (p, files) => D.api('PATCH', `${base}/messages/@original`, body(p), files, { noAuth: true }),
    follow: (p, files) => D.api('POST', base, { flags: 64, ...body(p) }, files, { noAuth: true }),
  };
}

/** 紀錄類別 → 紀錄頻道 */
const LOGS = { editorial: '編採紀錄', hr: '人事行政紀錄', request: '申請紀錄', client: '客戶紀錄', academy: '培訓紀錄', duty: '值勤紀錄', system: '系統紀錄' };

async function makeCtx(i) {
  const settings = await FB.settings();
  const member = i.member || {}, user = member.user || i.user || {};
  const who = ORG.resolve(member, settings);
  const d = i.data || {};
  const sub = i.type === 2 && d.options && d.options[0] && d.options[0].type === 1 ? d.options[0] : null;
  const opts = sub ? sub.options || [] : d.options || [];
  const ctx = {
    i, settings, member, user, ...hook(i),
    uid: user.id, name: member.nick || user.global_name || user.username || '成員',
    rank: who.rank, g: who.g, dept: who.dept, admin: D.isAdmin(member),
    examiner: !!(settings.examinerRole && (member.roles || []).includes(settings.examinerRole)),
    nameAlts: [user.global_name, user.username].filter(Boolean),
    sub: sub ? sub.name : '',
    opt: (n) => { const o = opts.find((x) => x.name === n); return o ? o.value : undefined; },
    resolved: d.resolved || {},
    fields: i.type === 5 ? fields(i) : {},
    cid: String(d.custom_id || '').split(':'),
    values: d.values || [],
    guild: i.guild_id,
    em: (k) => B.em(settings, k), emo: (k) => B.emo(settings, k),
  };
  ctx.title = ORG.title(ctx.rank, ctx.dept);
  ctx.titleEn = ORG.titleEn(ctx.rank, ctx.dept);
  ctx.who = { uid: ctx.uid, name: ctx.name, title: ctx.title };
  // 員工檔案：以 Discord 身份組為準，檔案隨之同步（網站名冊使用）
  ctx.staff = null;
  if (ctx.g > 0 && ctx.uid) {
    ctx.staff = (await FB.getStaff(ctx.uid)) || {};
    const st = ctx.staff, patch = {};
    if (st.name !== ctx.name) patch.name = ctx.name;
    if (st.rank !== ctx.rank) patch.rank = ctx.rank;
    if ((st.dept || '') !== ctx.dept) patch.dept = ctx.dept;
    if (st.active !== true) patch.active = true;
    if (!st.joinedAt) patch.joinedAt = Date.now();
    if (!st.no) patch.no = 'S' + FB.pad(await FB.next('staff'));
    if (Object.keys(patch).length) { await FB.saveStaff(ctx.uid, patch); Object.assign(st, patch); }
  }
  ctx.need = (ok, msg) => { if (!ok) throw new UserError(msg); };
  ctx.needChannel = (key, zh) => { const c = settings.channels[key]; if (!c) throw new UserError(`尚未設定「${zh}」頻道。請管理員使用 /setup auto，或以 /setup channel 指定。`); return c; };
  /** 寫入對應的紀錄頻道及 audit 資料集 */
  ctx.log = async (cat, action, ref, detail) => {
    await FB.audit(ctx.who, cat, action, ref, detail);
    const ch = settings.channels['log_' + cat];
    if (!ch) return;
    try {
      await D.api('POST', `/channels/${ch}/messages`, { embeds: [{ color: B.COLOR.log, description: `**${action}**${ref ? '｜' + ref : ''}${detail ? '\n' + D.trunc(detail, 700) : ''}`, footer: { text: `${ctx.name}${ctx.title ? '｜' + ctx.title : ''}` }, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });
    } catch (e) { console.log('log failed', cat, e.message); }
  };
  return ctx;
}

async function work(i) {
  const ctx = await makeCtx(i);
  const S = require('./stories'), H = require('./hr'), A = require('./academy'), R = require('./requests'), C = require('./cases'), DU = require('./duty'), N = require('./notices'), HP = require('./help'), E = require('./essays'), O = require('./office'), PL = require('./plus'), LT = require('./letters');
  if (i.type === 2) {
    const map = {
      story: S.command, correct: S.correct, retract: S.retract,
      profile: H.profile, card: H.card, promote: H.promote, staff: H.staff,
      academy: A.home, cert: A.cert, verify: A.verify, course: A.course, transcript: A.transcript, proof: H.proof,
      review: PL.review, roster: PL.roster, poll: PL.poll, class: PL.klass, portal: PL.portal, letter: LT.command,
      roblox: require('./roblox').command, kudos: O.kudos, meeting: O.meeting, task: O.task, report: O.report, directory: O.directory, canned: O.canned,
      duty: DU.command, request: R.command, case: C.command, client: C.client,
      audit: require('./records').command, setup: require('./setup').command, help: HP.help, about: HP.about,
    };
    const fn = map[i.data.name];
    if (!fn) throw new UserError('未支援的指令。');
    return fn(ctx);
  }
  const [a, b] = ctx.cid;
  if (i.type === 3) {
    if (a === 'st' || a === 'rv') return S.button(ctx);
    if (a === 'tp') return S.tipClaim(ctx);
    if (a === 'hr') return H.button(ctx);
    if (a === 'ac') return A.button(ctx);
    if (a === 'rq') return R.button(ctx);
    if (a === 'cs') return C.button(ctx);
    if (a === 'es') return E.button(ctx);
    if (a === 'mt') return O.meetingButton(ctx);
    if (a === 'tk') return O.taskButton(ctx);
    if (a === 'rs') return O.resolutionButton(ctx);
    if (a === 'pl') return PL.pollButton(ctx);
    if (a === 'cl') return PL.classButton(ctx);
    if (a === 'lt') return LT.button(ctx);
    if (a === 'pa') return require('./practical').button(ctx);
    if (a === 'aa') return A.adminButton(ctx);
    if (a === 'p') {
      if (b === 'duty') { ctx.sub = ctx.cid[2]; return DU.command(ctx); }
      if (b === 'profile') return H.profile(ctx);
      if (b === 'card') return H.card(ctx);
      if (b === 'academy') return A.home(ctx);
      if (b === 'aa') return A.adminPanel(ctx);
      if (b === 'reqs') { ctx.sub = 'list'; return R.command(ctx); }
      if (b === 'help') return HP.help(ctx);
      if (b === 'tasks') { ctx.sub = 'list'; return O.task(ctx); }
      if (b === 'transcript') return A.transcript(ctx);
      if (b === 'proof') return H.proof(ctx);
      if (b === 'portal') return PL.portal(ctx);
      if (b === 'roster') { ctx.sub = 'view'; return PL.roster(ctx); }
    }
  }
  if (i.type === 5) {
    if (['new', 'edit', 'brk', 'return', 'reject'].includes(b)) return S.modal(ctx);
    if (b === 'tip') return S.tipSubmit(ctx);
    if (b === 'apply') return H.applySubmit(ctx);
    if (b === 'hrno') return H.declineSubmit(ctx);
    if (b === 'req') return R.submit(ctx);
    if (b === 'rqno') return R.rejectSubmit(ctx);
    if (b === 'case') return C.submit(ctx);
    if (b === 'csclose') return C.closeSubmit(ctx);
    if (b === 'notice') return N.submit(ctx);
    if (b === 'essay') return E.submit(ctx);
    if (b === 'cstudy') return E.submit(ctx, 'case');
    if (b === 'certname') return A.certNameSubmit(ctx);
    if (b === 'papass' || b === 'pafail') return require('./practical').resultSubmit(ctx);
    if (b === 'esfail') return E.failSubmit(ctx);
    if (b === 'esvpass' || b === 'esvdist') return E.vivaSubmit(ctx);
    if (b === 'letter') return LT.submit(ctx);
    if (b === 'ltno') return LT.returnSubmit(ctx);
    if (b === 'suggest') return O.suggestSubmit(ctx);
    if (b === 'appeal') return O.appealSubmit(ctx);
    if (b === 'apkeep' || b === 'apchange') return O.appealDecide(ctx);
    if (b === 'meeting') return O.meetingSubmit(ctx);
    if (b === 'handover') return O.handoverSubmit(ctx);
    if (b === 'tkdone') return O.taskDone(ctx);
    if (b === 'resolution') return O.resolutionSubmit(ctx);
    if (b === 'dutyoff') { ctx.sub = 'off'; return DU.command(ctx); }
  }
  throw new UserError('未支援的操作。');
}

module.exports = { work, UserError, hook, makeCtx, LOGS };
