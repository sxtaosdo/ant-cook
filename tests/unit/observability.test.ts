import assert from 'node:assert/strict';
import test from 'node:test';
import * as sharedTelemetry from 'db://shidai3/observability/index';
import { TelemetryClient, type TrackResult, type FlushResult } from '../../assets/shell/observability/telemetryClient';
import { LocalRecordingAdapter, WechatTelemetryAdapter, NativeFirebaseTelemetryAdapter, type TelemetryAdapter } from '../../assets/shell/observability/telemetryAdapters';
import type { TelemetryContext, TelemetryFields } from '../../assets/shell/observability/telemetrySchema';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_CALENDAR_START } from '../../assets/Colony/scripts/application/playerProgress';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';

// Runtime boundary tests intentionally pass malformed data without weakening the production DTO types.
function invokeTrack(client: TelemetryClient, name: unknown, fields: unknown, identity: unknown): TrackResult {
    return Reflect.apply(client.track, client, [name, fields, identity]);
}
function invokeError(client: TelemetryClient, cause: unknown, details: unknown): TrackResult {
    return Reflect.apply(client.captureError, client, [cause, details]);
}
const context: TelemetryContext = { product: 'ant-cook', gameplay: 'shell', environment: 'test', platform: 'web',
    sessionId: 'offline-session-1', release: '0.3.0.17', commit: 'abcdef1', buildId: 'offline-test-1' };
function fixture(adapter: TelemetryAdapter = new LocalRecordingAdapter()) {
    let time = 100000;
    const client = new TelemetryClient({ context, enabled: true, adapter, now: () => time });
    return { client, adapter, snapshot() { assert.ok(adapter instanceof LocalRecordingAdapter); return adapter.snapshot(); }, advance(value: number) { time += value; }, setTime(value: number) { time = value; } };
}
const reward: TelemetryFields['ad_reward_committed'] = { placementId: 'speed-boost', rewardType: 'duration', rewardCode: 'boost-ms', amount: 60000, commitState: 'persisted' };
const rewardIdentity = { factId: 'ad-speed:request-1', causationId: 'request-1' };

test('legacy product entries re-export the pinned public implementation', () => {
    assert.equal(TelemetryClient, sharedTelemetry.TelemetryClient);
    assert.equal(LocalRecordingAdapter, sharedTelemetry.LocalRecordingAdapter);
    assert.equal(WechatTelemetryAdapter, sharedTelemetry.WechatTelemetryAdapter);
    assert.equal(NativeFirebaseTelemetryAdapter, sharedTelemetry.NativeFirebaseTelemetryAdapter);
});

test('default off performs no recording, clock access, or provider acceptance', () => {
    let called = 0;
    const client = new TelemetryClient({ context, adapter: { capabilities: new LocalRecordingAdapter().capabilities, accept() { called++; throw Error('offline'); } }, now() { throw Error('unused'); } });
    assert.equal(invokeTrack(client, 'session_started', { entry: 'launch' }, { factId: 'launch' }), 'disabled');
    assert.equal(invokeError(client, Error('secret'), {}), 'disabled');
    assert.equal(client.breadcrumb('boot'), 'disabled');
    assert.equal(client.flush().status, 'disabled');
    assert.equal(called, 0);
});

test('local recording snapshots are immutable and copy only the context and event whitelist', () => {
    const local = new LocalRecordingAdapter();
    const mutable = { ...context, token: 'SECRET_CONTEXT' };
    const client = new TelemetryClient({ context: mutable, enabled: true, adapter: local });
    const fields = { entry: 'launch', save: { body: 'SECRET_SAVE' }, url: 'https://private?token=SECRET_URL' };
    Object.defineProperty(fields, 'token', { get() { throw Error('must not inspect unknown fields'); } });
    assert.equal(invokeTrack(client, 'session_started', fields, { factId: 'launch' }), 'queued');
    mutable.sessionId = 'changed'; fields.entry = 'resume';
    assert.equal(client.flush().status, 'recorded_locally');
    const snapshot = local.snapshot();
    assert.equal(snapshot[0].context.sessionId, context.sessionId);
    assert.deepEqual(snapshot[0].fields, { entry: 'launch' });
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot[0]) && Object.isFrozen(snapshot[0].fields));
    assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|token|save|https:/);
});

