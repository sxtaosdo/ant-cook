import type { FactIdentity, TelemetryEventName, TelemetryFields } from './observability/telemetrySchema';

/** Synchronous best-effort facts; observers never control saves or scene readiness. */
export interface ProductTelemetryPort {
  track<K extends TelemetryEventName>(name: K, fields: TelemetryFields[K], identity: FactIdentity): unknown;
}

export type ModeId = 'ant' | 'cook';
export type EntrySource = 'launch' | 'manual' | 'promotion' | 'recovery';
export type LeaveStatus = 'ready' | 'playing' | 'adShowing' | 'rewardPending' | 'saveFailed';
export type SaveOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface LocalStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ModuleDescriptor {
  readonly id: ModeId;
  readonly bundleName: string;
  readonly sceneName: string;
}

export interface GameplayModule {
  readonly id: ModeId;
  canLeave(): LeaveStatus;
  prepareExit(): Promise<LeaveStatus>;
  flush(): Promise<SaveOutcome>;
  close(reason: 'switch' | 'recovery'): Promise<void>;
  resumeInput(): void;
}

export interface ModuleReady {
  readonly transactionId: string;
  readonly mode: ModeId;
  readonly businessReady: boolean;
  readonly firstFrameReady: boolean;
}

export interface ModuleEntry {
  readonly mode: ModeId;
  readonly transactionId: string;
  readonly generation: number;
  readonly source: EntrySource;
  readonly storage: LocalStoragePort;
  isCurrent(): boolean;
  attach(module: GameplayModule): void;
  ready(report: ModuleReady): void;
  saveBlocked(cause: unknown): void;
  fail(cause: unknown): void;
  /** Shell UI requests do not transfer gameplay state or economy. */
  requestNavigation?(): boolean;
  isNavigationCovered?(): boolean;
}

export interface SceneDriver {
  preflight(descriptor: ModuleDescriptor): Promise<void>;
  enter(descriptor: ModuleDescriptor, entry: ModuleEntry): Promise<void>;
}

export type SwitchResult =
  | { readonly ok: true; readonly mode: ModeId; readonly metadataPending: boolean }
  | { readonly ok: false; readonly reason: string; readonly recoveredMode?: ModeId; readonly canContinue?: boolean };

/** One explicit business entry, set before scene replacement. No arbitrary service lookup. */
export class ModuleEntryGate {
  private static entry: ModuleEntry | null = null;
  static bind(entry: ModuleEntry): void { this.entry = entry; }
  static require(mode: ModeId): ModuleEntry {
    const entry = this.entry;
    if (!entry || entry.mode !== mode || !entry.isCurrent()) throw new Error(`No current ${mode} entry`);
    return entry;
  }
}
