import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createChallengeCatalog, createChallengePool } from '../../assets/Colony/scripts/application/operationalLevels.js';
import type { DevelopmentLevelGroup, GameColor } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.js';

const { certifyBlockingPrefixes, createSolver } = createRequire(import.meta.url)('../../scripts/levelDifficultySolver.mjs');
const { ASYNC_PROFILES, checkAsyncReference, checkAsyncFailureReference } = createRequire(import.meta.url)('../../scripts/asyncDifficultyReplay.mjs');
interface DailyEvidence {
  index: number; sourceId: string; cellsSha256: string; kind: 'E' | 'S' | 'H'; minimumSlots: number;
  groups: DevelopmentLevelGroup[]; upperTrace: number[]; badTrace: number[];
  asyncBadTrace: number[]; asyncBadProfile?: string;
  certificate: { blockingColors: GameColor[]; lowerBound: number };
}
const evidence: DailyEvidence[] = JSON.parse(readFileSync(new URL('../../scripts/dailyDifficultyEvidence.json', import.meta.url), 'utf8')).levels;
const pool = createChallengePool();

for (const entry of evidence) {
  const level = pool.levels[entry.index]!;
  test(`daily ${entry.index + 1} wrong order fails with recorded asynchronous timing`, () => {
    assert.ok(entry.asyncBadTrace?.length);
    const profile = entry.asyncBadProfile ? ASYNC_PROFILES.find((profile: { name: string }) => profile.name === entry.asyncBadProfile) : undefined;
    assert.ok(!entry.asyncBadProfile || profile);
    checkAsyncFailureReference(level, entry.asyncBadTrace, 'daily', profile);
  });
  test(`daily ${entry.index + 1} preserves its board and has a timing-independent ${entry.kind} bound`, () => {
    assert.equal(level.sourceId, entry.sourceId);
    assert.equal(level.shape, 'NIGHT_MARKET');
    assert.equal(entry.kind, ['E', 'S', 'H'][entry.index % 3]);
    const fingerprint = createHash('sha256').update(JSON.stringify({ sourceId: level.sourceId, rows: level.rows, columns: level.columns, cells: level.cells })).digest('hex');
    assert.equal(fingerprint, entry.cellsSha256, 'Daily dimensions, color, cell order and shape must stay unchanged');
    assert.equal(level.rows, [23, 25, 27][entry.index % 3]);
    assert.deepEqual(level.groups, entry.groups);
    assert.deepEqual(certifyBlockingPrefixes(level, entry.certificate.blockingColors), entry.certificate);
    assert.equal(entry.certificate.lowerBound, entry.minimumSlots);
    assert.equal(entry.minimumSlots, [2, 3, 4][entry.index % 3]);
    const range = entry.kind === 'E' ? [7, 18] : entry.kind === 'S' ? [12, 24] : [18, 30];
    assert.ok(level.groups.length >= range[0]! && level.groups.length <= range[1]!);
    assert.ok(level.groups.every(group => group.count >= 2 && group.count <= 50));
    for (let pile = 0; pile < 5; pile += 1) {
      const queue = level.groups.filter(group => group.pile === pile).sort((a, b) => a.depth - b.depth);
      assert.ok(queue.length > 0 && queue.length <= 8);
      assert.deepEqual(queue.map(group => group.depth), queue.map((_, depth) => depth));
    }
    for (const color of new Set(level.cells.map(cell => cell.color))) {
      assert.equal(level.groups.filter(group => group.color === color).reduce((sum, group) => sum + group.count, 0), level.cells.filter(cell => cell.color === color).length);
    }
  });

  for (const [name, trace, expected] of [
    ['success', entry.upperTrace, 'SUCCESS'], ['wrong order', entry.badTrace, 'FAIL'],
  ] as const) {
    test(`daily ${entry.index + 1} real core ${name} replay`, () => {
      const model = new ColonyFlowModel({ levels: [{ ...level, level: 1 }] });
      assert.equal(model.snapshot().slots.length, 5);
      const simulation = createSolver(level, 5);
      let state = simulation.initial;
      for (const index of trace) {
        const selected = simulation.choose(state, level.groups[index]!.pile);
        assert.equal(selected?.group, index);
        model.selectStack(level.groups[index]!.id);
        for (let step = 0; step <= level.cells.length; step += 1) {
          const moves = model.dispatchReady().flat().filter(event => event.phase === 'MOVE');
          if (!moves.length) break;
          for (const move of moves) {
            if (expected === 'SUCCESS') assert.ok(move.route!.length > 1, `No external route for ${move.cellId}`);
            model.completeTransport(move.cellId!);
          }
          assert.ok(step < level.cells.length, 'Dispatch exceeded its finite board budget');
        }
        state = selected.state;
        const snapshot = model.snapshot();
        assert.deepEqual(snapshot.board.map(cell => cell.cleared), level.cells.map((_, cellIndex) => !(state.active & (1n << BigInt(cellIndex)))));
        assert.deepEqual(snapshot.slots, state.slots.map((slot: { group: number; color: string; remaining: number } | null) => slot ? {
          stackId: level.groups[slot.group]!.id, color: slot.color, remaining: slot.remaining,
        } : null));
      }
      assert.equal(model.snapshot().result, expected);
      if (expected === 'SUCCESS') {
        // The slot target belongs to the asynchronous reference, not batch arrivals.
        assert.equal(model.snapshot().transported, level.cells.length);
        assert.equal(model.snapshot().remainingCells, 0);
        assert.deepEqual(trace, level.groups.map((group, index) => { assert.equal(group.id, `delivery-${index}`); return index; }));
        checkAsyncReference(level, trace, 'daily', entry.minimumSlots);
      }
    });
  }
}

test('daily source and date mapping preserve all 30 boards while catalog levels stay one', () => {
  assert.equal(evidence.length, 30);
  assert.deepEqual(evidence.map(entry => entry.index), Array.from({ length: 30 }, (_, index) => index));
  const boards = pool.levels.map(({ sourceId, rows, columns, cells }) => ({ sourceId, rows, columns, cells }));
  assert.equal(createHash('sha256').update(JSON.stringify(boards)).digest('hex'), '0432f7f5b26ba031aa7c69adead44be5d93721f94682b97c44c4e2fe2e370f21');
  for (let day = 0; day < 30; day += 1) {
    const timestamp = Date.UTC(2026, 9, 1 + day);
    const key = new Date(timestamp).toISOString().slice(0, 10);
    const index = ((Math.floor(timestamp / 86400000) % 30) + 30) % 30;
    const daily = createChallengeCatalog(key).levels[0]!;
    assert.equal(daily.level, 1);
    assert.equal(daily.sourceId, pool.levels[index]!.sourceId);
    assert.deepEqual(daily.cells, pool.levels[index]!.cells);
    assert.deepEqual(daily.groups, pool.levels[index]!.groups);
  }
});
