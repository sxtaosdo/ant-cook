/** Product-local draft contract. No player identity, raw error, URL or save body enters this DTO. */
export interface TelemetryContext {
    product: 'p1060' | 'ant-cook';
    gameplay: 'endless' | 'ant' | 'cook' | 'shell';
    environment: 'development' | 'test' | 'production';
    platform: 'web' | 'wechat' | 'native';
    sessionId: string;
    release: string;
    commit: string;
    buildId: string;
}

export interface TelemetryFields {
    session_started: { entry: 'launch' | 'resume' };
    session_ready: { durationMs: number };
    level_started: { levelId: string; mode: 'main' | 'daily' | 'endless' };
    level_finished: { levelId: string; outcome: 'win' | 'loss' | 'exit'; durationMs: number };
    region_entered: { regionId: string };
    encounter_started: { encounterId: string };
    encounter_finished: { encounterId: string; outcome: 'win' | 'loss' | 'exit' };
    item_used: { itemId: string; quantity: number; commitState: 'applied' | 'persisted' };
    currency_changed: { currency: 'coins' | 'gold' | 'exp' | 'stars' | 'diamonds' | 'stamps' | 'vouchers' | 'supplyTokens'; before: number; after: number; delta: number; reason: 'reward' | 'spend' | 'refund' | 'settlement'; commitState: 'applied' | 'persisted' };
    ad_shown: { placementId: string };
    ad_video_completed: { placementId: string; completed: true };
    ad_reward_committed: { placementId: string; rewardType: 'currency' | 'item' | 'duration'; rewardCode: string; amount: number; commitState: 'persisted' };
    save_failed: { operation: 'read' | 'write' | 'restore'; code: 'quota' | 'unavailable' | 'corrupt' | 'unknown' };
    save_recovered: { operation: 'read' | 'write' | 'restore' };
    invite_presented: { target: 'ant' | 'cook' };
    invite_accepted: { target: 'ant' | 'cook' };
    gameplay_switch_completed: { from: 'ant' | 'cook' | 'shell'; to: 'ant' | 'cook' };
}
export type TelemetryEventName = keyof TelemetryFields;
export interface FactIdentity { factId: string; causationId?: string }
export type DiagnosticCode = 'js_uncaught' | 'promise_unhandled' | 'resource_failed' | 'network_failed' | 'save_failed' | 'black_screen' | 'stalled';
export interface ErrorDetails { code: DiagnosticCode; operation: 'boot' | 'resource' | 'network' | 'save' | 'gameplay' | 'switch'; factId: string; causationId?: string }
export type Scalar = string | number | boolean;
export interface TelemetryRecord {
    schemaVersion: 1;
    kind: 'event' | 'error' | 'breadcrumb';
    name: string;
    eventId: string;
    factId: string;
    causationId?: string;
    timestampMs: number;
    context: Readonly<TelemetryContext>;
    fields: Readonly<Record<string, Scalar>>;
}

type FieldRule = 'id' | 'release' | 'commit' | 'count' | 'signed' | 'duration' | readonly Scalar[];
type FieldRules = Readonly<Record<string, FieldRule>>;

export class TelemetrySchema {
    private static readonly currency = ['coins', 'gold', 'exp', 'stars', 'diamonds', 'stamps', 'vouchers', 'supplyTokens'];
    private static readonly outcomes = ['win', 'loss', 'exit'];
    private static readonly rules: Record<TelemetryEventName, FieldRules> = {
        session_started: { entry: ['launch', 'resume'] },
        session_ready: { durationMs: 'duration' },
        level_started: { levelId: 'id', mode: ['main', 'daily', 'endless'] },
        level_finished: { levelId: 'id', outcome: TelemetrySchema.outcomes, durationMs: 'duration' },
        region_entered: { regionId: 'id' },
        encounter_started: { encounterId: 'id' },
        encounter_finished: { encounterId: 'id', outcome: TelemetrySchema.outcomes },
        item_used: { itemId: 'id', quantity: 'count', commitState: ['applied', 'persisted'] },
        currency_changed: { currency: TelemetrySchema.currency, before: 'count', after: 'count', delta: 'signed', reason: ['reward', 'spend', 'refund', 'settlement'], commitState: ['applied', 'persisted'] },
        ad_shown: { placementId: 'id' },
        ad_video_completed: { placementId: 'id', completed: [true] },
        ad_reward_committed: { placementId: 'id', rewardType: ['currency', 'item', 'duration'], rewardCode: 'id', amount: 'count', commitState: ['persisted'] },
        save_failed: { operation: ['read', 'write', 'restore'], code: ['quota', 'unavailable', 'corrupt', 'unknown'] },
        save_recovered: { operation: ['read', 'write', 'restore'] },
        invite_presented: { target: ['ant', 'cook'] },
        invite_accepted: { target: ['ant', 'cook'] },
        gameplay_switch_completed: { from: ['ant', 'cook', 'shell'], to: ['ant', 'cook'] },
    };

