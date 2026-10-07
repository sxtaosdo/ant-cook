import { LocalRecordingAdapter, TelemetryAdapter, TelemetryCapabilities } from './telemetryAdapters';
import { ErrorDetails, FactIdentity, TelemetryContext, TelemetryEventName, TelemetryFields, TelemetryRecord, TelemetrySchema, Scalar } from './telemetrySchema';

export type TrackResult = 'queued' | 'duplicate' | 'disabled' | 'invalid' | 'limited' | 'failed';
export interface FlushResult { status: 'disabled' | 'empty' | 'recorded_locally' | 'not_configured' | 'deferred' | 'failed'; accepted: number; pending: number }
export interface TelemetryOptions {
    context: TelemetryContext;
    enabled?: boolean;
    adapter?: TelemetryAdapter;
    now?: () => number;
}

/** Opt-in, memory-only instrumentation. No timers, listeners, storage, SDK or network side effects. */
export class TelemetryClient {
    private readonly adapter: TelemetryAdapter;
    private readonly now: () => number;
    private readonly context: Readonly<TelemetryContext> | null;
    private readonly enabled: boolean;
    private readonly queue: { record: TelemetryRecord; bytes: number }[] = [];
    private readonly seen = new Map<string, number>();
    private readonly errorTimes = new Map<string, number>();
    private readonly breadcrumbs: TelemetryRecord[] = [];
    private errorCount = 0;
    private byteCount = 0;
    private nextFlushAt = 0;
    private failures = 0;
    private flushing = false;
    private breadcrumbSequence = 0;
    private readonly ttlMs = 86400000;

    public constructor(options: TelemetryOptions) {
        this.adapter = options.adapter || new LocalRecordingAdapter();
        this.now = options.now || Date.now;
        this.enabled = options.enabled === true;
        // Invalid context disables recording without affecting the caller's game bootstrap.
        try { this.context = TelemetrySchema.context(options.context); } catch { this.context = null; }
    }

    public capabilities(): Readonly<TelemetryCapabilities> {
        return this.adapter.capabilities;
    }

    /** Fact IDs come from the owning transaction. Retries must reuse them; never use a click ID as a commit ID. */
    public track<K extends TelemetryEventName>(name: K, fields: TelemetryFields[K], identity: FactIdentity): TrackResult {
        if (!this.enabled) return 'disabled';
        try {
            const safe = TelemetrySchema.event(name, fields);
            const fact = TelemetrySchema.identity(identity);
            if (!safe || !fact || (name === 'ad_reward_committed' && !fact.causationId)) return 'invalid';
            return this.enqueue('event', name, safe, fact, this.time());
        } catch { return 'failed'; }
    }

    /** The cause is deliberately opaque: no message, stack, token, URL or save text is accessed. */
    public captureError(_cause: unknown, details: ErrorDetails): TrackResult {
        if (!this.enabled) return 'disabled';
        try {
            const safe = TelemetrySchema.error(details);
            const fact = TelemetrySchema.identity(details);
            if (!safe || !fact) return 'invalid';
            const time = this.time();
            const fingerprint = `${safe.code}:${safe.operation}`;
            const previous = this.errorTimes.get(fingerprint);
            if (this.errorCount >= 5 || (previous !== undefined && time - previous < 60000)) return 'limited';
            const result = this.enqueue('error', String(safe.code), safe, fact, time);
            if (result === 'queued') { this.errorCount++; this.errorTimes.set(fingerprint, time); }
            return result;
        } catch { return 'failed'; }
    }

    /** Local bounded diagnostic markers; freeform data is intentionally unsupported. */
    public breadcrumb(name: 'boot' | 'resource' | 'save' | 'gameplay' | 'switch' | 'ad'): TrackResult {
        if (!this.enabled) return 'disabled';
        try {
            if (!this.context || !TelemetrySchema.breadcrumb(name)) return 'invalid';
            const factId = `breadcrumb-${++this.breadcrumbSequence}`;
            this.breadcrumbs.push(this.record('breadcrumb', name, Object.freeze({}), { factId }, this.time()));
            if (this.breadcrumbs.length > 30) this.breadcrumbs.shift();
            return 'queued';
        } catch { return 'failed'; }
    }

