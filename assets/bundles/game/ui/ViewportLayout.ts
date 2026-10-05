import { screen, sys, view, ResolutionPolicy } from 'cc';

export interface ViewportLayout {
    readonly width: number;
    readonly height: number;
    readonly safeTop: number;
    readonly safeBottom: number;
    readonly topY: number;
    readonly bottomY: number;
}

export function applyViewportLayout(): ViewportLayout {
    const windowSize = screen.windowSize;
    const width = 750;
    const height = Math.max(1334, width * windowSize.height / Math.max(1, windowSize.width));
    view.setDesignResolutionSize(width, height, ResolutionPolicy.FIXED_WIDTH);

    // Creator returns this rectangle in design-resolution coordinates and
    // falls back to the complete visible area on platforms without a notch.
    const visible = view.getVisibleSize();
    const safe = sys.getSafeAreaRect(false);
    const safeTop = Math.max(0, visible.height - safe.y - safe.height);
    const safeBottom = Math.max(0, safe.y);
    return {
        width,
        height,
        safeTop,
        safeBottom,
        topY: height / 2 - safeTop - 24,
        bottomY: -height / 2 + safeBottom + 24,
    };
}
