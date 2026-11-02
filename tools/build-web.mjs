// Bundles the game into web/dist (index.html, style.css, game.js, audio/).
// `node tools/build-web.mjs --serve` also starts a static server on :8080.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const dist = path.join(web, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(web, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome90'],
  outfile: path.join(dist, 'game.js'),
  legalComments: 'none',
  logLevel: 'info',
});

fs.copyFileSync(path.join(web, 'index.html'), path.join(dist, 'index.html'));
fs.copyFileSync(path.join(web, 'style.css'), path.join(dist, 'style.css'));
const audioSrc = path.join(web, 'audio');
if (fs.existsSync(audioSrc)) {
  fs.mkdirSync(path.join(dist, 'audio'), { recursive: true });
  for (const f of fs.readdirSync(audioSrc)) {
    if (/\.(mp3|ogg|m4a)$/i.test(f)) fs.copyFileSync(path.join(audioSrc, f), path.join(dist, 'audio', f));
  }
}
console.log('web build ready ->', dist);

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.png': 'image/png' };
  http.createServer((req, res) => {
    const p = path.join(dist, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!p.startsWith(dist) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(8080, () => console.log('serving http://localhost:8080'));
}
