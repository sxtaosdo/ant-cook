import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileThemeCsv, columns, ruleColumns, csvRows, renderThemeData, themeIds } from '../compileThemeCsv.mjs';
import { documentFor, importBoard } from './core.ts';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.ts';
import { parseDevelopmentLevelCatalog, queueColumns, type QueueColumns, type DevelopmentLevelCatalog, type DevelopmentLevelConfig } from '../../assets/Colony/scripts/application/levelCatalog.ts';
import { MAIN_SUPPLY_LEVELS } from '../../assets/Colony/scripts/application/operationalLevels.ts';

const sourceRoot = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const generated = 'assets/Colony/scripts/application/operationalThemeData.ts';
const configRelative = 'assets/Colony/config/themes';
const sandboxMarker = '.ant-level-sandbox.json';
const baseFiles = [...themeIds.map(id => `${configRelative}/${id}/levels.csv`), generated];
const dependencies = ['scripts/compileThemeCsv.mjs', 'scripts/board-editor/core.ts', 'scripts/board-editor/groupsCore.ts', 'scripts/board-editor/levelPipeline.ts',
  'assets/Colony/scripts/gameModel.ts', 'assets/Colony/scripts/application/boardRoute.ts',
  'assets/Colony/scripts/application/levelCatalog.ts', 'assets/Colony/scripts/application/operationalLevels.ts',
  'assets/Colony/scripts/presentation/pageStates/playState.ts'];

interface Rules { schema: 'colony-level-rules-v1' | 'colony-level-rules-v2'; queueColumns?: QueueColumns; groupRules?: Record<string, unknown>; cellKeys?: Record<string, unknown>; cellOrder: string; groups: string; selectionOrder: number[]; initialSlots: 5 | 6 }
interface Transport { cellId: string; route: { row: number; column: number }[] }
interface Witness {
  status: 'WITNESS_PASS_STABLE_BATCH'; targetLevel: number; sourceId: string; initialSlots: 5 | 6;
  transported: number; selectionOrder: number[]; trace: { group: string; members: string[]; batches: Transport[][] }[];
  scope: string;
}
interface Candidate {
  level: number; themeId: string; csv: string; output: string; board: ReturnType<typeof documentFor>; rules: Rules;
  witness: Witness; catalog: DevelopmentLevelCatalog;
}

/** A bounded search over stable batches. Failure to find a witness is always UNKNOWN. */
export function findStableBatchWitness(config: DevelopmentLevelConfig, limits = { states: 200, milliseconds: 1000 }):
  { status: 'WITNESS_FOUND'; selectionOrder: number[]; states: number } | { status: 'UNKNOWN'; states: number } {
  const started = performance.now(); let states = 0;
  const pending: number[][] = [[]];
  while (pending.length && states < limits.states && performance.now() - started < limits.milliseconds) {
    const order = pending.pop()!; states++;
    const model = new ColonyFlowModel({levels: [{...config, level: 1}]});
    let valid = true;
    try {
      for (const index of order) {
        if (performance.now() - started >= limits.milliseconds) return {status: 'UNKNOWN', states};
        model.selectStack(config.groups[index]!.id);
        for (let tick = 0; tick <= config.cells.length; tick++) {
          if (performance.now() - started >= limits.milliseconds) return {status: 'UNKNOWN', states};
          const rounds = model.dispatchReady(); if (!rounds.length) break;
          for (const events of rounds) { const cell = events.find(event => event.phase === 'MOVE')?.cellId; if (cell) model.completeTransport(cell); }
        }
      }
    } catch { valid = false; }
    if (!valid) continue;
    const snapshot = model.snapshot();
    if (snapshot.result === 'SUCCESS') return {status: 'WITNESS_FOUND', states,
      selectionOrder: [...order, ...config.groups.flatMap((_, index) => order.includes(index) ? [] : [index])]};
    if (snapshot.result !== 'PLAYING') continue;
    // Reverse push preserves deterministic configuration-order traversal.
    for (let index = config.groups.length - 1; index >= 0; index--) {
      if (snapshot.stacks[index]?.accessible && !snapshot.stacks[index]?.selected) pending.push([...order, index]);
    }
  }
  return {status: 'UNKNOWN', states};
}

