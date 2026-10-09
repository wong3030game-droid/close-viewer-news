'use strict';
// 一次性：把斜線指令登記到 Discord。在瀏覽器打開：
//   https://你的網址/.netlify/functions/bot-setup?key=你的 BOT_SETUP_KEY
// 日後更新程式後如指令有變，再打開一次即可。
const D = require('../lib/discord');
const { COMMANDS } = require('../lib/commands');

exports.handler = async (event) => {
  const key = (event.queryStringParameters || {}).key || '';
  const txt = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body });
  if (!process.env.BOT_SETUP_KEY || !D.safeEq(key, process.env.BOT_SETUP_KEY)) return txt(403, '密鑰不正確，或尚未設定 BOT_SETUP_KEY。');
  const miss = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DISCORD_PUBLIC_KEY', 'SITE_URL'].filter((k) => !process.env[k]);
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.FIREBASE_PRIVATE_KEY) miss.push('FIREBASE_SERVICE_ACCOUNT');
  if (miss.length) return txt(500, '缺少環境變數：' + miss.join('、') + '\n填妥後請重新部署（Deploys → Trigger deploy）。');
  try {
    const res = await D.api('PUT', `/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`, COMMANDS);
    return txt(200, `已登記 ${res.length} 個指令：\n` + res.map((c) => '/' + c.name).join('\n') + '\n\n回到 Discord 輸入 / 便會看到。看不到請重新啟動 Discord。\n下一步：在伺服器輸入 /setup auto。');
  } catch (e) {
    return txt(500, '登記失敗：' + e.message + '\n\n常見原因：Bot Token 不正確；或機器人未以「applications.commands」範圍加入伺服器；或 DISCORD_GUILD_ID 不正確。');
  }
};
