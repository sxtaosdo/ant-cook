import { failure, success, type Result } from 'db://shidai3/index';
import {
    FrameworkSnapshot,
    SaveCoordinator,
    serializeSnapshot,
} from 'db://shidai3/index';
import { P10GameCore } from '../../core';
import { P10GameSaveSection } from './P10GameSaveSection';
import type { StoragePort, StructuredSaveError } from '../../application/contracts';

export interface P10FrameworkSaveConfig {
    readonly frameworkVersion: string;
    readonly sectionId: string;
    readonly primaryKey: string;
}

export interface P10LoadResult {
    readonly core: P10GameCore;
    readonly usedLegacy: boolean;
    readonly migrated: boolean;
    readonly recoveryError?: StructuredSaveError;
}

export class FrameworkSaveCoordinatorAdapter {
    private readonly saveCoordinator: SaveCoordinator;
    private sectionAttached = false;
    private getCore!: () => P10GameCore;
    private setCore!: (core: P10GameCore) => void;
    private sectionError: StructuredSaveError | null = null;
    private pendingSnapshot: string | null = null;
    public get hasPendingSnapshot(): boolean { return this.pendingSnapshot !== null; }

    public constructor(
        private readonly storage: StoragePort,
        private readonly config: P10FrameworkSaveConfig,
    ) {
        this.saveCoordinator = new SaveCoordinator(config.frameworkVersion);
    }

    public get coordinator(): SaveCoordinator {
        return this.saveCoordinator;
    }

    public attachCoreState(
        getCore: () => P10GameCore,
        setCore: (core: P10GameCore) => void,
    ): Result<void, StructuredSaveError> {
        this.getCore = getCore;
        this.setCore = setCore;
        const registered = this.saveCoordinator.register(new P10GameSaveSection(
            this.config.sectionId,
            () => this.getCore(),
            (core) => this.setCore(core),
            (error) => {
                this.sectionError = error;
            },
        ));
        if (!registered.ok) {
            return failure({
                code: 'SAVE_SECTION_DUPLICATE',
                sectionId: this.config.sectionId,
                cause: 'section already registered',
            });
        }
        this.sectionAttached = true;
        return success(undefined);
    }

    public loadOrCreate(defaultCore: P10GameCore): Result<P10LoadResult, StructuredSaveError> {
        if (!this.sectionAttached) {
            return failure({
                code: 'SAVE_RESTORE_FAILED',
                sectionId: this.config.sectionId,
                cause: 'runtime section not attached',
            });
        }

        const primary = this.readStructuredSnapshot();
        if (primary.ok) {
            const restored = this.saveCoordinator.restore(primary.value);
            if (!restored.ok) return failure({ code: 'SAVE_RESTORE_FAILED', sectionId: this.config.sectionId,
                cause: String(restored.error.cause ?? restored.error.code) });
            return success({ core: this.getCore(), usedLegacy: false, migrated: false });
        }
        if (primary.error.code !== 'SAVE_SECTION_MISSING') return failure(primary.error);
        this.setCore(defaultCore);
        const saved = this.save();
        if (!saved.ok) return failure(saved.error);
        return success({ core: defaultCore, usedLegacy: false, migrated: false });
    }

    public save(): Result<string, StructuredSaveError> {
        if (!this.sectionAttached) {
            return failure({
                code: 'SAVE_SECTION_MISSING',
                sectionId: this.config.sectionId,
                cause: 'runtime section not attached',
            });
        }
        if (this.pendingSnapshot === null) {
            const snapshot = this.saveCoordinator.capture();
            if (!snapshot.ok) {
                const error: StructuredSaveError = { code: 'SAVE_CAPTURE_FAILED', sectionId: this.config.sectionId,
                    cause: String(snapshot.error.code) };
                this.sectionError = error;
                return failure(error);
            }
            this.pendingSnapshot = serializeSnapshot(snapshot.value);
        }
        const serialized = this.pendingSnapshot;
        try {
            this.storage.setItem(this.config.primaryKey, serialized);
            this.sectionError = null;
            this.pendingSnapshot = null;
            return success(serialized);
        } catch (error) {
            const saveError: StructuredSaveError = {
                code: 'SAVE_SECTION_WRITE_FAILED',
                sectionId: this.config.primaryKey,
                cause: String(error),
            };
            this.sectionError = saveError;
            return failure(saveError);
        }
    }

    public readStructuredSnapshot(): Result<FrameworkSnapshot, StructuredSaveError> {
        let raw: string | null;
        try {
            raw = this.storage.getItem(this.config.primaryKey);
        } catch (error) {
            return failure({
                code: 'SAVE_RESTORE_FAILED',
                sectionId: this.config.primaryKey,
                cause: String(error),
            });
        }
        if (raw === null) {
            return failure({
                code: 'SAVE_SECTION_MISSING',
                sectionId: this.config.primaryKey,
                cause: 'primary key missing',
            });
        }

        let snapshot: unknown;
        try {
            snapshot = JSON.parse(raw);
        } catch (error) {
            return failure({
                code: 'SAVE_SECTION_CORRUPT',
                sectionId: this.config.primaryKey,
                cause: String(error),
            });
        }

        if (!isFrameworkSnapshot(snapshot)) {
            return failure({
                code: 'SAVE_SECTION_INVALID',
                sectionId: this.config.primaryKey,
                cause: 'not a valid framework snapshot',
            });
        }
        if (snapshot.frameworkVersion !== this.config.frameworkVersion) {
            return failure({
                code: 'SAVE_VERSION_UNSUPPORTED',
                sectionId: this.config.primaryKey,
                cause: `framework version mismatch: ${snapshot.frameworkVersion}`,
            });
        }
        return success(snapshot);
    }

    public lastSectionError(): StructuredSaveError | null {
        return this.sectionError;
    }

    public deletePrimaryKey(): void {
        this.storage.removeItem(this.config.primaryKey);
    }

    public clearSectionError(): void {
        this.sectionError = null;
    }


}

function isFrameworkSnapshot(value: unknown): value is FrameworkSnapshot {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<FrameworkSnapshot>;
    return candidate.schemaVersion === 1
        && typeof candidate.frameworkVersion === 'string'
        && typeof candidate.sections === 'object'
        && candidate.sections !== null;
}