test('all business facts use separate named semantics and stable causal identities', () => {
    const f = fixture();
    const cases = [
        ['session_started', { entry: 'launch' }], ['session_ready', { durationMs: 120 }],
        ['level_started', { levelId: '1', mode: 'main' }], ['level_finished', { levelId: '1', outcome: 'exit', durationMs: 500 }],
        ['region_entered', { regionId: 'region-1' }], ['encounter_started', { encounterId: 'fight-1' }],
        ['encounter_finished', { encounterId: 'fight-1', outcome: 'win' }],
        ['item_used', { itemId: 'bomb', quantity: 1, commitState: 'applied' }],
        ['currency_changed', { currency: 'coins', before: 5, after: 3, delta: -2, reason: 'spend', commitState: 'persisted' }],
        ['ad_shown', { placementId: 'speed-boost' }], ['ad_video_completed', { placementId: 'speed-boost', completed: true }],
        ['ad_reward_committed', reward], ['save_failed', { operation: 'write', code: 'quota' }],
        ['save_recovered', { operation: 'restore' }], ['invite_presented', { target: 'cook' }],
        ['invite_accepted', { target: 'cook' }], ['gameplay_switch_completed', { from: 'ant', to: 'cook' }],
    ];
    for (const [name, fields] of cases) assert.equal(invokeTrack(f.client, name, fields, { factId: 'transaction-1', causationId: 'command-1' }), 'queued');
    assert.equal(f.client.flush().accepted, cases.length);
    assert.equal(new Set(f.snapshot().map(record => record.eventId)).size, cases.length);
});

test('clicks, incomplete video, unpersisted rewards, missing causation and inconsistent currency are refused', () => {
    const f = fixture();
    assert.equal(invokeTrack(f.client, 'ad_clicked', {}, rewardIdentity), 'invalid');
    assert.equal(invokeTrack(f.client, 'ad_video_completed', { placementId: 'speed-boost', completed: false }, rewardIdentity), 'invalid');
    assert.equal(invokeTrack(f.client, 'ad_reward_committed', { ...reward, commitState: 'applied' }, rewardIdentity), 'invalid');
    assert.equal(invokeTrack(f.client, 'ad_reward_committed', reward, { factId: 'reward' }), 'invalid');
    assert.equal(invokeTrack(f.client, 'currency_changed', { currency: 'coins', before: 5, after: 8, delta: 9, reason: 'reward', commitState: 'persisted' }, rewardIdentity), 'invalid');
    assert.equal(invokeTrack(f.client, 'ad_reward_committed', { ...reward, amount: 0 }, rewardIdentity), 'invalid');
    assert.equal(f.client.flush().status, 'empty');
});

test('privacy boundaries reject URLs, getters and prototype event names without serializing unknown data', () => {
    const f = fixture(); let read = 0;
    assert.equal(invokeTrack(f.client, 'region_entered', { regionId: 'https://private?token=x' }, { factId: 'region' }), 'invalid');
    assert.equal(invokeTrack(f.client, '__proto__', {}, { factId: 'prototype' }), 'invalid');
    const fields = Object.defineProperty({}, 'entry', { get() { read++; return 'launch'; } });
    assert.equal(invokeTrack(f.client, 'session_started', fields, { factId: 'getter' }), 'invalid');
    assert.equal(read, 0);
    const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('hostile'); } });
    assert.equal(invokeTrack(f.client, 'session_started', hostile, { factId: 'proxy' }), 'failed');
});

