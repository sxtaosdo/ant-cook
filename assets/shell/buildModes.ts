import type { ModuleDescriptor } from './contracts';

/** Replaced by the build-input tool; only descriptors for included modules are emitted. */
export const BUILD_MODES: readonly ModuleDescriptor[] = [
  { id: 'ant', bundleName: 'Colony', sceneName: 'ColonyGame' },
  { id: 'cook', bundleName: 'game', sceneName: 'Game' },
];
