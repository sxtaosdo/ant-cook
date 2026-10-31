import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createOperationalCatalog } from '../../../assets/Colony/scripts/application/operationalLevels.js';
import { ColonyFlowModel } from '../../../assets/Colony/scripts/gameModel.js';
import type { DevelopmentLevelGroup, GameColor } from '../../../assets/Colony/scripts/application/levelCatalog.js';

const require = createRequire(import.meta.url);
const { createSolver, certifyBlockingPrefixes, proveNormalizedMinimum } = require('../../../scripts/levelDifficultySolver.mjs');
const { difficultyTarget } = require('../../../scripts/generateLevelDifficulty.mjs');
const { ASYNC_PROFILES, checkAsyncReference, checkAsyncFailureReference } = require('../../../scripts/asyncDifficultyReplay.mjs');
interface MainEvidence {
  level: number; groups: DevelopmentLevelGroup[]; minimumSlots: number; upperTrace: number[]; badTrace?: number[]; asyncBadTrace?: number[]; asyncBadProfile?: string;
  spec: { kind: 'E' | 'S' | 'H'; maximumDepth?: number }; proof: unknown;
  certificate: { blockingColors: GameColor[]; lowerBound: number } | null;
}
const evidence: MainEvidence[] = JSON.parse(readFileSync(new URL('../../../scripts/levelDifficultyEvidence.json', import.meta.url), 'utf8'));
const catalog = createOperationalCatalog();

test('the untouched first main level wins using one simultaneous slot', () => {
  const level = catalog.levels[0]!;
  assert.equal(proveNormalizedMinimum(level, 1).normalizedMinimum, 1);
  const trace = createSolver(level, 1, { requireExternalPaths: true }).search({ limit: 20000 }).trace!;
  const model = new ColonyFlowModel({ levels: [level] });
  let peak = 0;
  for (const index of trace) {
    model.selectStack(level.groups[index]!.id);
    peak = Math.max(peak, model.snapshot().slots.filter(Boolean).length);
    while (true) {
      const moves = model.dispatchReady().flat().filter(event => event.phase === 'MOVE');
      if (!moves.length) break;
      for (const move of moves) {
        assert.ok(move.route!.length > 1);
        model.completeTransport(move.cellId!);
      }
    }
  }
  assert.equal(peak, 1);
  assert.equal(model.snapshot().result, 'SUCCESS');
  checkAsyncReference(level, trace, 'main', 1);
});

test('difficulty evidence covers every tuned main level with the approved targets', () => {
  assert.deepEqual(evidence.map(entry => entry.level), Array.from({ length: 59 }, (_, index) => index + 2));
  for (const entry of evidence) {
    const target = difficultyTarget(entry.level);
    assert.equal(entry.minimumSlots, target.capacity);
    assert.equal(entry.spec.kind, target.kind);
    if (target.kind !== 'E') assert.ok(entry.badTrace?.length && entry.asyncBadTrace?.length, `main ${entry.level} needs batch and asynchronous wrong-choice FAIL traces`);
  }
});

for (const entry of evidence) {
  const level = catalog.levels[entry.level - 1]!;
  if (entry.asyncBadTrace) test(`main ${entry.level} wrong order fails with recorded asynchronous timing`, () => {
    const profile = entry.asyncBadProfile ? ASYNC_PROFILES.find((profile: { name: string }) => profile.name === entry.asyncBadProfile) : undefined;
    assert.ok(!entry.asyncBadProfile || profile);
    checkAsyncFailureReference(level, entry.asyncBadTrace, 'main', profile);
  });
  test(`main ${entry.level} has a timing-independent slot bound and normalized proof`, () => {
    assert.deepEqual(level.groups, entry.groups);
    assert.deepEqual(proveNormalizedMinimum(level, entry.minimumSlots), entry.proof);
    if (entry.certificate) {
      const certificate = entry.certificate;
      assert.deepEqual(certifyBlockingPrefixes(level, certificate.blockingColors), certificate);
      assert.equal(certificate.lowerBound, entry.minimumSlots);
      assert.ok(level.cells.some(cell => !certificate.blockingColors.includes(cell.color)));
    } else assert.equal(entry.minimumSlots, 1);
    const groupRange = entry.spec.kind === 'H' ? [18, 30] : entry.spec.kind === 'S' ? [12, 24] : [7, 18];
    assert.ok(level.groups.length >= groupRange[0]! && level.groups.length <= groupRange[1]!);
    for (let pile = 0; pile < 5; pile += 1) {
      const queue = level.groups.filter(group => group.pile === pile).sort((a, b) => a.depth - b.depth);
      assert.ok(queue.length > 0 && queue.length <= (entry.spec.maximumDepth ?? 6));
      assert.deepEqual(queue.map(group => group.depth), queue.map((_, depth) => depth));
    }
  });

  for (const [label, trace, expected] of [
    ['winning', entry.upperTrace, 'SUCCESS'],
    ...(entry.badTrace ? [['wrong', entry.badTrace, 'FAIL']] : []),
  ] as Array<[string, number[], string]>) {
    test(`main ${entry.level} ${label} trace matches real dispatch and arrival rules`, () => {
      const model = new ColonyFlowModel({ levels: [{ ...level, level: 1 }] });
      const simulation = createSolver(level, level.initialSlots ?? 5);
      let state = simulation.initial;
      for (const index of trace) {
        const group = level.groups[index]!;
        const selected = simulation.choose(state, group.pile)!;
        assert.equal(selected.group, index);
        model.selectStack(group.id);
        while (true) {
          const moves = model.dispatchReady().flat().filter(event => event.phase === 'MOVE');
          if (!moves.length) break;
          for (const move of moves) {
            if (label === 'winning') assert.ok(move.route!.length > 1, `No external path for ${move.cellId}`);
            model.completeTransport(move.cellId!);
          }
        }
        state = selected.state;
        const snapshot = model.snapshot();
        assert.deepEqual(snapshot.board.map(cell => cell.cleared), level.cells.map((_, cellIndex) => !(state.active & (1n << BigInt(cellIndex)))));
        assert.deepEqual(snapshot.slots, state.slots.map((slot: { group: number; color: GameColor; remaining: number } | null) => slot ? {
          stackId: level.groups[slot.group]!.id, color: slot.color, remaining: slot.remaining,
        } : null));
      }
      assert.equal(model.snapshot().result, expected);
      if (label === 'winning') {
        // The slot target belongs to the asynchronous reference, not batch arrivals.
        checkAsyncReference(level, trace, 'main', entry.minimumSlots);
      }
    });
  }
}