/** Only this class stages/imports candidates; the browser editor remains a board-pattern tool. */
export class LevelPipeline {
  public readonly root: string;
  constructor(root = sourceRoot, private readonly writeTarget: (path: string, data: string) => void = writeFileSync) {
    this.root = realpathSync(root);
  }

  private static hash(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex'); }
  public static fileHash(path: string): string { return this.hash(readFileSync(path)); }
  private static record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
  }
  public static readJson(path: string): unknown {
    if (!statSync(path).isFile() || statSync(path).size > 1024 * 1024) throw new Error('JSON must be a regular file no larger than1MB');
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown;
  }
  private static inside(path: string, root: string): boolean {
    const part = relative(root, path);
    return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
  }
  private static outsideSource(path: string): string {
    let ancestor = resolve(path);
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const canonical = resolve(realpathSync(ancestor), relative(ancestor, resolve(path)));
    if (this.inside(canonical, sourceRoot)) throw new Error('Actual product tree is read-only; use an external candidate/sandbox');
    return canonical;
  }
  private static csvField(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }
  private static replaceRow(source: string, rowIndex: number, values: string[]): string {
    let quoted = false, start = 0, row = 0;
    for (let index = 0; index <= source.length; index++) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') index++;
        else quoted = !quoted;
      }
      if (index === source.length || (char === '\n' && !quoted)) {
        if (row === rowIndex) {
          const end = source[index - 1] === '\r' ? index - 1 : index;
          return source.slice(0, start) + values.map(value => this.csvField(value)).join(',') + source.slice(end);
        }
        row++; start = index + 1;
      }
    }
    throw new Error('Target CSV row missing');
  }
  private rules(value: unknown, slots: 5 | 6): Rules {
    const raw = LevelPipeline.record(value, 'rules');
    if (Object.keys(raw).some(key => !['schema', 'cellOrder', 'groups', 'selectionOrder', 'initialSlots', 'queueColumns', 'groupRules', 'cellKeys'].includes(key))
      || !['colony-level-rules-v1', 'colony-level-rules-v2'].includes(String(raw.schema)) || typeof raw.cellOrder !== 'string' || typeof raw.groups !== 'string') {
      throw new Error('Expected colony-level-rules-v1 with cellOrder/groups');
    }
    if (raw.initialSlots !== undefined && raw.initialSlots !== slots) throw new Error(`Target Runtime requires ${slots} slots`);
    if (!Array.isArray(raw.selectionOrder) || !raw.selectionOrder.every(index => Number.isSafeInteger(index) && index >= 0)) {
      throw new Error('selectionOrder must explicitly list nonnegative group indices');
    }
    const selectionOrder: number[] = raw.selectionOrder.map(index => Number(index));
    const queues = queueColumns(raw.queueColumns);
    if (raw.schema === 'colony-level-rules-v1' && (raw.queueColumns !== undefined || raw.groupRules !== undefined || raw.cellKeys !== undefined)) throw new Error('Extended rules require v2');
    return { schema: raw.schema as Rules['schema'], cellOrder: raw.cellOrder, groups: raw.groups, selectionOrder, initialSlots: slots,
      ...(raw.schema === 'colony-level-rules-v2' ? {queueColumns: queues, groupRules: LevelPipeline.record(raw.groupRules ?? {}, 'groupRules'), cellKeys: LevelPipeline.record(raw.cellKeys ?? {}, 'cellKeys')} : {}) };
  }

  public compile(boardValue: unknown, rulesValue: unknown, level: number): Candidate {
    if (!Number.isSafeInteger(level) || level < 1 || level > 60) throw new Error('Target level must be1–60');
    const inputRoot = join(this.root, configRelative);
    const base = compileThemeCsv({ inputRoot });
    if (readFileSync(join(this.root, generated), 'utf8') !== renderThemeData(base)) throw new Error('Base CSV/generated TS are stale; do not import');
    const board = documentFor(importBoard(boardValue));
    const slots = MAIN_SUPPLY_LEVELS.some(id => id === level) ? 6 : 5;
    const rules = this.rules(rulesValue, slots);
    const themeId = themeIds[Math.floor((level - 1) / 12)];
    if (!themeId) throw new Error('Target theme missing');
    const csvPath = join(inputRoot, themeId, 'levels.csv');
    const original = readFileSync(csvPath, 'utf8');
    const localRow = (level - 1) % 12 + 1;
    const table = csvRows(original.replace(/^\uFEFF/, ''));
    const extended = rules.schema === 'colony-level-rules-v2' || table[0]?.length === ruleColumns.length;
    let upgraded = original;
    if (extended && table[0]?.length === columns.length) {
      // Upgrade one complete theme table. Identity/art columns are retained verbatim in value.
      const eol = original.includes('\r\n') ? '\r\n' : '\n';
      table[0] = [...ruleColumns];
      for (const row of table.slice(1)) row.push('5', '{}', '{}');
      upgraded = table.map(row => row.map(LevelPipeline.csvField).join(',')).join(eol) + (original.endsWith('\n') ? eol : '');
    }
    const header = extended ? ruleColumns : columns;
    const values = table[localRow]?.slice();
    if (!values) throw new Error('Target CSV row missing');
    for (const [name, value] of Object.entries({ rows: String(board.rows), columns: String(board.columns),
      boardCells: board.boardCells, cellOrder: rules.cellOrder, groups: rules.groups, ...(extended ? {queueColumns: String(rules.queueColumns ?? 5), groupRules: JSON.stringify(rules.groupRules ?? {}), cellKeys: JSON.stringify(rules.cellKeys ?? {})} : {}) })) {
      const column = header.indexOf(name);
      if (column < 0) throw new Error('CSV schema missing board field');
      values[column] = value;
    }
    const csv = LevelPipeline.replaceRow(upgraded, localRow, values);
    const data = compileThemeCsv({ inputRoot, sources: new Map([[themeId, csv]]) });
    // The migrated JS compiler retains original domain validation; the shared TS parser is
    // the unknown/schema boundary before any data reaches the actual gameplay model.
    const parsed = parseDevelopmentLevelCatalog({ schema: 'food-hunt-development-level-catalog-v1', levels: data.levels.map(item => MAIN_SUPPLY_LEVELS.some(id => id === item.level) ? {...item, initialSlots: 6} : item) });
    const catalog: DevelopmentLevelCatalog = { levels: parsed.levels.map(item => MAIN_SUPPLY_LEVELS.some(id => id === item.level)
      ? { ...item, initialSlots: 6 } : item) };
    if (rules.selectionOrder.length === 0) {
      const search = findStableBatchWitness(catalog.levels[level - 1]!);
      if (search.status !== 'WITNESS_FOUND') throw new Error(`UNKNOWN: configuration is structurally valid; bounded stable-batch search found no witness (${search.states} states). This does not prove unsolvable.`);
      rules.selectionOrder = search.selectionOrder;
    }
    const witness = this.replay(catalog, level, rules);
    return { level, themeId, csv, output: renderThemeData(data), board, rules, witness, catalog };
  }

  private replay(catalog: DevelopmentLevelCatalog, target: number, rules: Rules): Witness {
    const config = catalog.levels[target - 1];
    if (!config) throw new Error('Target missing from compiled catalog');
    if (rules.selectionOrder.length !== config.groups.length || new Set(rules.selectionOrder).size !== config.groups.length
      || rules.selectionOrder.some(index => index >= config.groups.length)) throw new Error('selectionOrder must cover each group exactly once');
    const model = new ColonyFlowModel(catalog);
    model.reset(target);
    const trace: Witness['trace'] = [];
    const completed = new Set<string>();
    const covered = new Set<string>();
    for (const index of rules.selectionOrder) {
      const group = config.groups[index];
      if (!group) throw new Error('Solution group missing');
      if (model.snapshot().stacks.find(stack => stack.id === group.id)?.selected) {
        if (!covered.has(group.id)) throw new Error('Skipped group was not covered by an atomic selection');
        continue;
      }
      const selection = model.selectStack(group.id);
      const members = selection.flatMap(event => event.phase === 'SLOT' && event.stackId ? [event.stackId] : []);
      for (const id of members) covered.add(id);
      const step: Witness['trace'][number] = { group: group.id, members, batches: [] };
      trace.push(step);
      // Choose the next group only after every transport in the previous batch arrived.
      while (model.snapshot().result === 'PLAYING') {
        const batch = model.dispatchReady();
        if (batch.length === 0) break;
        const transports: Transport[] = [];
        const reserved = new Set<string>();
        for (const events of batch) {
          const move = events.find(event => event.phase === 'MOVE');
          if (!move?.cellId || !move.route || move.route.length < 2 || completed.has(move.cellId) || reserved.has(move.cellId)) throw new Error('Invalid transport witness');
          reserved.add(move.cellId);
          for (let at = 1; at < move.route.length; at++) {
            const a = move.route[at - 1], b = move.route[at];
            if (!a || !b || Math.abs(a.row - b.row) + Math.abs(a.column - b.column) !== 1) throw new Error('Invalid transport route');
          }
          transports.push({ cellId: move.cellId, route: move.route });
        }
        step.batches.push(transports);
        for (const transport of transports) {
          const events = model.completeTransport(transport.cellId);
          if (!events.some(event => event.phase === 'INTERACT')) throw new Error('Transport did not complete');
          completed.add(transport.cellId);
          if (completed.size > config.cells.length) throw new Error('Solution exceeded board budget');
        }
      }
      if (model.snapshot().result === 'FAIL') throw new Error('Declared solution deadlocked under stable-batch replay');
    }
    const result = model.snapshot();
    if (covered.size !== config.groups.length || result.result !== 'SUCCESS' || result.transported !== config.cells.length || result.remainingCells !== 0) {
      throw new Error('Declared solution did not clear the board; no solvability PASS');
    }
    return { status: 'WITNESS_PASS_STABLE_BATCH', targetLevel: target, sourceId: config.sourceId, initialSlots: rules.initialSlots,
      transported: result.transported, selectionOrder: rules.selectionOrder, trace,
      scope: 'One explicit pure-model stable-batch solution; not a solver or proof for all60ms/overlapping Runtime arrival orders.' };
  }

  private hashes(): Record<string, string> { return Object.fromEntries(baseFiles.map(path => [path, LevelPipeline.fileHash(join(this.root, path))])); }
  public static dependencyHashes(): Record<string, string> { return Object.fromEntries(dependencies.map(path => [path, this.fileHash(join(sourceRoot, path))])); }
  private validateDestinations(root: string): void {
    if (LevelPipeline.outsideSource(realpathSync(this.root)) !== root) throw new Error('Sandbox target changed during import');
    for (const path of baseFiles) {
      const target = join(root, path), info = lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !LevelPipeline.inside(realpathSync(target), root)) throw new Error('Sandbox destination must be an unaliased regular file');
    }
  }
  public static createSandbox(directory: string): string {
    const root = this.outsideSource(directory);
    if (existsSync(root)) throw new Error('Sandbox directory must be new');
    mkdirSync(root, { recursive: true });
    for (const path of baseFiles) { mkdirSync(dirname(join(root, path)), { recursive: true }); copyFileSync(join(sourceRoot, path), join(root, path)); }
    writeFileSync(join(root, sandboxMarker), JSON.stringify({ schema: 'ant-level-sandbox-v1', sourceProject: sourceRoot }) + '\n');
    return root;
  }
  public preview(board: unknown, rules: unknown, level: number, directory: string): { plan: string; confirm: string; witness: Witness } {
    const out = LevelPipeline.outsideSource(directory);
    if (existsSync(out)) throw new Error('Candidate directory must be new');
    const before = this.hashes(), code = LevelPipeline.dependencyHashes();
    const candidate = this.compile(board, rules, level);
    if (JSON.stringify(before) !== JSON.stringify(this.hashes()) || JSON.stringify(code) !== JSON.stringify(LevelPipeline.dependencyHashes())) throw new Error('Sources changed during compilation; retry preview');
    mkdirSync(out, { recursive: true });
    const files: Record<string, string> = {
      'board.json': JSON.stringify(candidate.board, null, 2) + '\n', 'rules.json': JSON.stringify(candidate.rules, null, 2) + '\n',
      'levels.csv': candidate.csv, 'operationalThemeData.ts': candidate.output,
      'level-catalog.json': JSON.stringify(candidate.catalog, null, 2) + '\n', 'validation.json': JSON.stringify(candidate.witness, null, 2) + '\n',
    };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(out, name), content);
    let diff = '';
    for (const [base, staged] of [[`${configRelative}/${candidate.themeId}/levels.csv`, 'levels.csv'], [generated, 'operationalThemeData.ts']]) {
      if (!base || !staged) throw new Error('Diff path missing');
      const result = spawnSync('git', ['diff', '--no-index', '--', join(this.root, base), join(out, staged)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.status === null || result.status > 1) throw new Error(`Preview diff failed: ${result.error?.message ?? result.stderr}`);
      diff += result.stdout;
    }
    writeFileSync(join(out, 'preview.diff'), diff);
    files['preview.diff'] = diff;
    const plan = { schema: 'ant-level-import-v1', root: this.root, level, themeId: candidate.themeId,
      baseHashes: before, dependencyHashes: code, stagedHashes: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, LevelPipeline.hash(content)])) };
    const planText = JSON.stringify(plan, null, 2) + '\n', planPath = join(out, 'plan.json');
    writeFileSync(planPath, planText);
    return { plan: planPath, confirm: LevelPipeline.hash(planText), witness: candidate.witness };
  }

  /** Explicit import is restricted to a fresh, marked external sandbox. Production is never written. */
  public apply(planPath: string, confirm: string): void {
    const root = LevelPipeline.outsideSource(this.root);
    const marker = LevelPipeline.record(LevelPipeline.readJson(join(root, sandboxMarker)), 'sandbox marker');
    if (marker.schema !== 'ant-level-sandbox-v1' || marker.sourceProject !== sourceRoot) throw new Error('Sandbox marker missing or invalid');
    if (LevelPipeline.fileHash(planPath) !== confirm) throw new Error('Confirm must equal the reviewed plan SHA256');
    const plan = LevelPipeline.record(LevelPipeline.readJson(planPath), 'plan');
    if (plan.schema !== 'ant-level-import-v1' || plan.root !== root || typeof plan.level !== 'number') throw new Error('Plan target mismatch');
    if (JSON.stringify(plan.baseHashes) !== JSON.stringify(this.hashes()) || JSON.stringify(plan.dependencyHashes) !== JSON.stringify(LevelPipeline.dependencyHashes())) throw new Error('Stale source/code fingerprint; regenerate preview');
    this.validateDestinations(root);
    const directory = dirname(realpathSync(planPath));
    const candidate = this.compile(LevelPipeline.readJson(join(directory, 'board.json')), LevelPipeline.readJson(join(directory, 'rules.json')), plan.level);
    const staged = LevelPipeline.record(plan.stagedHashes, 'staged hashes');
    for (const name of ['board.json', 'rules.json', 'levels.csv', 'operationalThemeData.ts', 'level-catalog.json', 'validation.json', 'preview.diff']) {
      if (typeof staged[name] !== 'string' || LevelPipeline.fileHash(join(directory, name)) !== staged[name]) throw new Error('Staged candidate changed after review');
    }
    if (plan.themeId !== candidate.themeId || readFileSync(join(directory, 'levels.csv'), 'utf8') !== candidate.csv
      || readFileSync(join(directory, 'operationalThemeData.ts'), 'utf8') !== candidate.output) throw new Error('Candidate does not match deterministic recompilation');
    const csvPath = join(root, configRelative, candidate.themeId, 'levels.csv'), output = join(root, generated);
    const oldCsv = readFileSync(csvPath, 'utf8'), oldOutput = readFileSync(output, 'utf8');
    this.validateDestinations(root);
    if (JSON.stringify(plan.baseHashes) !== JSON.stringify(this.hashes()) || JSON.stringify(plan.dependencyHashes) !== JSON.stringify(LevelPipeline.dependencyHashes())) throw new Error('Stale source/code fingerprint; regenerate preview');
    try { this.writeTarget(csvPath, candidate.csv); this.writeTarget(output, candidate.output); }
    catch (error) {
      try { this.writeTarget(csvPath, oldCsv); this.writeTarget(output, oldOutput); }
      catch (rollback) { throw new AggregateError([error, rollback], 'Sandbox import and rollback failed; preserve candidate and sandbox for recovery'); }
      throw error;
    }
  }
}
