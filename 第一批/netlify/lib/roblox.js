'use strict';
// Roblox 連結：員工把 Roblox 帳戶連到員工檔案，Roblox 遊戲內的頭頂名牌即可顯示真實職銜、部門、組別及員工編號。
// 資料：staff/{uid}.robloxId、robloxName、team、seat；索引 roblox/{robloxId} → { uid }
const D = require('./discord');
const FB = require('./fb');
const B = require('./brand');
const ORG = require('./org');
const { DEPT, GRADE, can } = ORG;
const { UserError } = require('./work');
const C = B.COLOR;

async function lookup(username) {
  const r = await fetch('https://users.roblox.com/v1/usernames/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }) });
  if (!r.ok) throw new UserError('暫時連接不到 Roblox，請稍後再試。');
  const j = await r.json();
  const u = j && Array.isArray(j.data) && j.data[0];
  if (!u || !u.id) throw new UserError(`在 Roblox 找不到用戶名稱「${username}」。請輸入用戶名稱（不是顯示名稱）。`);
  return { id: String(u.id), name: u.name, display: u.displayName || u.name };
}

/** 名牌資料：供 /api/roblox 及 /roblox me 使用 */
function tagData(st, onDuty) {
  const r = GRADE[st.rank] || null, d = st.dept ? DEPT[st.dept] : null;
  const team = st.team ? `（${st.team}）` : '';
  return {
    found: true, name: st.name || '', no: st.no || '',
    rank: st.rank || '', g: r ? r.g : 0, tier: r ? r.tier : 0,
    zh: r ? ORG.title(st.rank, st.dept) + team : '', en: r ? ORG.titleEn(st.rank, st.dept) + (st.team ? ` (${st.team})` : '') : '',
    dept: d ? d.zh : '', deptEn: d ? d.fEn : '', team: st.team || '', seat: st.seat || '',
    onDuty: !!onDuty, onLeave: (st.leaveUntil || 0) > Date.now(), certs: Object.keys(st.certs || {}).length,
  };
}

async function profileByRoblox(robloxId) {
  const idx = await FB.getDoc('roblox/' + String(robloxId));
  if (!idx || !idx.uid) return { found: false };
  const st = await FB.getStaff(idx.uid);
  if (!st || !st.active || !GRADE[st.rank]) return { found: false };
  const duty = await FB.getDoc('duty/' + idx.uid);
  return tagData(st, !!duty);
}

async function command(ctx) {
  ctx.need(can.staff(ctx), '只有本公司員工可以連結 Roblox 帳戶。');
  const st = ctx.staff || {};
  if (ctx.sub === 'link') {
    const name = String(ctx.opt('username') || '').trim();
    ctx.need(/^[A-Za-z0-9_]{3,20}$/.test(name), 'Roblox 用戶名稱只可包含英文字母、數字及底線，長度 3 至 20 個字元。');
    const u = await lookup(name);
    const idx = await FB.getDoc('roblox/' + u.id);
    ctx.need(!idx || !idx.uid || idx.uid === ctx.uid, '這個 Roblox 帳戶已連結到另一位同事。如有錯誤，請聯絡人力資源部。');
    if (st.robloxId && st.robloxId !== u.id) await FB.setDoc('roblox/' + st.robloxId, { uid: null });
    await FB.setDoc('roblox/' + u.id, { uid: ctx.uid, at: Date.now() });
    await FB.saveStaff(ctx.uid, { robloxId: u.id, robloxName: u.name });
    await ctx.log('hr', '連結 Roblox 帳戶', u.name, `${ctx.name}｜Roblox ID ${u.id}`);
    return ctx.edit({ embeds: [{ color: C.hr, author: B.head('Roblox 連結'), title: '已連結 Roblox 帳戶', description: `Roblox 用戶：**${u.name}**（${u.display}）\nRoblox ID：${u.id}\n\n下次進入公司 Roblox 遊戲，頭頂名牌會顯示你的職銜及部門。`, footer: { text: '使用 /roblox me 查看名牌會顯示的資料。' } }] });
  }
  if (ctx.sub === 'unlink') {
    ctx.need(st.robloxId, '你尚未連結 Roblox 帳戶。');
    await FB.setDoc('roblox/' + st.robloxId, { uid: null });
    await FB.saveStaff(ctx.uid, { robloxId: null, robloxName: null });
    await ctx.log('hr', '取消連結 Roblox 帳戶', st.robloxName || st.robloxId, ctx.name);
    return ctx.edit({ content: '已取消連結 Roblox 帳戶。' });
  }
  if (ctx.sub === 'me') {
    const t = tagData({ ...st, name: ctx.name, rank: ctx.rank, dept: ctx.dept }, false);
    return ctx.edit({ embeds: [{ color: C.hr, author: B.head('Roblox 名牌'), title: st.robloxName ? `已連結：${st.robloxName}` : '尚未連結 Roblox 帳戶', fields: [
      { name: '名字', value: t.name || '—', inline: true }, { name: '員工編號', value: t.no || '—', inline: true }, { name: '部門', value: t.dept || '—', inline: true },
      { name: '職銜', value: `${t.zh || '—'}\n${t.en || ''}` }, { name: '組別', value: t.team || '未編組', inline: true }, { name: '座位', value: t.seat || '未編配', inline: true },
    ], footer: { text: st.robloxName ? '名牌在遊戲內每分鐘更新一次。' : '使用 /roblox link 輸入你的 Roblox 用戶名稱。' } }] });
  }
  if (ctx.sub === 'seat') {
    const id = ctx.opt('user'), m = (ctx.resolved.members || {})[id], u = (ctx.resolved.users || {})[id] || {};
    ctx.need(id && m, '找不到這位成員。');
    ctx.need(ctx.g >= 5 || can.hr(ctx) || ctx.admin, '只有經理或以上、或人力資源部可以編配組別及座位。');
    const team = String(ctx.opt('team') || '').trim().slice(0, 20), seat = String(ctx.opt('seat') || '').trim().toUpperCase().slice(0, 20);
    ctx.need(!seat || /^[0-9A-Z]{1,3}F?-[A-Z0-9-]{1,14}$/.test(seat), '座位編號格式例如 2F-PB-03 或 4F-D02。');
    const tgt = (await FB.getStaff(id)) || {};
    ctx.need(tgt.active, '對方不是本公司員工。');
    await FB.saveStaff(id, { team: team || null, seat: seat || null });
    const nm = m.nick || u.global_name || u.username || '同事';
    await ctx.log('hr', '編配組別及座位', nm, `組別：${team || '未編組'}｜座位：${seat || '未編配'}`);
    return ctx.edit({ content: `已更新 ${nm}：組別「${team || '未編組'}」，座位「${seat || '未編配'}」。` });
  }
  throw new UserError('未支援的指令。');
}

module.exports = { command, profileByRoblox, tagData, lookup };