test('context, fact and diagnostic getters are refused before access so values cannot change after validation', () => {
    const f = fixture(); let reads = 0;
    const changing = { get() { return ++reads === 1 ? 'valid-id' : 'https://private?token=SYNTHETIC_SECRET'; } };
    const identity = Object.defineProperty({}, 'factId', changing);
    assert.equal(invokeTrack(f.client, 'session_started', { entry: 'launch' }, identity), 'invalid');
    const causal = Object.defineProperty({ factId: 'reward' }, 'causationId', changing);
    assert.equal(invokeTrack(f.client, 'ad_reward_committed', reward, causal), 'invalid');
    const details = Object.defineProperty({ code: 'save_failed', operation: 'save' }, 'factId', changing);
    assert.equal(invokeError(f.client, null, details), 'invalid');
    const unsafeContext = Object.defineProperty({ ...context }, 'buildId', changing);
    const invalid = new TelemetryClient({ context: unsafeContext, enabled: true });
    assert.equal(invokeTrack(invalid, 'session_started', { entry: 'launch' }, { factId: 'launch' }), 'invalid');
    assert.equal(reads, 0);
    assert.equal(f.client.flush().status, 'empty');
});

test('diagnostics never access raw causes and rate limit fingerprints and the session separately', () => {
    const f = fixture();
    const cause = new Proxy({}, { get() { throw Error('raw cause must remain opaque'); } });
    const details = { code: 'save_failed', operation: 'save', factId: 'save-1', token: 'SECRET', save: { body: 'PRIVATE' } };
    assert.equal(invokeError(f.client, cause, details), 'queued');
    assert.equal(invokeError(f.client, cause, { ...details, factId: 'save-2' }), 'limited');
    f.advance(60000);
    assert.equal(invokeError(f.client, cause, { ...details, factId: 'save-2' }), 'queued');
    for (let i = 3; i <= 5; i++) { f.advance(60000); assert.equal(invokeError(f.client, cause, { ...details, factId: `save-${i}` }), 'queued'); }
    f.advance(60000);
    assert.equal(invokeError(f.client, cause, { ...details, factId: 'save-6' }), 'limited');
    f.client.flush();
    assert.doesNotMatch(JSON.stringify(f.snapshot()), /SECRET|PRIVATE|token|body/);
});

test('bounded breadcrumbs stay local and are distinct from error and performance reporting', () => {
    const f = fixture();
    for (let i = 0; i < 40; i++) assert.equal(f.client.breadcrumb('save'), 'queued');
    assert.equal(f.client.diagnosticSnapshot().length, 30);
    assert.equal(f.client.diagnosticSnapshot()[0].factId, 'breadcrumb-11');
    assert.equal(f.client.flush().status, 'empty');
    assert.equal(invokeError(f.client, null, { code: 'slow_frame', operation: 'gameplay', factId: 'frame' }), 'invalid');
});

test('adapter failures cannot change a successful reward and retry preserves the same fact exactly once locally', () => {
    const local = new LocalRecordingAdapter(); let fail = true; let attempts = 0;
    const f = fixture({ capabilities: local.capabilities, accept(records) { attempts++; if (fail) throw Error('network off'); return local.accept(records); } });
    const gameplay = { committedReward: false };
    gameplay.committedReward = true; // Owner has committed first; telemetry cannot own this state.
    assert.equal(invokeTrack(f.client, 'ad_reward_committed', reward, rewardIdentity), 'queued');
    assert.deepEqual(f.client.flush(), { status: 'failed', accepted: 0, pending: 1 });
    assert.equal(gameplay.committedReward, true);
    assert.equal(invokeTrack(f.client, 'ad_reward_committed', reward, rewardIdentity), 'duplicate');
    assert.equal(f.client.flush().status, 'deferred'); assert.equal(attempts, 1);
    fail = false; f.advance(1000);
    assert.equal(f.client.flush().accepted, 1);
    assert.equal(local.snapshot().length, 1);
    assert.equal(invokeTrack(f.client, 'ad_reward_committed', reward, rewardIdentity), 'duplicate');
    assert.equal(gameplay.committedReward, true);
});

