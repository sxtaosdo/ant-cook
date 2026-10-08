import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readPalette } from './palette.mjs';

const root = new URL('../../', import.meta.url);
const built = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', fileURLToPath(new URL('tsconfig.json', import.meta.url))], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
const palette = await readPalette();
const files = new Map([
  ['/', [new URL('index.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/editor.css', [new URL('editor.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/editor.js', [new URL('temp/board-editor/editor.js', root), 'text/javascript; charset=utf-8']],
  ['/core.js', [new URL('temp/board-editor/core.js', root), 'text/javascript; charset=utf-8']],
]);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  if (req.url === '/api/palette') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(palette)); return; }
  const file = files.get(req.url);
  if (!file) { res.writeHead(404).end('Not found'); return; }
  try { const body = await readFile(file[0]); res.setHeader('Content-Type', file[1]); res.end(body); }
  catch { res.writeHead(500).end('Editor file unavailable'); }
});
server.on('error', error => { console.error(`棋盘编辑器启动失败：${error.message}`); process.exitCode = 1; });
server.listen(7468, '127.0.0.1', () => console.log('棋盘编辑器：http://127.0.0.1:7468 （仅本机；Ctrl+C停止）'));
