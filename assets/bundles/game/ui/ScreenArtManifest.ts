export type ScreenArtScreen =
    | 'map' | 'level' | 'kitchen' | 'pause' | 'result' | 'upgrade'
    | 'decor' | 'story' | 'unlock' | 'settings' | 'recovery';

export interface ScreenArtEntry {
    readonly path: string;
    readonly failurePath?: string;
    readonly overlayAlpha: number;
    readonly theme: 'cyan' | 'red' | 'gold' | 'jade';
}

const background = (name: string): string => `resources/art_v2/backgrounds/${name}/spriteFrame`;

export const SCREEN_ART_MANIFEST: Readonly<Record<ScreenArtScreen, ScreenArtEntry>> = {
    map: { path: background('map'), overlayAlpha: 42, theme: 'red' },
    level: { path: background('level'), overlayAlpha: 48, theme: 'gold' },
    kitchen: { path: background('kitchen'), overlayAlpha: 36, theme: 'cyan' },
    pause: { path: background('kitchen'), overlayAlpha: 112, theme: 'cyan' },
    result: { path: background('result_success'), failurePath: background('result_failure'), overlayAlpha: 40, theme: 'gold' },
    upgrade: { path: background('upgrade'), overlayAlpha: 52, theme: 'cyan' },
    decor: { path: background('renovation'), overlayAlpha: 46, theme: 'gold' },
    story: { path: background('story'), overlayAlpha: 54, theme: 'red' },
    unlock: { path: background('unlock'), overlayAlpha: 40, theme: 'gold' },
    settings: { path: background('recovery'), overlayAlpha: 72, theme: 'jade' },
    recovery: { path: background('recovery'), overlayAlpha: 72, theme: 'jade' },
};

export function artPathFor(screen: ScreenArtScreen, success: boolean): string {
    const entry = SCREEN_ART_MANIFEST[screen];
    return screen === 'result' && !success ? entry.failurePath! : entry.path;
}
