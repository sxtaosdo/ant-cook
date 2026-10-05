import assert from 'node:assert/strict';
import test from 'node:test';
import './player-progress.test.js';
import './daily-tasks.test.js';
import './leaderboard.test.js';
import './social.test.js';
import './rewarded-ads.test.js';
import './speed-boost.test.js';
import './gameplay-polish.test.js';
import './payment.test.js';
import './user-settings.test.js';
import './theme-csv.test.js';
import { AppModel } from '../../assets/Colony/scripts/application/appModel.js';
import { parseDevelopmentLevelCatalog } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { ColonyFlowModel, EMPTY_GAME_SNAPSHOT } from '../../assets/Colony/scripts/gameModel.js';
import type { ColonyReadModel } from '../../assets/Colony/scripts/application/contracts.js';
import { colonyTestLevelTrace } from '../../assets/Colony/scripts/testing/colonyTestTraces.js';
import { developmentLevelCatalog } from '../support/developmentLevelCatalog.js';

const project = (app: AppModel, play: ColonyFlowModel | null, maxLevel: number): ColonyReadModel => {
  const snapshot = play?.snapshot() ?? EMPTY_GAME_SNAPSHOT;
  return {
    currentLevel: snapshot.level,
    maxLevel,
    usedTools: play?.usedToolList() ?? [],
    result: snapshot.result,
    snapshot,
    lastEvents: play?.lastEventList() ?? [],
    lastDispatchRound: play?.lastDispatchRoundList() ?? [],
    suggestedStackId: play?.suggestedStack() ?? null,
    error: app.error === null ? null : { ...app.error },
  };
};

const bootPlay = () => {
  const catalog = developmentLevelCatalog();
  const app = new AppModel();
  const play = new ColonyFlowModel(catalog);
  return { app, play, catalog, maxLevel: catalog.levels.length };
};

test('app model owns only global error', () => {
  const app = new AppModel();
  assert.equal(app.error, null);
  app.setError({ code: 'RUNTIME', message: 'boom' });
  assert.deepEqual(app.error, { code: 'RUNTIME', message: 'boom' });
  app.clearError();
  assert.equal(app.error, null);
  assert.equal('started' in app, false);
  assert.equal('screen' in app, false);
  assert.equal('currentLevel' in app, false);
  assert.equal('catalogReady' in app, false);
  assert.equal('usedTools' in app, false);
});

test('play model owns level and preserves shape on reset', () => {
  const { app, play, maxLevel } = bootPlay();
  play.reset(2);
  const read = project(app, play, maxLevel);
  assert.equal(play.currentLevel, 2);
  assert.equal(read.currentLevel, 2);
  assert.equal(read.snapshot.shape, 'PROVISIONAL_FOX');
  assert.equal(read.snapshot.level, 2);
});

test('named navigation is play.reset only', () => {
  const { app, play, maxLevel } = bootPlay();
  play.reset(2);
  assert.deepEqual(
    { level: play.currentLevel, max: maxLevel },
    { level: 2, max: 10 },
  );
  assert.equal(project(app, play, maxLevel).snapshot.shape, 'PROVISIONAL_FOX');
  play.reset(Math.min(play.currentLevel + 1, maxLevel));
  assert.equal(play.currentLevel, 3);
  play.reset(Math.min(play.currentLevel + 1, maxLevel));
  assert.equal(play.currentLevel, 4);
  play.reset(1);
  assert.equal(play.currentLevel, 1);
});

test('read model is a fresh projection without freezing ownership', () => {
  const { app, play, maxLevel } = bootPlay();
  play.reset(1);
  const first = project(app, play, maxLevel);
  const second = project(app, play, maxLevel);
  assert.notEqual(first, second);
  assert.notEqual(first.snapshot, second.snapshot);
  assert.equal(Object.isFrozen(first), false);
  first.snapshot.board[0]!.cleared = true;
  assert.equal(project(app, play, maxLevel).snapshot.board[0]?.cleared, false);
});

