import { BootFlow, BootFlowError, BootState } from '../assets/boot/BootFlow.ts';
import type { BootDependencies } from '../assets/boot/BootFlow.ts';

function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

function assertTrue(value: boolean, message: string): void {
    if (!value) {
        throw new Error(message);
    }
}

function createDependencies(overrides: Partial<BootDependencies> = {}): BootDependencies {
    return {
        initialize: async () => undefined,
        loadCode: async () => undefined,
        checkManifest: async () => ({ downloadRequired: false, cacheHit: true }),
        download: async (onProgress) => onProgress(1),
        startBusiness: async () => undefined,
        ...overrides,
    };
}

async function verifiesDownloadedBoot(): Promise<void> {
    const visited: BootState[] = [];
    const flow = new BootFlow(createDependencies({
        checkManifest: async () => ({ downloadRequired: true, cacheHit: false }),
        download: async (onProgress) => {
            onProgress(-1);
            onProgress(0.5);
            onProgress(2);
        },
    }));
    flow.subscribe((snapshot) => visited.push(snapshot.state));

    const snapshot = await flow.runToReady();

    assertEqual(snapshot.state, BootState.Ready, 'downloaded boot state');
    assertEqual(snapshot.progress, 1, 'downloaded boot progress');
    assertEqual(snapshot.cacheHit, false, 'downloaded boot cache flag');
    assertTrue(visited.includes(BootState.Downloading), 'download state was not visited');
}

async function verifiesCacheHitAndSingleFlight(): Promise<void> {
    let initializeCount = 0;
    let downloadCount = 0;
    const flow = new BootFlow(createDependencies({
        initialize: async () => {
            initializeCount += 1;
            await Promise.resolve();
        },
        download: async () => {
            downloadCount += 1;
        },
    }));

    const first = flow.runToReady();
    const second = flow.runToReady();
    assertEqual(first, second, 'concurrent runs must share one promise');
    await first;

    assertEqual(initializeCount, 1, 'initialize count');
    assertEqual(downloadCount, 0, 'cache hit must skip download');
    assertEqual(flow.snapshot.cacheHit, true, 'cache hit flag');
}

async function verifiesFailureAndRetry(): Promise<void> {
    let shouldFail = true;
    const flow = new BootFlow(createDependencies({
        checkManifest: async () => ({ downloadRequired: true, cacheHit: false }),
        download: async () => {
            if (shouldFail) {
                throw new BootFlowError(BootState.IntegrityError, 'MD5_MISMATCH', 'bad checksum');
            }
        },
    }));

    await flow.runToReady();
    assertEqual(flow.snapshot.state, BootState.IntegrityError, 'integrity failure state');
    assertEqual(flow.snapshot.errorCode, 'MD5_MISMATCH', 'integrity failure code');

    shouldFail = false;
    await flow.runToReady();
    assertEqual(flow.snapshot.state, BootState.Ready, 'retry state');
    assertEqual(flow.snapshot.errorCode, undefined, 'retry clears failure code');
}

async function verifiesDynamicRuntimeBoundary(): Promise<void> {
    let started = false;
    const flow = new BootFlow(createDependencies({
        startBusiness: async () => {
            started = true;
        },
    }));

    await flow.runToReady();
    await flow.startBusiness();

    assertEqual(started, true, 'runtime entry start');
    assertEqual(flow.snapshot.state, BootState.Started, 'runtime entry state');
}

async function main(): Promise<void> {
    await verifiesDownloadedBoot();
    await verifiesCacheHitAndSingleFlight();
    await verifiesFailureAndRetry();
    await verifiesDynamicRuntimeBoundary();
    console.log('P10 BootFlow smoke: PASS');
}

void main();
