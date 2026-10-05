import type { CookPageState, CookSceneContext } from './cookPageTypes';
import type { P10Screen } from '../../application/contracts';
abstract class SecondaryState implements CookPageState {
    context!: CookSceneContext;
    abstract readonly screen: P10Screen;
    enter(): void { this.context.syncPresentation(); }
    exit(): void {}
}
export class PauseState extends SecondaryState { readonly screen = 'pause'; }
export class ResultState extends SecondaryState { readonly screen = 'result'; }
export class UpgradeState extends SecondaryState { readonly screen = 'upgrade'; }
export class DecorState extends SecondaryState { readonly screen = 'decor'; }
export class StoryState extends SecondaryState { readonly screen = 'story'; }
export class UnlockState extends SecondaryState { readonly screen = 'unlock'; }
export class SettingsState extends SecondaryState { readonly screen = 'settings'; }
export class RecoveryState extends SecondaryState { readonly screen = 'recovery'; }
