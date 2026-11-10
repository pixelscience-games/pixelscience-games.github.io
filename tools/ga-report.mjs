// Read-only Google Analytics 4 report for PixelScience Games.
//   node tools/ga-report.mjs            → the 7 days up to yesterday (today is still being collected, so it is left out)
//   node tools/ga-report.mjs 28         → the 28 days up to yesterday
// Settings live OUTSIDE this public repo, in a ".pixelscience" folder (OneDrive first, so every PC
// signed in to the same OneDrive can run this):
//   1. %PIXELSCIENCE_DIR%   2. %OneDrive%\.pixelscience   3. %USERPROFILE%\OneDrive\.pixelscience   4. %USERPROFILE%\.pixelscience
// ga.json: { "propertyId": "123456789", "keyFile": "ga-key.json" }   (keyFile may be relative to ga.json)
// keyFile = the service account's JSON key (that account only has the Viewer role in Analytics).
// No packages needed: the OAuth token is signed with Node's built-in crypto.
import { readFile, access } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const DAYS = Math.max(1, parseInt(process.argv[2] || '7', 10));
// N full days ending yesterday: NdaysAgo .. yesterday (both in the property's time zone, Japan time)
function ymd(daysAgo){ return new Date(Date.now() + 9*3600e3 - daysAgo*864e5).toISOString().slice(0, 10); }
const RANGE = { startDate: `${DAYS}daysAgo`, endDate: 'yesterday' };
const dirs = [process.env.PIXELSCIENCE_DIR,
  process.env.OneDrive && path.join(process.env.OneDrive, '.pixelscience'),
  path.join(os.homedir(), 'OneDrive', '.pixelscience'),
  path.join(os.homedir(), '.pixelscience')].filter(Boolean);
let cfgDir = null;
for (const d of dirs){ try { await access(path.join(d, 'ga.json')); cfgDir = d; break; } catch {} }
if (!cfgDir){ console.error('設定ファイル ga.json が見つかりません。探した場所:\n  ' + dirs.join('\n  ')); process.exit(1); }
const cfg = JSON.parse(await readFile(path.join(cfgDir, 'ga.json'), 'utf8'));
const key = JSON.parse(await readFile(path.resolve(cfgDir, cfg.keyFile), 'utf8'));
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
    body: JSON.stringify({ dateRanges: [RANGE], limit: 200, ...req }) });
  const j = await r.json();
  if (j.error) return { error: j.error.message };
  return (j.rows || []).map(row => [...(row.dimensionValues || []).map(v => v.value), ...(row.metricValues || []).map(v => Number(v.value))]);
}
const evFilter = (name) => ({ dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: name } } } });
const table = (title, rows, cols, custom = false) => {
  console.log(`\n■ ${title}`);
  if (rows.error){ console.log(`  （取得できません: ${rows.error}）`); return; }
  if (!rows.length){ console.log('  （データなし）'); return; }
  console.log('  ' + cols.join(' | '));
  let blank = false;
  for (const r of rows) console.log('  ' + r.map(v => {
    if (typeof v === 'number') return Number.isInteger(v) ? v : v.toFixed(1);
    if (v === '(not set)' || v === '') { blank = true; return v === '' ? '（空欄）' : v; }
    return v; }).join(' | '));
  if (blank) console.log(custom
    ? '  ※ (not set)・（空欄）＝値が届いていない行。カスタムディメンションの登録（2026-11-10）より前のデータか、登録後の集計待ち（反映に 24〜48 時間かかることがある）'
    : '  ※ (not set)・（空欄）＝GA4 が値を判定できなかった行（集計中のこともある）');
};

console.log(`PixelScience Games — ${ymd(DAYS)} 〜 ${ymd(1)}（JST、昨日までの${DAYS}日。今日は集計中のため含めない。プロパティ ${PROP}）`);
table('全体', await report({ metrics: [{name:'activeUsers'},{name:'newUsers'},{name:'sessions'},{name:'averageSessionDuration'},{name:'screenPageViews'}] }),
  ['ユーザー','新規','セッション','平均滞在(秒)','表示回数']);
table('日別', await report({ dimensions: [{name:'date'}], metrics: [{name:'activeUsers'},{name:'newUsers'}], orderBys: [{dimension:{dimensionName:'date'}}] }),
  ['日付','ユーザー','新規']);
table('どこから来たか', await report({ dimensions: [{name:'sessionSource'},{name:'sessionMedium'},{name:'sessionCampaignName'},{name:'sessionManualAdContent'}], metrics: [{name:'sessions'}], orderBys: [{metric:{metricName:'sessions'},desc:true}] }),
  ['参照元','メディア','キャンペーン','コンテンツ(utm_content)','セッション']);
table('端末', await report({ dimensions: [{name:'deviceCategory'},{name:'operatingSystem'}], metrics: [{name:'activeUsers'}], orderBys: [{metric:{metricName:'activeUsers'},desc:true}] }),
  ['端末','OS','ユーザー']);
table('イベント', await report({ dimensions: [{name:'eventName'}], metrics: [{name:'eventCount'},{name:'totalUsers'}], orderBys: [{metric:{metricName:'eventCount'},desc:true}] }),
  ['イベント','回数','人数']);
// the following need the custom dimensions (event scope: game_id, difficulty, reason, hidden_id; user scope: display_mode)
table('ゲーム別・難易度別の開始回数', await report({ dimensions: [{name:'customEvent:game_id'},{name:'customEvent:difficulty'}], metrics: [{name:'eventCount'},{name:'totalUsers'}], ...evFilter('game_start'), orderBys: [{metric:{metricName:'eventCount'},desc:true}] }),
  ['ゲーム','難易度','回数','人数'], true);
table('終わり方', await report({ dimensions: [{name:'customEvent:game_id'},{name:'customEvent:reason'}], metrics: [{name:'eventCount'}], ...evFilter('game_over'), orderBys: [{metric:{metricName:'eventCount'},desc:true}] }),
  ['ゲーム','理由','回数'], true);
table('隠れキャラ', await report({ dimensions: [{name:'customEvent:hidden_id'}], metrics: [{name:'eventCount'},{name:'totalUsers'}], ...evFilter('hidden_found') }),
  ['キャラ','回数','人数'], true);
table('ホーム画面から遊んでいるか', await report({ dimensions: [{name:'customUser:display_mode'}], metrics: [{name:'activeUsers'}] }),
  ['起動のしかた','ユーザー'], true);
// retention: of the people who first came on a given day, how many came back 1 / 7 days later
// (cohorts need real dates, YYYY-MM-DD, in Japan time like the property; ymd() is defined at the top)
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