test('uncertain acceptance retries keep one local fact and cannot mint another reward', () => {
    const local = new LocalRecordingAdapter(); let uncertain = true;
    const f = fixture({ capabilities: local.capabilities, accept(records) {
        local.accept(records); if (uncertain) throw Error('after acceptance'); return 'recorded_locally';
    } });
    f.client.track('ad_reward_committed', reward, rewardIdentity);
    assert.equal(f.client.flush().status, 'failed');
    assert.equal(local.snapshot().length, 1);
    uncertain = false; f.advance(1000);
    assert.equal(f.client.flush().accepted, 1);
    assert.equal(local.snapshot().length, 1);
});

test('event identities scope transaction IDs across gameplay/environment and encode tuples unambiguously', () => {
    const local = new LocalRecordingAdapter();
    const scopes: [TelemetryContext['gameplay'], TelemetryContext['environment']][] = [['ant', 'test'], ['cook', 'test'], ['ant', 'development']];
    for (const [gameplay, environment] of scopes) {
        const client = new TelemetryClient({ context: { ...context, product: 'ant-cook', gameplay, environment }, enabled: true, adapter: local });
        client.track('level_started', { levelId: '1', mode: 'main' }, { factId: 'round-1' }); client.flush();
    }
    assert.equal(new Set(local.snapshot().map(record => record.eventId)).size, 3);
    const client = new TelemetryClient({ context: { ...context, sessionId: 'session:event:level_started:round' }, enabled: true, adapter: local });
    client.track('level_started', { levelId: '1', mode: 'main' }, { factId: 'a:b' }); client.flush();
    const record = local.snapshot()[3];
    assert.deepEqual(JSON.parse(record.eventId).slice(-4), [record.context.sessionId, 'event', 'level_started', 'a:b']);
});

test('Wechat and native Firebase stubs report not configured and cannot claim SDK or remote success', () => {
    for (const adapter of [new WechatTelemetryAdapter(), new NativeFirebaseTelemetryAdapter()]) {
        const f = fixture(adapter);
        assert.deepEqual([adapter.capabilities.configured, adapter.capabilities.externalDelivery,
            adapter.capabilities.rawErrorCapture, adapter.capabilities.nativeCrashCapture], [false, false, false, false]);
        invokeTrack(f.client, 'session_started', { entry: 'launch' }, { factId: 'launch' });
        assert.deepEqual(f.client.flush(), { status: 'not_configured', accepted: 0, pending: 1 });
    }
});

test('offline queues have a finite capacity, batch size and TTL without writes to a player save', () => {
    const f = fixture();
    for (let i = 0; i < 200; i++) assert.equal(invokeTrack(f.client, 'region_entered', { regionId: 'region-1' }, { factId: `visit-${i}` }), 'queued');
    assert.equal(invokeTrack(f.client, 'region_entered', { regionId: 'region-1' }, { factId: 'overflow' }), 'limited');
    assert.equal(f.client.flush().accepted, 20);
    assert.equal(f.client.flush().pending, 160);
    f.advance(86400000);
    assert.deepEqual(f.client.flush(), { status: 'empty', accepted: 0, pending: 0 });
    assert.equal(invokeTrack(f.client, 'region_entered', { regionId: 'region-1' }, { factId: 'visit-0' }), 'queued');
});

test('local recording and dedup ledger stay bounded after repeated successful batches', () => {
    const f = fixture();
    for (let i = 0; i < 2000; i++) {
        assert.equal(invokeTrack(f.client, 'region_entered', { regionId: 'region-1' }, { factId: `visit-${i}` }), 'queued');
        if (i % 20 === 19) f.client.flush();
    }
    assert.equal(f.snapshot().length, 200);
    assert.equal(invokeTrack(f.client, 'region_entered', { regionId: 'region-1' }, { factId: 'overflow' }), 'limited');
    assert.equal(invokeTrack(f.client, 'region_entered', { regionId: 'region-1' }, { factId: 'visit-0' }), 'duplicate');
});

