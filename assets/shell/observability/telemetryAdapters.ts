import type { TelemetryRecord } from './telemetrySchema';

export interface TelemetryCapabilities {
    provider: 'local' | 'wechat' | 'native-firebase';
    configured: boolean;
    externalDelivery: boolean;
    rawErrorCapture: boolean;
    nativeCrashCapture: boolean;
}
export type AdapterResult = 'recorded_locally' | 'not_configured' | 'retry';
/** Synchronous, bounded acceptance only. Never wait for a network ACK in a gameplay command. */
export interface TelemetryAdapter {
    readonly capabilities: Readonly<TelemetryCapabilities>;
    accept(records: readonly TelemetryRecord[]): AdapterResult;
}

export class LocalRecordingAdapter implements TelemetryAdapter {
    public readonly capabilities = Object.freeze({ provider: 'local' as const, configured: true,
        externalDelivery: false, rawErrorCapture: false, nativeCrashCapture: false });
    private readonly records: TelemetryRecord[] = [];

    public accept(records: readonly TelemetryRecord[]): AdapterResult {
        // A caller may retry after an uncertain result. Deduplicate within the bounded local retention window.
        for (const record of records) {
            if (this.records.some(existing => existing.eventId === record.eventId)) continue;
            this.records.push(record);
            if (this.records.length > 200) this.records.shift();
        }
        return 'recorded_locally';
    }

    public snapshot(): readonly TelemetryRecord[] { return Object.freeze(this.records.slice()); }
    public clear(): void { this.records.length = 0; }
}

/** No wx calls, credentials, SDK imports or implicit fallback. Future platform wiring is a separate task. */
export class WechatTelemetryAdapter implements TelemetryAdapter {
    public readonly capabilities = Object.freeze({ provider: 'wechat' as const, configured: false,
        externalDelivery: false, rawErrorCapture: false, nativeCrashCapture: false });
    public accept(_records: readonly TelemetryRecord[]): AdapterResult { return 'not_configured'; }
}

/** Firebase is a capability stub only; native bridge and crash handling have not been verified. */
export class NativeFirebaseTelemetryAdapter implements TelemetryAdapter {
    public readonly capabilities = Object.freeze({ provider: 'native-firebase' as const, configured: false,
        externalDelivery: false, rawErrorCapture: false, nativeCrashCapture: false });
    public accept(_records: readonly TelemetryRecord[]): AdapterResult { return 'not_configured'; }
}
