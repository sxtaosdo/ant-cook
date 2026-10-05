import { failure, success, type Result } from 'db://shidai3/index';
import type { SaveSection, SaveSectionError } from 'db://shidai3/index';
import type { StructuredSaveError } from '../../application/contracts';
import { P10GameCore } from '../../core';

export interface P10GameSaveSectionState {
    readonly save: string;
}

export class P10GameSaveSection implements SaveSection<P10GameSaveSectionState> {
    public readonly id: string;
    private readonly getCore: () => P10GameCore;
    private readonly setCore: (core: P10GameCore) => void;
    private readonly onSectionError: (error: StructuredSaveError | null) => void;

    public constructor(
        sectionId: string,
        getCore: () => P10GameCore,
        setCore: (core: P10GameCore) => void,
        onSectionError: (error: StructuredSaveError | null) => void,
    ) {
        this.id = sectionId;
        this.getCore = getCore;
        this.setCore = setCore;
        this.onSectionError = onSectionError;
    }

    public capture(): Result<P10GameSaveSectionState, SaveSectionError> {
        try {
            const captured = this.getCore().serialize();
            this.onSectionError(null);
            return success({ save: captured });
        } catch (error) {
            const structured: SaveSectionError = { code: 'SAVE_CAPTURE_FAILED', cause: String(error) };
            this.onSectionError({
                code: 'SAVE_CAPTURE_FAILED',
                sectionId: this.id,
                cause: structured.cause,
            });
            return failure(structured);
        }
    }

    public restore(state: unknown): Result<void, SaveSectionError> {
        const parsed = this.parseState(state);
        if (!parsed.ok) {
            this.onSectionError({
                code: 'SAVE_SECTION_INVALID',
                sectionId: this.id,
                cause: parsed.error.cause,
            });
            return failure(parsed.error);
        }
        try {
            this.setCore(P10GameCore.load(parsed.value.save));
            this.onSectionError(null);
            return success(undefined);
        } catch (error) {
            const structured: SaveSectionError = { code: 'SAVE_RESTORE_FAILED', cause: String(error) };
            this.onSectionError({
                code: 'SAVE_RESTORE_FAILED',
                sectionId: this.id,
                cause: String(error),
            });
            return failure(structured);
        }
    }

    private parseState(state: unknown): Result<P10GameSaveSectionState, SaveSectionError> {
        if (!state || typeof state !== 'object') {
            return failure({ code: 'SAVE_SECTION_INVALID', cause: 'state must be an object' });
        }
        const source = state as Record<string, unknown>;
        const save = source.save;
        if (typeof save !== 'string' || save.length === 0) {
            return failure({ code: 'SAVE_SECTION_INVALID', cause: 'state.save must be a non-empty string' });
        }
        return success({ save });
    }
}