test('invalid clock or build identity fails closed and never escapes a gameplay call', () => {
    const client = new TelemetryClient({ context, enabled: true, now() { throw Error('clock'); } });
    assert.equal(invokeTrack(client, 'session_started', { entry: 'launch' }, { factId: 'launch' }), 'failed');
    assert.equal(client.flush().status, 'failed');
    const invalid = new TelemetryClient({ context: { ...context, commit: 'unknown' }, enabled: true });
    assert.equal(invokeTrack(invalid, 'session_started', { entry: 'launch' }, { factId: 'launch' }), 'invalid');
});

test('reentrant provider callbacks cannot drain a new fact or start another acceptance', () => {
    const local = new LocalRecordingAdapter(); let nested: FlushResult | undefined; let calls = 0;
    const adapter: TelemetryAdapter = { capabilities: local.capabilities, accept(records) {
        calls++; f.advance(86400000);
        invokeTrack(f.client, 'region_entered', { regionId: 'region-2' }, { factId: 'new-visit' });
        nested = f.client.flush();
        return local.accept(records);
    } };
    const f = fixture(adapter);
    invokeTrack(f.client, 'region_entered', { regionId: 'region-1' }, { factId: 'old-visit' });
    assert.deepEqual(f.client.flush(), { status: 'recorded_locally', accepted: 1, pending: 1 });
    assert.ok(nested); assert.equal(nested.status, 'deferred'); assert.equal(calls, 1);
    assert.equal(local.snapshot()[0].factId, 'old-visit');
});

test('real Ant progress commits reward before telemetry; failed saves and retried callbacks never fabricate reward facts', () => {
    const values = new Map<string, string>(); let failSave = false;
    const progress = new PlayerProgress({ read: key => values.get(key) ?? null,
        write(key, value) { if (failSave && key === PROGRESS_SAVE_KEY) throw Error('disk full'); values.set(key, value); },
    }, { now: () => PROGRESS_CALENDAR_START }, leaderboardTestConfig, socialTestConfig);
    const local = new LocalRecordingAdapter(); let failTelemetry = true;
    const f = fixture({ capabilities: local.capabilities, accept(records) {
        if (failTelemetry) throw Error('provider unavailable'); return local.accept(records);
    } });
    const before = progress.snapshot().daily.boostRemainingMs;
    const commit = () => {
        const previous = progress.snapshot().daily.boostRemainingMs;
        const granted = progress.grantSpeedBoostReward('request-1');
        if (granted) f.client.track('ad_reward_committed', { ...reward,
            amount: progress.snapshot().daily.boostRemainingMs - previous }, rewardIdentity);
        return granted;
    };
    failSave = true;
    assert.throws(commit, /disk full/);
    assert.equal(progress.snapshot().daily.boostRemainingMs, before);
    assert.equal(f.client.flush().status, 'empty');
    failSave = false;
    assert.equal(commit(), true);
    const committed = progress.snapshot().daily.boostRemainingMs;
    assert.ok(committed > before);
    assert.equal(f.client.flush().status, 'failed');
    assert.equal(progress.snapshot().daily.boostRemainingMs, committed);
    assert.equal(commit(), false);
    assert.equal(progress.snapshot().daily.boostRemainingMs, committed);
    assert.equal(f.client.track('ad_reward_committed', { ...reward, amount: committed - before }, rewardIdentity), 'duplicate');
    failTelemetry = false; f.advance(1000);
    assert.equal(f.client.flush().accepted, 1);
    assert.equal(local.snapshot().length, 1);
    assert.equal(local.snapshot()[0].fields.amount, committed - before);
});
