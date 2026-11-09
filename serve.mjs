// Local preview server: node serve.mjs  ->  http://localhost:5178
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, p === '/' ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    // index.html is written as page content (the artifact host adds the skeleton); add the same skeleton locally
    if (file === path.join(root, 'index.html')) {
      body = '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' +
        body.toString('utf8') + '</body></html>';
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5178, () => console.log('http://localhost:5178'));