    public diagnosticSnapshot(): readonly TelemetryRecord[] { return Object.freeze(this.breadcrumbs.slice()); }

    /** Best effort local acceptance, never a remote delivery confirmation or a gameplay save gate. */
    public flush(): FlushResult {
        if (!this.enabled) return this.flushResult('disabled');
        if (this.flushing) return this.flushResult('deferred');
        try {
            const time = this.time();
            this.expire(time);
            if (!this.queue.length) return this.flushResult('empty');
            if (time < this.nextFlushAt) return this.flushResult('deferred');
            this.flushing = true;
            const batch = Object.freeze(this.queue.slice(0, 20).map(item => item.record));
            const result = this.adapter.accept(batch);
            if (result === 'not_configured') return this.flushResult('not_configured');
            if (result === 'recorded_locally') {
                // Re-entrant adapter callbacks may enqueue/expire facts; remove only this accepted batch.
                for (let i = this.queue.length - 1; i >= 0; i--) {
                    if (batch.includes(this.queue[i].record)) this.byteCount -= this.queue.splice(i, 1)[0].bytes;
                }
                this.failures = 0; this.nextFlushAt = 0;
                return this.flushResult('recorded_locally', batch.length);
            }
            this.defer(time);
            return this.flushResult('deferred');
        } catch {
            // Clock/adapter exceptions do not escape into gameplay or recurse into the reporter.
            this.nextFlushAt = Number.MAX_SAFE_INTEGER;
            try { this.defer(this.time()); } catch { /* invalid clock: fail closed */ }
            return this.flushResult('failed');
        } finally { this.flushing = false; }
    }

    private enqueue(kind: 'event' | 'error', name: string, fields: Readonly<Record<string, Scalar>>, identity: FactIdentity, time: number): TrackResult {
        if (!this.context) return 'invalid';
        this.expire(time);
        const record = this.record(kind, name, fields, identity, time);
        if (this.seen.has(record.eventId)) return 'duplicate';
        // Bound both the queue and dedup ledger; refuse new facts rather than evict retry identities.
        if (this.queue.length >= 200 || this.seen.size >= 2000) return 'limited';
        const bytes = JSON.stringify(record).length * 3; // Conservative UTF-8 upper bound for this ASCII-only DTO.
        if (this.byteCount + bytes > 512 * 1024) return 'limited';
        this.queue.push({ record, bytes }); this.byteCount += bytes;
        this.seen.set(record.eventId, time);
        return 'queued';
    }

    private record(kind: TelemetryRecord['kind'], name: string, fields: Readonly<Record<string, Scalar>>, identity: FactIdentity, time: number): TelemetryRecord {
        if (!this.context) throw new Error('Invalid telemetry context');
        // Opaque tuple encoding prevents delimiter collisions and scopes local transaction IDs per gameplay/environment.
        const eventId = JSON.stringify([this.context.environment, this.context.product, this.context.gameplay,
            this.context.sessionId, kind, name, identity.factId]);
        return Object.freeze({ schemaVersion: 1, kind, name, eventId, factId: identity.factId,
            ...(identity.causationId === undefined ? {} : { causationId: identity.causationId }),
            timestampMs: time, context: this.context, fields });
    }

    private time(): number {
        const value = this.now();
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid telemetry clock');
        return value;
    }

    private expire(time: number): void {
        for (let i = this.queue.length - 1; i >= 0; i--) {
            if (time - this.queue[i].record.timestampMs >= this.ttlMs) this.byteCount -= this.queue.splice(i, 1)[0].bytes;
        }
        for (const [id, created] of this.seen) if (time - created >= this.ttlMs) this.seen.delete(id);
    }

    private defer(time: number): void {
        this.failures = Math.min(this.failures + 1, 9);
        this.nextFlushAt = time + Math.min(300000, 1000 * Math.pow(2, this.failures - 1));
    }

    private flushResult(status: FlushResult['status'], accepted = 0): FlushResult {
        return { status, accepted, pending: this.queue.length };
    }
}