    public static identifier(value: unknown): value is string {
        // IDs must be application-generated opaque identifiers, never account IDs or provider tokens.
        return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(value);
    }

    public static context(input: unknown): Readonly<TelemetryContext> | null {
        const safe = this.select(input, { product: ['p1060', 'ant-cook'], gameplay: ['endless', 'ant', 'cook', 'shell'],
            environment: ['development', 'test', 'production'], platform: ['web', 'wechat', 'native'],
            sessionId: 'id', release: 'release', commit: 'commit', buildId: 'id' });
        if (!safe || (safe.product === 'p1060' ? safe.gameplay !== 'endless' : safe.gameplay === 'endless')) return null;
        // Each property above was copied once and validated against the context's exact scalar contract.
        return Object.freeze({ product: safe.product, gameplay: safe.gameplay,
            environment: safe.environment, platform: safe.platform, sessionId: safe.sessionId,
            release: safe.release, commit: safe.commit, buildId: safe.buildId }) as Readonly<TelemetryContext>;
    }

    public static identity(input: unknown): Readonly<FactIdentity> | null {
        const safe = this.select(input, { factId: 'id' });
        if (!safe || typeof safe.factId !== 'string') return null;
        const descriptor = Object.getOwnPropertyDescriptor(input, 'causationId');
        if (!descriptor) return Object.freeze({ factId: safe.factId });
        if (!('value' in descriptor)) return null;
        const cause: unknown = descriptor.value;
        if (cause === undefined) return Object.freeze({ factId: safe.factId });
        if (!this.identifier(cause)) return null;
        return Object.freeze({ factId: safe.factId, causationId: cause });
    }

    public static event(name: unknown, input: unknown): Readonly<Record<string, Scalar>> | null {
        if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(this.rules, name)) return null;
        const rules = this.rules[name as TelemetryEventName];
        const fields = this.select(input, rules);
        if (!fields) return null;
        if (name === 'currency_changed' && (Number(fields.after) - Number(fields.before) !== fields.delta || fields.delta === 0)) return null;
        if ((name === 'item_used' && fields.quantity === 0) || (name === 'ad_reward_committed' && fields.amount === 0)) return null;
        if (name === 'gameplay_switch_completed' && fields.from === fields.to) return null;
        return fields;
    }

    public static error(input: ErrorDetails): Readonly<Record<string, Scalar>> | null {
        return this.select(input, {
            code: ['js_uncaught', 'promise_unhandled', 'resource_failed', 'network_failed', 'save_failed', 'black_screen', 'stalled'],
            operation: ['boot', 'resource', 'network', 'save', 'gameplay', 'switch'],
        });
    }

    public static breadcrumb(name: unknown): name is 'boot' | 'resource' | 'save' | 'gameplay' | 'switch' | 'ad' {
        return typeof name === 'string' && ['boot', 'resource', 'save', 'gameplay', 'switch', 'ad'].includes(name);
    }

    private static select(input: unknown, rules: FieldRules): Readonly<Record<string, Scalar>> | null {
        if (typeof input !== 'object' || input === null) return null;
        const result: Record<string, Scalar> = {};
        for (const key of Object.keys(rules)) {
            // Unknown properties are never enumerated, accessed, stringified or transmitted.
            const descriptor = Object.getOwnPropertyDescriptor(input, key);
            if (!descriptor || !('value' in descriptor)) return null;
            const value: unknown = descriptor.value;
            const rule = rules[key];
            if (typeof rule !== 'string') {
                if (!rule.some(candidate => candidate === value)) return null;
            } else if (rule === 'id') {
                if (!this.identifier(value)) return null;
            } else if (rule === 'release') {
                if (typeof value !== 'string' || value.length > 32 || !/^\d+\.\d+\.\d+\.\d+$/.test(value)) return null;
            } else if (rule === 'commit') {
                if (typeof value !== 'string' || !/^[a-f0-9]{7,40}$/.test(value)) return null;
            } else if (typeof value !== 'number' || !Number.isSafeInteger(value)
                || Math.abs(value) > (rule === 'duration' ? 86400000 : 1000000000000)
                || (rule !== 'signed' && value < 0)) return null;
            if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
            result[key] = value;
        }
        return Object.freeze(result);
    }
}
