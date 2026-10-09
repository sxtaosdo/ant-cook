import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readPalette } from './palette.mjs';
import { LevelPipeline } from './levelPipeline.ts';

const root = new URL('../../', import.meta.url);
const executionFingerprint = JSON.stringify(LevelPipeline.dependencyHashes());
function assertExecutionFresh() { if (JSON.stringify(LevelPipeline.dependencyHashes()) !== executionFingerprint) throw new Error('Editor execution sources changed since startup; start a new independent service before preview/apply'); }
const json = (res, status, value) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
async function body(req, allowed) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('Expected application/json');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Request exceeds1MB'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected request fields; filesystem paths are never accepted');
  return value;
}

export async function createLevelEditorServer(port = 7469) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid explicit port');
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Use the existing Node22 runtime');
  // Every start gets private compiled files. Existing7468/old output/browser remains untouched.
  const work = await mkdtemp(join(tmpdir(), 'ant-level-editor-v2-'));
  const output = join(work, 'compiled');
  const built = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', fileURLToPath(new URL('tsconfig.json', import.meta.url)), '--outDir', output], {encoding: 'utf8'});
  if (built.status !== 0) throw new Error(built.stdout + built.stderr);
  const palette = await readPalette(), files = new Map();
  const add = async (route, path, type) => files.set(route, {body: await readFile(path), type});
  await add('/', new URL('index.html', import.meta.url), 'text/html; charset=utf-8');
  await add('/editor.css', new URL('editor.css', import.meta.url), 'text/css; charset=utf-8');
  for (const file of ['editor', 'core', 'groupsCore', 'groupsEditor']) await add(`/${file}.js`, join(output, 'scripts/board-editor', `${file}.js`), 'text/javascript; charset=utf-8');
  await add('/assets/Colony/scripts/application/levelCatalog.js', join(output, 'assets/Colony/scripts/application/levelCatalog.js'), 'text/javascript; charset=utf-8');
  const candidates = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const expected = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!expected.has(req.headers.host) || (req.headers.origin && ![...expected].some(host => req.headers.origin === `http://${host}`))) { json(res, 403, {error: 'Local same-origin request required'}); return; }
    try {
      if (req.method === 'GET') {
        if (req.url === '/api/palette') { json(res, 200, palette); return; }
        const file = files.get(req.url); if (!file) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', file.type); res.end(file.body); return;
      }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      if (req.url === '/api/level/preview') {
        const value = await body(req, ['board', 'rules', 'level']);
        assertExecutionFresh();
        const id = randomUUID(), sandbox = LevelPipeline.createSandbox(join(work, `${id}-sandbox`));
        const outputRoot = join(work, `${id}-candidate`), pipeline = new LevelPipeline(sandbox);
        const preview = pipeline.preview(value.board, value.rules, value.level, outputRoot);
        assertExecutionFresh();
        candidates.set(id, {pipeline, plan: preview.plan, confirmation: preview.confirm, sandbox});
        json(res, 200, {id, confirmation: preview.confirm, outputRoot, sandbox, selectionOrder: preview.witness.selectionOrder,
          validation: preview.witness, diff: await readFile(join(outputRoot, 'preview.diff'), 'utf8')}); return;
      }
      if (req.url === '/api/level/apply') {
        const value = await body(req, ['id', 'confirmation']), candidate = candidates.get(value.id);
        assertExecutionFresh();
        if (!candidate || value.confirmation !== candidate.confirmation) throw new Error('Unknown or unreviewed candidate');
        candidate.pipeline.apply(candidate.plan, candidate.confirmation); assertExecutionFresh(); candidates.delete(value.id);
        json(res, 200, {imported: candidate.sandbox}); return;
      }
      res.writeHead(404).end();
    } catch (error) { json(res, 400, {error: error instanceof Error ? error.message : String(error)}); }
  });
  return {server, work, port};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]))) throw new Error('Use --port NUMBER; no automatic port fallback');
    const port = args.length ? Number(args[1]) : 7469;
    const value = await createLevelEditorServer(port);
    value.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    value.server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({url: `http://127.0.0.1:${port}`, work: value.work, version: 'level-editor-v2', pid: process.pid})));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
