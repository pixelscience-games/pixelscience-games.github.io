// Builds the public website into ./docs (served by GitHub Pages).
//   node build.mjs   → docs/index.html, manifest, icons, service worker
// Settings come from site.config.json (siteUrl for link previews, gaId = Google Analytics measurement ID);
// SITE_URL / GA_ID environment variables override them.
// index.html stays the single source of the game (it is also what the claude.ai artifact publishes).
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'docs');
let cfg = {};
try { cfg = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8')); } catch {}
const SITE_URL = (process.env.SITE_URL || cfg.siteUrl || '').replace(/\/?$/, '/');
const GA_ID = (process.env.GA_ID ?? cfg.gaId ?? '').trim();
if (GA_ID && !/^G-[A-Z0-9]{4,}$/.test(GA_ID)) throw new Error(`gaId "${GA_ID}" does not look like a GA4 measurement ID (G-XXXXXXX)`);
const VERSION = new Date().toISOString().replace(/\D/g, '').slice(0, 12);

const TITLE = 'PixelScience Games';                                    // app name (manifest)
const PAGE_TITLE = 'PixelScience Games｜指一本で遊べる科学ミニゲーム';   // page / link-preview title
const DESC = '遊んでわかる！科学の「なぜ？」 PixelScienceの科学ミニゲーム集。指一本で遊べる6本のゲームと、114の「なぜ？」図鑑。';

/* ---------- tiny PNG encoder (RGBA) ---------- */
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/* ---------- app icon: the channel's robot on a night-sky tile ---------- */
const ROBOT = [
  '.......A........', '.......K........', '....WWWWWWWW....', '...WLWWWWWWWW...', '..WWVVVVVVVVWW..', '.XWWVEEVVEEVWWX.',
  '.XWWVEEVVEEVWWX.', '..WWVVVVVVVVWW..', '...WWWWWWWWWW...', '....wwwwwwww....', '......kkkk......', '..w.XXXXXXXX.w..',
  '..W.XWWWWWWX.W..', '..W.XWWddWWX.W..', '..w.XWWWWWWX.w..', '....XXXXXXXX....', '.....kk..kk.....', '....kkk..kkk....'];
const RPAL = { A: '#ff5050', K: '#3a3a4a', W: '#eef2fa', L: '#ffffff', w: '#b9c2d6', V: '#1d2340', E: '#6ff7ff', e: '#3aa8c0', X: '#2fb7ff', k: '#5a6278', d: '#2fb7ff' };
function robotGrid() {
  // add a 1px dark outline like the videos' sprites
  const h = ROBOT.length + 2, w = ROBOT[0].length + 2, g = Array.from({ length: h }, () => Array(w).fill(null));
  const at = (x, y) => (y >= 0 && y < ROBOT.length && x >= 0 && x < ROBOT[0].length && ROBOT[y][x] !== '.') ? RPAL[ROBOT[y][x]] : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x - 1, y - 1);
    if (c) g[y][x] = c;
    else if (at(x - 2, y - 1) || at(x, y - 1) || at(x - 1, y - 2) || at(x - 1, y)) g[y][x] = '#1c1426';
  }
  return g;
}
function icon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const bgTop = hex('#0b1440'), bgBot = hex('#1d3f9a');
  const r = maskable ? 0 : size * 0.18;            // rounded tile unless maskable (the OS crops it)
  const inRound = (x, y) => {
    if (!r) return true;
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = (y * size + x) * 4;
    if (!inRound(x + .5, y + .5)) continue;
    const f = y / size, c = bgTop.map((v, i) => Math.round(v + (bgBot[i] - v) * f));
    buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; buf[p + 3] = 255;
  }
  // a few stars
  const star = (sx, sy, col) => { const s = Math.max(1, Math.round(size / 96)); const [R, G, B] = hex(col);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const p = ((Math.round(sy * size) + y) * size + Math.round(sx * size) + x) * 4; buf[p] = R; buf[p + 1] = G; buf[p + 2] = B; buf[p + 3] = 255; } };
  [[.2, .18, '#ffd23a'], [.78, .14, '#f4f8ff'], [.86, .4, '#f4f8ff'], [.12, .55, '#f4f8ff'], [.7, .8, '#ffd23a']].forEach(([x, y, c]) => star(x, y, c));
  // robot, nearest-neighbour scaled
  const g = robotGrid(), gw = g[0].length, gh = g.length;
  const scale = Math.floor(size * (maskable ? 0.55 : 0.68) / gh);
  const ox = Math.round((size - gw * scale) / 2), oy = Math.round((size - gh * scale) / 2);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const c = g[y][x]; if (!c) continue; const [R, G, B] = hex(c);
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
      const p = ((oy + y * scale + yy) * size + ox + x * scale + xx) * 4;
      buf[p] = R; buf[p + 1] = G; buf[p + 2] = B; buf[p + 3] = 255;
    }
  }
  return png(size, size, buf);
}

/* ---------- page ---------- */
const src = await readFile(path.join(root, 'index.html'), 'utf8');
const cut = src.indexOf('<div id="app">');
if (cut < 0) throw new Error('index.html: <div id="app"> not found');
const headPart = src.slice(0, cut), bodyPart = src.slice(cut);
const ogImage = SITE_URL !== '/' ? `${SITE_URL}icon-512.png` : 'icon-512.png';

const page = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#070b2b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PS Games">
<meta property="og:type" content="website">
<meta property="og:title" content="${PAGE_TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="${ogImage}">
${SITE_URL !== '/' ? `<meta property="og:url" content="${SITE_URL}">\n` : ''}<meta name="twitter:card" content="summary">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>html{box-sizing:border-box;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}</style>
${GA_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }
gtag('js', new Date());
gtag('set', 'user_properties', {display_mode: (matchMedia('(display-mode: standalone)').matches || navigator.standalone) ? 'home_screen' : 'browser'});
gtag('config', '${GA_ID}');
</script>
` : ''}${headPart.trim()}
</head>
<body>
${bodyPart.trim()}
<script>
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
</script>
</body>
</html>
`;

const manifest = {
  name: TITLE, short_name: 'PS Games', description: DESC, lang: 'ja',
  start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#070b2b', theme_color: '#070b2b',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// offline: cache the game shell; fonts are cached the first time they load
const sw = `const CACHE = 'psg-${VERSION}';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate'){   // the page: network first so updates show up, cache when offline
    const scope = new URL(self.registration.scope).pathname;
    if (url.pathname !== scope && url.pathname !== scope + 'index.html'){   // other pages (e.g. privacy-youtube.html): never stored as the game
      e.respondWith(fetch(req).catch(() => caches.match(req)));
      return;
    }
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin === location.origin || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === 'opaque'){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
  }
});
`;

await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'index.html'), page);
await writeFile(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
await writeFile(path.join(out, 'sw.js'), sw);
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'icon-192.png'), icon(192));
await writeFile(path.join(out, 'icon-512.png'), icon(512));
await writeFile(path.join(out, 'icon-maskable-512.png'), icon(512, { maskable: true }));
await writeFile(path.join(out, 'apple-touch-icon.png'), icon(180, { maskable: true }));
// standalone pages (e.g. the YouTube tool's privacy policy) are copied as they are from ./pages
const pagesDir = path.join(root, 'pages');
for (const f of await readdir(pagesDir).catch(() => [])) if (f.endsWith('.html')) await copyFile(path.join(pagesDir, f), path.join(out, f));
console.log(`built docs/ (version ${VERSION})${SITE_URL !== '/' ? ' for ' + SITE_URL : ''}${GA_ID ? ' with Google Analytics ' + GA_ID : ' (no analytics)'}`);
