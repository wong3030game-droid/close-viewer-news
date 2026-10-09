'use strict';
// 排程函式：每日香港時間上午九時自動在「管理層會議」頻道發出待跟進事項（時間在 netlify.toml 設定）。
const { runDigest } = require('../lib/plus');
exports.handler = async () => {
  try { return { statusCode: 200, body: await runDigest() }; } catch (e) { console.error('cron failed', e); return { statusCode: 500, body: 'failed' }; }
};