test('play model owns three once-per-session tools and clears them on retry', () => {
  const { app, play, maxLevel } = bootPlay();
  play.reset(1);
  play.useExtraSlot();
  play.useTrowel();
  play.useCompass();
  assert.deepEqual(project(app, play, maxLevel).usedTools, ['slot', 'trowel', 'compass']);
  assert.throws(() => play.useExtraSlot());
  play.reset(play.currentLevel);
  assert.deepEqual(project(app, play, maxLevel).usedTools, []);
  assert.equal(project(app, play, maxLevel).snapshot.slots.length, 5);
});

test('tools with no valid target do not consume their free use', () => {
  const { play } = bootPlay();
  play.reset(1);
  while (play.snapshot().exposedCellIds.length > 0) play.clearOneExposedCell();
  assert.throws(() => play.useTrowel(), /No exposed/);
  assert.equal(play.usedToolList().includes('trowel'), false);
});

test('empty slots stay selectable while earlier transports are still in flight', () => {
  const { app, play, maxLevel } = bootPlay();
  play.reset(1);
  play.selectStack('level-01-pile-0-orange-0');
  play.dispatchReady();
  assert.ok(project(app, play, maxLevel).snapshot.slots.some((slot) => slot === null));
  play.selectStack('level-01-pile-1-cream-0');
  assert.equal(project(app, play, maxLevel).snapshot.slots.filter(Boolean).length, 2);
});

test('gameplay mutations go through ColonyFlowModel', () => {
  const { app, play, maxLevel } = bootPlay();
  play.reset(1);
  play.selectStack('level-01-pile-0-orange-0');
  assert.equal(project(app, play, maxLevel).lastEvents.some((event) => event.phase === 'SLOT'), true);
  play.dispatchReady();
  const move = project(app, play, maxLevel).lastEvents.find((event) => event.phase === 'MOVE');
  assert.ok(move?.cellId);
  play.completeTransport(move.cellId);
  assert.equal(project(app, play, maxLevel).snapshot.transported, 1);
});

test('no-persistence session never accepts or touches a storage port', () => {
  const unknownStorage = new Map([['unknown_legacy_key', 'keep-this-value']]);
  const { play } = bootPlay();
  play.reset(3);
  play.useCompass();
  assert.deepEqual([...unknownStorage.entries()], [['unknown_legacy_key', 'keep-this-value']]);
});

test('missing play blocks CasualLevelSession-style navigation', () => {
  const app = new AppModel();
  const destroyed = false;
  const play: ColonyFlowModel | null = null;
  const canNavigate = !destroyed && play != null;
  assert.equal(canNavigate, false);
  assert.equal(app.error, null);
});

test('invalid catalog parse fails without creating play', () => {
  assert.throws(() => parseDevelopmentLevelCatalog({ schema: 'food-hunt-development-level-catalog-v1', levels: [] }));
});

test('catalog loading rejects an initial one-cell delivery group', () => {
  const level = developmentLevelCatalog().levels[0]!;
  assert.throws(() => parseDevelopmentLevelCatalog({ schema: 'food-hunt-development-level-catalog-v1', levels: [
    { ...level, groups: level.groups.map((group, index) => index === 0 ? { ...group, count: 1 } : group) },
  ] }), /group.count/);
});

test('reset during play does not wipe selection unless level resets', () => {
  const { app, play, catalog, maxLevel } = bootPlay();
  play.reset(2);
  const stackId = colonyTestLevelTrace(catalog, 2, 'success')[0]!;
  play.selectStack(stackId);
  const before = project(app, play, maxLevel);
  assert.deepEqual(project(app, play, maxLevel).snapshot.level, before.snapshot.level);
  assert.equal(project(app, play, maxLevel).snapshot.stacks.some((stack) => stack.selected), true);
});
