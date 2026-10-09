'use strict';
// /about 及 /help，以及公司守則（公司簡介面板亦會使用）。
const D = require('./discord');
const B = require('./brand');
const { can, GRADE } = require('./org');
const { BRAND } = B;

const ETHICS = [
  '**一、事實先行。** 每項事實都有來源；查不到就寫「未能證實」，不推測，不虛構。',
  '**二、事實與觀點分開。** 新聞只寫事實；評論必定標明【評論】。',
  '**三、給予回應機會。** 報道指控任何人，都會先向對方查詢，並寫出對方的回應。',
  '**四、未有定論不當作事實。** 未有裁定的指控，一律寫明「涉嫌」「被指」及指控的來源。',
  '**五、錯了公開改正。** 更正會列明改了甚麼；撤回會說明原因。不會悄悄修改或刪除。',
  '**六、編採獨立。** 贊助、合作及私人關係，都不能換取或抽起一篇報道。',
  '**七、申報利益。** 同事不會處理涉及自己或所屬組織的稿件及個案。',
  '**八、只報道模擬世界。** 不收集、不公開任何人的現實個人資料。',
  '**九、親自完成工作及考核。** 稿件、文章及考試必須由本人完成，不得以人工智能工具代寫或代答。',
];

function aboutEmbed() {
  const site = D.site();
  return { color: B.COLOR.brand, author: B.head(), title: `${BRAND.zhFull}　${BRAND.enFull}`, description: `**${BRAND.slogan}**　${BRAND.sloganEn}\n\n本公司是在 Discord 模擬社會內運作的新聞機構。理念是「${BRAND.creed}」：我們不假裝沒有立場，但任何觀點都必須建基於查證過的事實。\n\n**編採守則**\n` + ETHICS.join('\n'), fields: [
    { name: '報料', value: '到「服務台」按「報料」，可選擇匿名；或使用 `/tip`。', inline: true },
    { name: '查詢、投訴及更正要求', value: '到「服務台」選擇類別開立個案；或使用 `/service`。', inline: true },
    { name: '加入我們', value: '到「職位空缺」按「應徵」；或使用 `/apply`。', inline: true },
    ...(site ? [{ name: '網站', value: site }] : []),
  ] };
}
const about = (ctx) => ctx.edit({ embeds: [aboutEmbed()] });

async function help(ctx) {
  const f = [{ name: '所有人', value: '`/about` 公司簡介及編採守則\n`/tip` 報料（可匿名）\n`/service` 查詢、投訴、更正要求、合作、授權\n`/apply` 應徵\n`/verify` 核實證書' }];
  if (ctx.g >= 1) {
    f.push({ name: '員工', value: '`/duty on｜off｜status｜board` 值勤\n`/profile` 員工檔案及晉升進度　`/card` 員工證\n`/academy` 課程、講義及考試　`/cert list｜show` 證書\n`/request new｜list｜view｜cancel` 內部申請\n`/staff list` 員工名冊　`/directory` 部門通訊錄' });
    f.push({ name: '學院及文件', value: '課程頁按「撰寫文章」提交書面評核\n`/course status` 課程開放狀況　`/transcript` 成績單　`/proof` 在職證明' });
    f.push({ name: '日常協作', value: '`/handover` 工作交接　`/task list` 我的任務　`/kudos` 嘉許同事\n`/suggest` 意見箱（可匿名）　`/appeal` 申訴\n`/roster view｜add｜drop` 輪值表　`/portal` 個人專頁\n`/roblox link｜me` 連結 Roblox，遊戲內名牌顯示職銜' });
    f.push({ name: '撰稿', value: '`/story new` 撰稿，然後在草稿按「提交審稿」\n`/story image` 加入圖片　`/story view` 查看或修改草稿　`/story list` 我的稿件\n報料箱按「跟進」認領報料' });
  }
  if (can.review(ctx)) f.push({ name: '審稿', value: '審稿台每篇稿件：批准發佈／改稿／退回修改／不採用\n`/breaking` 即時發佈突發消息\n`/correct` 為已發佈稿件加上更正或澄清　`/poll` 讀者投票' + (can.retract(ctx) ? '\n`/retract` 撤回報道' : '') });
  if (can.cases(ctx)) f.push({ name: '客戶服務', value: '個案處理頻道：接手處理／結案\n`/canned` 標準回覆範本　`/letter new｜guide｜list` 公函\n`/case list｜view｜note｜assign` 個案' + (can.clients(ctx) ? '\n`/client add｜list｜view｜note｜update` 客戶名冊' : '') });
  if (can.approve(ctx, ctx.dept)) f.push({ name: '審批', value: '申請審批頻道：批准／不批准\n`/request list` 查看待你審批的申請' });
  if (can.manage(ctx)) f.push({ name: '管理人員', value: '評卷台：為文章評分（合格／優異／不合格）\n`/task new` 分派任務　`/meeting new｜minutes` 會議　`/class` 現場課堂\n`/review probation｜monthly` 試用期及每月表現評核' + (can.senior(ctx) ? '\n`/report weekly｜inactive｜digest｜stories` 管理報告；意見及申訴頻道處理申訴' : '') + (can.academy(ctx) ? '\n`/course open｜close` 開放或關閉課程' : '') + (can.board(ctx) ? '\n`/resolution` 董事會決議案' : '') });
  if (can.hr(ctx)) f.push({ name: '人事', value: '招聘審批頻道：取錄／不取錄\n`/promote` 按條件晉升一級\n`/staff set` 委任或調整職級　`/staff dept` 調職\n`/staff warn` 紀律警告　`/staff remove` 離職或終止聘用\n`/cert revoke` 撤銷證書' });
  if (can.noticeStaff(ctx)) f.push({ name: '通告', value: '`/notice` 發出員工通告' + (can.noticePublic(ctx) ? '或公司公告' : '') });
  if (can.audit(ctx)) f.push({ name: '紀錄', value: '`/audit` 按類別、同事或編號查閱操作紀錄' });
  if (ctx.admin) f.push({ name: '伺服器管理員', value: '`/setup auto` 一鍵建立身份組、頻道、面板及圖示\n`/setup panels｜icons｜brand` 個別更新\n`/setup channel｜role` 指定現有頻道或身份組　`/setup show` 查看設定' });
  return ctx.edit({ embeds: [{ color: B.COLOR.brand, author: B.head('指令一覽'), description: ctx.g ? `你現時的職銜是 **${ctx.title}**（${ctx.titleEn}，第 ${GRADE[ctx.rank].g} 級）。以下是你可以使用的指令：` : '你尚未是本公司員工，可以使用以下指令：', fields: f }] });
}

module.exports = { help, about, aboutEmbed, ETHICS };
