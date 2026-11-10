// Read-only Google Analytics 4 report for PixelScience Games.
//   node tools/ga-report.mjs            → last 7 days
//   node tools/ga-report.mjs 28         → last 28 days
// Settings live OUTSIDE this public repo: %USERPROFILE%\.pixelscience\ga.json
//   { "propertyId": "123456789", "keyFile": "C:\\Users\\you\\.pixelscience\\ga-key.json" }
// keyFile = the service account's JSON key (that account only has the Viewer role in Analytics).
// No packages needed: the OAuth token is signed with Node's built-in crypto.
import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const DAYS = Math.max(1, parseInt(process.argv[2] || '7', 10));
const cfgPath = path.join(os.homedir(), '.pixelscience', 'ga.json');
let cfg;
try { cfg = JSON.parse(await readFile(cfgPath, 'utf8')); }
catch { console.error(`設定ファイルがありません: ${cfgPath}`); process.exit(1); }
const key = JSON.parse(await readFile(cfg.keyFile, 'utf8'));
const PROP = String(cfg.propertyId).replace(/\D/g, '');

/* ---------- access token (service account JWT → OAuth) ---------- */
const b64u = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.private_key).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }) });
  const j = await r.json(); if (!j.access_token) throw new Error('認証に失敗: ' + JSON.stringify(j)); return j.access_token;
}
const TOKEN = await token();
async function report(req) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROP}:runReport`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: 'today' }], limit: 200, ...req }) });
  const j = await r.json();
  if (j.error) return { error: j.error.message };
  return (j.rows || []).map(row => [...(row.dimensionValues || []).map(v => v.value), ...(row.metricValues || []).map(v => Number(v.value))]);
}
const evFilter = (name) => ({ dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: name } } } });
const table = (title, rows, cols) => {
  console.log(`\n■ ${title}`);
  if (rows.error){ console.log(`  （取得できません: ${rows.error}）`); return; }
  if (!rows.length){ console.log('  （データなし）'); return; }
  console.log('  ' + cols.join(' | '));
  for (const r of rows) console.log('  ' + r.map(v => typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : v).join(' | '));
};

console.log(`PixelScience Games — 過去${DAYS}日（プロパティ ${PROP}）`);
table('全体', await report({ metrics: [{name:'activeUsers'},{name:'newUsers'},{name:'sessions'},{name:'averageSessionDuration'},{name:'screenPageViews'}] }),
  ['ユーザー','新規','セッション','平均滞在(秒)','表示回数']);
table('日別', await report({ dimensions: [{name:'date'}], metrics: [{name:'activeUsers'},{name:'newUsers'}], orderBys: [{dimension:{dimensionName:'date'}}] }),
  ['日付','ユーザー','新規']);
table('どこから来たか', await report({ dimensions: [{name:'sessionSource'},{name:'sessionMedium'}], metrics: [{name:'sessions'}], orderBys: [{metric:{metricName:'sessions'},desc:true}] }),
  ['参照元','メディア','セッション']);
table('端末', await report({ dimensions: [{name:'deviceCategory'},{name:'operatingSystem'}], metrics: [{name:'activeUsers'}], orderBys: [{metric:{metricName:'activeUsers'},desc:true}] }),
  ['端末','OS','ユーザー']);
table('イベント', await report({ dimensions: [{name:'eventName'}], metrics: [{name:'eventCount'},{name:'totalUsers'}], orderBys: [{metric:{metricName:'eventCount'},desc:true}] }),
  ['イベント','回数','人数']);
// the following need the custom dimensions (event scope: game_id, difficulty, reason, hidden_id; user scope: display_mode)
table('ゲーム別・難易度別の開始回数', await report({ dimensions: [{name:'customEvent:game_id'},{name:'customEvent:difficulty'}], metrics: [{name:'eventCount'},{name:'totalUsers'}], ...evFilter('game_start'), orderBys: [{metric:{metricName:'eventCount'},desc:true}] }),
  ['ゲーム','難易度','回数','人数']);
table('終わり方', await report({ dimensions: [{name:'customEvent:game_id'},{name:'customEvent:reason'}], metrics: [{name:'eventCount'}], ...evFilter('game_over'), orderBys: [{metric:{metricName:'eventCount'},desc:true}] }),
  ['ゲーム','理由','回数']);
table('隠れキャラ', await report({ dimensions: [{name:'customEvent:hidden_id'}], metrics: [{name:'eventCount'},{name:'totalUsers'}], ...evFilter('hidden_found') }),
  ['キャラ','回数','人数']);
table('ホーム画面から遊んでいるか', await report({ dimensions: [{name:'customUser:display_mode'}], metrics: [{name:'activeUsers'}] }),
  ['起動のしかた','ユーザー']);
// retention: of the people who first came on a given day, how many came back 1 / 7 days later
// (cohorts need real dates, YYYY-MM-DD, in Japan time like the property)
function ymd(daysAgo){ return new Date(Date.now() + 9*3600e3 - daysAgo*864e5).toISOString().slice(0, 10); }
{
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROP}:runReport`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      dimensions: [{name:'cohort'},{name:'cohortNthDay'}], metrics: [{name:'cohortActiveUsers'}],
      cohortSpec: { cohorts: [{ name: 'all', dimension: 'firstSessionDate', dateRange: { startDate: ymd(Math.max(DAYS, 8)), endDate: ymd(1) } }],
        cohortsRange: { granularity: 'DAILY', endOffset: 7 } } }) });
  const j = await r.json();
  console.log('\n■ また来た割合（初めて来た人のうち、n日後にも来た人）');
  if (j.error) console.log(`  （取得できません: ${j.error.message}）`);
  else {
    const byDay = {}; for (const row of j.rows || []) byDay[+row.dimensionValues[1].value] = +row.metricValues[0].value;
    const d0 = byDay[0] || 0;
    if (!d0) console.log('  （データなし）');
    else for (const n of [1, 3, 7]) console.log(`  ${n}日後: ${byDay[n]||0}人 / ${d0}人 = ${((byDay[n]||0)/d0*100).toFixed(1)}%`);
  }
}
