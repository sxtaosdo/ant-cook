import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { RuntimeLevelStore } from '../../scripts/board-editor/runtimeLevelStore.ts';
import { basicExample } from '../../scripts/board-editor/groupsView.ts';
import { draftDocument } from '../../scripts/board-editor/groupsCore.ts';

const roots: string[] = [];
const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
function root(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'ant-runtime-store-')));
  roots.push(path); return path;
}
function fixture() {
  const project = root(), path = join(project, RuntimeLevelStore.relativePath);
  mkdirSync(dirname(path), { recursive: true });
  const levels = Array.from({ length: 60 }, (_, index) => ({ level: index + 1, sourceId: `original-${index + 1}`,
    shape: 'PROVISIONAL_FOX', themeId: `theme-${Math.floor(index / 12)}`, targetItemId: `art-${index + 1}`,
    rows: 1, columns: 1, cells: [{ id: 'original-cell', row: 0, column: 0, color: 'berry' }],
    groups: [{ id: 'original-group', color: 'berry', count: 1, pile: 0, depth: 0 }],
    initialSlots: [8, 14, 20].includes(index + 1) ? 6 : 5, queueColumns: 5,
    untouchedRewardMetadata: { coins: index + 1 } }));
  const document = { schema: 'food-hunt-development-level-catalog-v1', levels };
  const bytes = Buffer.from(`\uFEFF${JSON.stringify(document)}\r\n`);
  writeFileSync(path, bytes);
  return { root: project, path, document, bytes, store: new RuntimeLevelStore(project) };
}
function draft(targetLevel = 7) {
  const value = basicExample();
  value.targetLevel = targetLevel;
  value.cellOrder = ['0.2', '0.1', '0.0'];
  value.selectionOrder = [];
  return draftDocument(value);
}
function saved(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
}
afterEach(() => {
  for (const path of roots.splice(0)) {
    const part = relative(resolve(tmpdir()), resolve(path));
    assert.ok(!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`) && part.startsWith('ant-runtime-store-'));
    rmSync(path, { recursive: true, force: true });
  }
});

test('reads exactly 60 validated levels and hashes original bytes including BOM and CRLF', () => {
  const value = fixture(), read = value.store.read();
  assert.equal(read.hash, hash(value.bytes));
  assert.equal(read.catalog.levels.length, 60);
  assert.equal(read.catalog.levels[7]?.initialSlots, 6);
  assert.equal(existsSync(join(value.root, 'temp')), false);
});
test('save changes only target gameplay, preserves art/identity/rewards and manual cell order without a witness', () => {
  const value = fixture(), before = value.store.read();
  const result = value.store.save(draft(), before.hash);
  assert.equal(result.level, 7);
  assert.equal(result.relativePath, RuntimeLevelStore.relativePath);
  assert.equal(result.hash, hash(readFileSync(value.path)));
  const data = saved(value.path), levels = data.levels as Record<string, unknown>[];
  assert.deepEqual(levels.filter((_, index) => index !== 6), value.document.levels.filter((_, index) => index !== 6));
  const target = levels[6]!;
  for (const key of ['level', 'sourceId', 'themeId', 'targetItemId', 'shape', 'untouchedRewardMetadata'] as const) assert.deepEqual(target[key], value.document.levels[6]![key]);
  assert.deepEqual((target.cells as { column: number }[]).map(cell => cell.column), [2, 1, 0]);
  assert.deepEqual(Object.keys(target).filter(key => /selectionOrder|editorState|witness/.test(key)), []);
  assert.deepEqual(readFileSync(join(value.root, 'temp', 'board-editor-backups', `${before.hash}.json`)), value.bytes);
  assert.equal(lstatSync(value.path).nlink, 1);
  assert.equal(readdirSync(dirname(value.path)).some(name => name.startsWith('.runtime-levels-') || name === '.runtime-levels.lock'), false);
});
test('empty order uses existing automatic preparation; target 8 gets runtime six-slot rule', () => {
  const value = fixture(), input = draft(8); input.cellOrder = [];
  value.store.save(input, value.store.read().hash);
  const target = value.store.read().catalog.levels[7]!;
  assert.equal(target.initialSlots, 6);
  assert.deepEqual(target.cells.map(cell => cell.column), [0, 1, 2]);
});
test('stale and malformed CAS hashes do not overwrite the target', () => {
  const value = fixture(), before = value.store.read();
  writeFileSync(value.path, `${value.bytes.toString('utf8')} `);
  const changed = readFileSync(value.path);
  assert.throws(() => value.store.save(draft(), before.hash), /changed/);
  assert.throws(() => value.store.save(draft(), '../chosen-path'), /SHA-256/);
  assert.deepEqual(readFileSync(value.path), changed);
  assert.equal(existsSync(join(value.root, 'temp')), false);
});
test('invalid schema, count, supply rule and gameplay are rejected without fallback', () => {
  const value = fixture();
  const cases: unknown[] = [
    { ...value.document, schema: 'other' },
    { ...value.document, levels: value.document.levels.slice(0, 59) },
    { ...value.document, levels: [...value.document.levels, value.document.levels[59]] },
    { ...value.document, levels: value.document.levels.map((level, index) => index === 7 ? { ...level, initialSlots: 5 } : level) },
    { ...value.document, levels: value.document.levels.map((level, index) => index === 0 ? { ...level, groups: [{ ...level.groups[0], count: 2 }] } : level) },
  ];
  for (const data of cases) {
    writeFileSync(value.path, JSON.stringify(data));
    const bytes = readFileSync(value.path);
    assert.throws(() => value.store.read());
    assert.throws(() => value.store.save(draft(), hash(bytes)));
    assert.deepEqual(readFileSync(value.path), bytes);
  }
  writeFileSync(value.path, '{');
  assert.throws(() => value.store.read());
  assert.equal(existsSync(join(value.root, 'temp')), false);
});
test('invalid draft/order/domain and browser path fields never write or silently repair manual order', () => {
  const value = fixture(), read = value.store.read();
  const input = draft();
  const invalid: unknown[] = [{ ...input, targetLevel: 61 }, { ...input, path: 'elsewhere.json' },
    { ...input, cellOrder: ['0.0'] }, { ...input, groups: [{ ...input.groups[0], count: 999 }] }];
  for (const document of invalid) assert.throws(() => value.store.save(document, read.hash));
  assert.deepEqual(readFileSync(value.path), value.bytes);
  assert.equal(existsSync(join(value.root, 'temp')), false);
});
test('conflicting immutable backup is never overwritten and blocks target replacement', () => {
  const value = fixture(), read = value.store.read(), directory = join(value.root, 'temp', 'board-editor-backups');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${read.hash}.json`), conflict = Buffer.from('conflicting retained backup');
  writeFileSync(path, conflict);
  assert.throws(() => value.store.save(draft(), read.hash), /Backup conflicts/);
  assert.deepEqual(readFileSync(path), conflict);
  assert.deepEqual(readFileSync(value.path), value.bytes);
  assert.equal(existsSync(join(dirname(value.path), '.runtime-levels.lock')), false);
});
test('an existing exact-byte backup is reused without replacement', () => {
  const value = fixture(), read = value.store.read(), directory = join(value.root, 'temp', 'board-editor-backups');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${read.hash}.json`);
  writeFileSync(path, value.bytes);
  const inode = lstatSync(path).ino;
  value.store.save(draft(), read.hash);
  assert.equal(lstatSync(path).ino, inode);
  assert.deepEqual(readFileSync(path), value.bytes);
});
test('regular target with a hard-link alias is rejected for both read and save', () => {
  const value = fixture(), alias = join(value.root, 'aliased.json');
  linkSync(value.path, alias);
  assert.throws(() => value.store.read(), /hard links/);
  assert.throws(() => value.store.save(draft(), hash(value.bytes)), /hard links/);
  assert.deepEqual(readFileSync(alias), value.bytes);
});
test('hard-linked backup is rejected even if bytes match', () => {
  const value = fixture(), read = value.store.read(), directory = join(value.root, 'temp', 'board-editor-backups');
  mkdirSync(directory, { recursive: true });
  const bytes = join(value.root, 'original-copy.json'); writeFileSync(bytes, value.bytes);
  linkSync(bytes, join(directory, `${read.hash}.json`));
  assert.throws(() => value.store.save(draft(), read.hash), /hard links/);
  assert.deepEqual(readFileSync(value.path), value.bytes);
});
test('directory symlink/junction ancestors and root aliases are rejected without writing through', () => {
  const original = fixture(), aliasRoot = root(), junction = join(aliasRoot, 'linked-project');
  symlinkSync(original.root, junction, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => new RuntimeLevelStore(junction), /Symlinks/);
  const project = root(), assets = join(project, 'assets');
  symlinkSync(join(original.root, 'assets'), assets, process.platform === 'win32' ? 'junction' : 'dir');
  const store = new RuntimeLevelStore(project);
  assert.throws(() => store.read(), /Symlinks/);
  assert.throws(() => store.save(draft(), hash(original.bytes)), /Symlinks/);
  assert.deepEqual(readFileSync(original.path), original.bytes);
});
test('backup directory aliases cannot redirect the original-byte backup', () => {
  const value = fixture(), outside = root();
  mkdirSync(join(value.root, 'temp'));
  symlinkSync(outside, join(value.root, 'temp', 'board-editor-backups'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => value.store.save(draft(), hash(value.bytes)), /Symlinks/);
  assert.deepEqual(readdirSync(outside), []);
  assert.deepEqual(readFileSync(value.path), value.bytes);
});
test('relative/dot-segment project roots are rejected', () => {
  const value = fixture();
  assert.throws(() => new RuntimeLevelStore('.'), /absolute/);
  assert.throws(() => new RuntimeLevelStore(join(value.root, 'x') + sep + '..'), /canonical/);
});
test('bounded JSON reads and draft serialization reject data over 8MB', () => {
  const value = fixture(), read = value.store.read();
  assert.throws(() => value.store.save({ ...draft(), extra: 'x'.repeat(RuntimeLevelStore.maxBytes) }, read.hash), /8MB/);
  assert.deepEqual(readFileSync(value.path), value.bytes);
  writeFileSync(value.path, Buffer.alloc(RuntimeLevelStore.maxBytes + 1, 32));
  assert.throws(() => value.store.read(), /8MB/);
});
test('busy sibling lock is preserved and causes no backup or runtime write', () => {
  const value = fixture(), lock = join(dirname(value.path), '.runtime-levels.lock');
  writeFileSync(lock, 'existing owner');
  assert.throws(() => value.store.save(draft(), hash(value.bytes)), /busy/);
  assert.equal(readFileSync(lock, 'utf8'), 'existing owner');
  assert.deepEqual(readFileSync(value.path), value.bytes);
  assert.equal(existsSync(join(value.root, 'temp')), false);
});

for (const oldColumns of [3, 4]) test(`saving ${oldColumns} to default five columns clears old columns and accepts a fifth-pile group`, () => {
  const value = fixture();
  writeFileSync(value.path, JSON.stringify({ ...value.document, levels: value.document.levels.map((level, index) => index === 6 ? { ...level, queueColumns: oldColumns } : level) }));
  const input = draft(); input.queueColumns = 5;
  input.groups = input.groups.map((group, index) => index === 2 ? { ...group, pile: 4, depth: 0 } : group);
  const before = value.store.read();
  value.store.save(input, before.hash);
  const target = value.store.read().catalog.levels[6]!;
  assert.equal(target.queueColumns ?? 5, 5);
  assert.equal(target.groups[2]?.pile, 4);
  assert.equal((saved(value.path).levels as Record<string, unknown>[])[6]?.queueColumns, 5);
  assert.deepEqual((saved(value.path).levels as unknown[]).filter((_, index) => index !== 6),
    value.document.levels.filter((_, index) => index !== 6));
});
test('saving five to three columns explicitly replaces the queue rule', () => {
  const value = fixture(), input = draft(); input.queueColumns = 3;
  value.store.save(input, value.store.read().hash);
  const target = value.store.read().catalog.levels[6]!;
  assert.equal(target.queueColumns, 3);
  assert.equal(target.initialSlots, 5);
  assert.equal((saved(value.path).levels as Record<string, unknown>[])[6]?.queueColumns, 3);
});
test('replacement cells and groups remove old optional keys, locks and mystery mechanics', () => {
  const value = fixture(), original = value.document.levels[6]!;
  const extended = { ...original, cells: [{ ...original.cells[0]!, keyId: 'old-key' }],
    groups: [{ ...original.groups[0]!, mystery: true, lockId: 'old-key' }] };
  writeFileSync(value.path, JSON.stringify({ ...value.document, levels: value.document.levels.map((level, index) => index === 6 ? extended : level) }));
  value.store.save(draft(), value.store.read().hash);
  const target = value.store.read().catalog.levels[6]!;
  assert.equal(target.cells.some(cell => cell.keyId !== undefined), false);
  assert.equal(target.groups.some(group => group.mystery !== undefined || group.lockId !== undefined || group.linkId !== undefined), false);
  assert.equal(target.sourceId, original.sourceId);
  assert.equal(target.themeId, original.themeId);
  assert.equal(target.targetItemId, original.targetItemId);
});
