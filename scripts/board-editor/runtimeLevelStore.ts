import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { RuntimeLevelCatalog } from '../../assets/Colony/scripts/application/runtimeLevelCatalog.ts';
import type { DevelopmentLevelCatalog } from '../../assets/Colony/scripts/application/levelCatalog.ts';
import { importDraft } from './groupsCore.ts';
import { configForDraft, prepareDraft } from './groupsView.ts';

interface Snapshot {
  catalog: DevelopmentLevelCatalog; hash: string; bytes: Buffer; identity: Stats;
  document: Record<string, unknown>; levels: unknown[];
}
export interface RuntimeLevelRead { catalog: DevelopmentLevelCatalog; hash: string }
export interface RuntimeLevelSave { hash: string; level: number; relativePath: string }

/** Fixed editor output. No request may choose a filesystem path or bypass the runtime parser. */
export class RuntimeLevelStore {
  public static readonly relativePath = 'assets/Colony/config/runtime-levels.json';
  public static readonly maxBytes = 8 * 1024 * 1024;
  private readonly root: string;
  private readonly rootIdentity: Stats;

  public constructor(root: string) {
    if (!isAbsolute(root) || root.split(/[\\/]/).some(part => part === '.' || part === '..')) throw new Error('Project root must be an absolute canonical directory');
    this.root = resolve(root);
    this.assertOrdinary(this.root, true);
    this.rootIdentity = lstatSync(this.root);
  }
  private static hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
  private static same(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
  private static record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
    return value as Record<string, unknown>;
  }
  /** Check from the volume root, including ancestors outside the project root. */
  private assertOrdinary(path: string, directory: boolean): Stats {
    const absolute = resolve(path), volume = parse(absolute).root;
    let at = volume;
    for (const part of relative(volume, absolute).split(sep).filter(Boolean)) {
      at = join(at, part);
      const item = lstatSync(at);
      const isDirectory = at !== absolute || directory;
      if (item.isSymbolicLink() || (isDirectory ? !item.isDirectory() : !item.isFile())
        || !isDirectory && item.nlink !== 1 || realpathSync(at) !== at) {
        throw new Error('Symlinks, hard links and aliased output paths are not allowed');
      }
    }
    return lstatSync(absolute);
  }
  private assertRoot(): void {
    const now = this.assertOrdinary(this.root, true);
    if (!RuntimeLevelStore.same(now, this.rootIdentity)) throw new Error('Project root changed');
  }
  private readBytes(path: string): { bytes: Buffer; identity: Stats } {
    this.assertRoot();
    const before = this.assertOrdinary(path, false);
    if (before.size > RuntimeLevelStore.maxBytes) throw new Error('JSON exceeds 8MB');
    const fd = openSync(path, 'r');
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || !RuntimeLevelStore.same(before, opened)
        || !RuntimeLevelStore.same(this.assertOrdinary(path, false), opened)) throw new Error('JSON file changed while opening');
      const buffer = Buffer.allocUnsafe(RuntimeLevelStore.maxBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const size = readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (!size) break;
        offset += size;
      }
      if (offset > RuntimeLevelStore.maxBytes) throw new Error('JSON exceeds 8MB');
      const after = fstatSync(fd), pathAfter = this.assertOrdinary(path, false);
      if (after.nlink !== 1 || !RuntimeLevelStore.same(after, pathAfter) || !RuntimeLevelStore.same(before, after)
        || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw new Error('JSON file changed while reading');
      }
      return { bytes: buffer.subarray(0, offset), identity: after };
    } finally { closeSync(fd); }
  }
  private load(): Snapshot {
    const { bytes, identity } = this.readBytes(join(this.root, RuntimeLevelStore.relativePath));
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const catalog = RuntimeLevelCatalog.parse(raw), document = RuntimeLevelStore.record(raw);
    if (!Array.isArray(document.levels)) throw new Error('Runtime levels are missing');
    return { catalog, hash: RuntimeLevelStore.hash(bytes), bytes, identity, document, levels: document.levels };
  }
  public read(): RuntimeLevelRead {
    const snapshot = this.load();
    return { catalog: snapshot.catalog, hash: snapshot.hash };
  }
  private ensureDirectory(path: string): void {
    this.assertRoot();
    const part = relative(this.root, path);
    if (!part || isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`)) throw new Error('Backup directory is outside the project');
    let at = this.root;
    for (const segment of part.split(sep)) {
      at = join(at, segment);
      try { mkdirSync(at); } catch (cause) {
        if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') throw cause;
      }
      this.assertOrdinary(at, true);
    }
  }
  private backup(snapshot: Snapshot): void {
    const directory = join(this.root, 'temp', 'board-editor-backups');
    this.ensureDirectory(directory);
    const path = join(directory, `${snapshot.hash}.json`);
    if (existsSync(path)) {
      const existing = this.readBytes(path).bytes;
      if (!existing.equals(snapshot.bytes)) throw new Error('Backup conflicts with the original bytes');
      return;
    }
    const fd = openSync(path, 'wx', 0o600);
    try {
      if (!RuntimeLevelStore.same(this.assertOrdinary(path, false), fstatSync(fd))) throw new Error('Backup path changed');
      writeFileSync(fd, snapshot.bytes); fsyncSync(fd);
    } finally { closeSync(fd); }
    if (!this.readBytes(path).bytes.equals(snapshot.bytes)) throw new Error('Backup verification failed');
  }
  public save(rawDraft: unknown, expectedHash: string): RuntimeLevelSave {
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Expected the original SHA-256');
    const serialized = JSON.stringify(rawDraft);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > RuntimeLevelStore.maxBytes) throw new Error('Draft JSON exceeds 8MB');
    const imported = importDraft(rawDraft), draft = prepareDraft(imported, imported.cellOrder.length > 0);
    const gameplay = configForDraft(draft);
    this.assertRoot();
    const target = join(this.root, RuntimeLevelStore.relativePath);
    this.assertOrdinary(target, false);
    const lockPath = join(dirname(target), '.runtime-levels.lock');
    let lock: number;
    try { lock = openSync(lockPath, 'wx', 0o600); } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'EEXIST') throw new Error('Runtime levels are busy; read again before saving');
      throw cause;
    }
    const lockIdentity = fstatSync(lock);
    let temporary: string | undefined, temporaryIdentity: Stats | undefined;
    try {
      const current = this.load();
      if (current.hash !== expectedHash) throw new Error('Runtime levels changed; read again before saving');
      const original = current.catalog.levels[draft.targetLevel - 1];
      if (!original) throw new Error('Target level is missing');
      const originalData = RuntimeLevelStore.record(current.levels[draft.targetLevel - 1]);
      // Replace the entire gameplay projection. The shared parser omits default queueColumns=5,
      // so spreading its result over an old 3/4-column level would retain stale rules.
      const changed = { ...originalData, rows: gameplay.rows, columns: gameplay.columns, cells: gameplay.cells, groups: gameplay.groups,
        initialSlots: gameplay.initialSlots ?? 5, queueColumns: gameplay.queueColumns ?? 5,
        level: original.level, sourceId: original.sourceId, shape: original.shape,
        ...(original.themeId === undefined ? {} : { themeId: original.themeId, targetItemId: original.targetItemId }) };
      const document = { ...current.document, levels: current.levels.map((item, index) => index === draft.targetLevel - 1 ? changed : item) };
      RuntimeLevelCatalog.parse(document);
      const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
      if (bytes.length > RuntimeLevelStore.maxBytes) throw new Error('Runtime JSON exceeds 8MB');
      this.backup(current);
      temporary = join(dirname(target), `.runtime-levels-${randomUUID()}.tmp`);
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        temporaryIdentity = fstatSync(fd);
        if (!RuntimeLevelStore.same(this.assertOrdinary(temporary, false), temporaryIdentity)) throw new Error('Temporary output changed');
        writeFileSync(fd, bytes); fsyncSync(fd);
      } finally { closeSync(fd); }
      const latest = this.load();
      if (latest.hash !== expectedHash || !RuntimeLevelStore.same(latest.identity, current.identity)) throw new Error('Runtime levels changed before replacement');
      if (!this.readBytes(temporary).bytes.equals(bytes)) throw new Error('Temporary output verification failed');
      // The sibling lock serializes this writer. Final recheck also rejects external edits observed before rename.
      renameSync(temporary, target); temporary = undefined;
      const saved = this.load(), hash = RuntimeLevelStore.hash(bytes);
      if (saved.hash !== hash) throw new Error('Saved runtime levels could not be verified');
      return { hash, level: draft.targetLevel, relativePath: RuntimeLevelStore.relativePath };
    } finally {
      if (temporary && temporaryIdentity) {
        const current = this.assertOrdinary(temporary, false);
        if (RuntimeLevelStore.same(current, temporaryIdentity)) unlinkSync(temporary);
      }
      closeSync(lock);
      const currentLock = this.assertOrdinary(lockPath, false);
      if (RuntimeLevelStore.same(currentLock, lockIdentity)) unlinkSync(lockPath);
    }
  }
}
