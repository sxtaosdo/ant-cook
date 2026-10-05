import assert from 'node:assert/strict';
import test from 'node:test';
import { RewardedAds, type RewardedVideo } from '../../assets/Colony/scripts/application/rewardedAds.js';

function fixture() {
  let close: (result?: { isEnded?: boolean }) => void = () => {};
  let error: (error: unknown) => void = () => {};
  let grants = 0;
  let round = 'round-1';
  let shown = 0;
  const video: RewardedVideo = {
    load: async () => {}, show: async () => { shown++; },
    onClose: (callback) => { close = callback; }, offClose: () => {},
    onError: (callback) => { error = callback; }, offError: () => {},
  };
  const ads = new RewardedAds({ createRewardedVideoAd: (options) => {
    assert.equal(options.multiton, true);
    return video;
  } }, { clear: 'real-unit', supply: 'supply-unit' }, () => round);
  return { ads, video, request: () => ads.request('clear', () => { grants++; }),
    close: (isEnded?: boolean) => close(isEnded === undefined ? undefined : { isEnded }),
    error: () => error(new Error('platform failure')), grants: () => grants, shown: () => shown,
    nextRound: () => { round = 'round-2'; } };
}

const shown = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };

test('rewarded video grants only completed viewing and ignores duplicate callbacks', async () => {
  const f = fixture(); const result = f.request(); await shown();
  assert.equal(f.shown(), 1); f.close(true); f.close(true); f.error();
  assert.equal(await result, 'completed'); assert.equal(f.grants(), 1);
});

test('cancelled and legacy undefined close results never grant', async () => {
  for (const ended of [false, undefined]) {
    const f = fixture(); const result = f.request(); await shown(); f.close(ended);
    assert.equal(await result, 'cancelled'); assert.equal(f.grants(), 0);
  }
});

test('load, show, and callback errors settle without reward', async () => {
  for (const phase of ['load', 'show', 'callback'] as const) {
    const f = fixture();
    if (phase !== 'callback') f.video[phase] = async () => { throw new Error(phase); };
    const result = f.request(); await shown(); if (phase === 'callback') f.error();
    assert.equal(await result, 'failed'); f.close(true); assert.equal(f.grants(), 0);
  }
});

test('missing real platform or unit reports unavailable', async () => {
  for (const ads of [new RewardedAds(null, { clear: 'unit' }, () => 'round'), new RewardedAds({ createRewardedVideoAd: () => { throw new Error('must not create'); } }, {}, () => 'round')]) {
    assert.equal(await ads.request('clear', () => assert.fail('fake award')), 'unavailable');
  }
});

test('parallel placements are blocked and completion is bound to the starting round', async () => {
  const f = fixture(); const first = f.request();
  assert.equal(await f.ads.request('supply', () => assert.fail('parallel award')), 'busy');
  await shown(); f.nextRound(); f.close(true);
  assert.equal(await first, 'stale'); assert.equal(f.grants(), 0);
});

test('background cancellation and disposal invalidate pending platform callbacks', async () => {
  for (const action of ['cancel', 'dispose'] as const) {
    const f = fixture(); const result = f.request(); await shown(); f.ads[action](); f.close(true);
    assert.equal(await result, action === 'cancel' ? 'cancelled' : 'disposed'); assert.equal(f.grants(), 0);
    if (action === 'dispose') assert.equal(await f.request(), 'disposed');
  }
});

test('cancellation before load completion prevents show', async () => {
  const f = fixture(); const result = f.request(); f.ads.cancel(); await shown();
  assert.equal(await result, 'cancelled'); assert.equal(f.shown(), 0);
});

test('a late close from a cancelled instance cannot complete the next request', async () => {
  const closes: Array<(result?: { isEnded?: boolean }) => void> = [];
  let destroyed = 0;
  let grants = 0;
  const ads = new RewardedAds({ createRewardedVideoAd: () => ({
    load: async () => {}, show: async () => {},
    onClose: (callback) => { closes.push(callback); }, offClose: () => {},
    onError: () => {}, offError: () => {}, destroy: () => { destroyed++; },
  }) }, { clear: 'unit' }, () => 'round');
  const first = ads.request('clear', () => { grants++; }); await shown(); ads.cancel();
  assert.equal(await first, 'cancelled'); assert.equal(destroyed, 1);
  const second = ads.request('clear', () => { grants++; }); await shown();
  closes[0]({ isEnded: true }); assert.equal(grants, 0);
  closes[1]({ isEnded: true });
  assert.equal(await second, 'completed'); assert.equal(grants, 1); assert.equal(destroyed, 2);
});

test('failed durable reward callback retains completion and ignores duplicate close', async () => {
  const f = fixture(); let attempts = 0;
  const result = f.ads.request('clear', () => { attempts++; throw new Error('disk full'); });
  await shown(); f.close(true); f.close(true);
  assert.equal(await result, 'pending'); assert.equal(attempts, 1); assert.equal(f.ads.hasPendingReward(), true);
});

test('pending persistence retries the original reward without showing a second video', async () => {
  const f = fixture(); let attempts = 0; let diskFull = true;
  const result = f.ads.request('clear', () => { attempts++; if (diskFull) throw new Error('disk full'); });
  await shown(); f.close(true); assert.equal(await result, 'pending');
  assert.equal(await f.ads.request('supply', () => assert.fail('unrelated reward')), 'pending');
  diskFull = false;
  assert.equal(await f.ads.request('clear', () => assert.fail('must preserve original reward ID')), 'completed');
  assert.equal(attempts, 2); assert.equal(f.shown(), 1); assert.equal(f.ads.hasPendingReward(), false);
});

test('pending completion cannot be moved to another round', async () => {
  const f = fixture();
  const result = f.ads.request('clear', () => { throw new Error('disk full'); });
  await shown(); f.close(true); assert.equal(await result, 'pending'); f.nextRound();
  assert.equal(await f.request(), 'stale'); assert.equal(f.shown(), 1); assert.equal(f.ads.hasPendingReward(), true);
});

test('pending supply cannot retry through a different selected tool', async () => {
  const f = fixture(); let attempts = 0; let diskFull = true;
  const result = f.ads.request('supply', () => { attempts++; if (diskFull) throw new Error('disk full'); }, 'trowel');
  await shown(); f.close(true); assert.equal(await result, 'pending'); diskFull = false;
  assert.equal(await f.ads.request('supply', () => assert.fail('wrong tool'), 'compass'), 'pending');
  assert.equal(attempts, 1);
  assert.equal(await f.ads.request('supply', () => assert.fail('must preserve original callback'), 'trowel'), 'completed');
  assert.equal(attempts, 2); assert.equal(f.shown(), 1);
});
