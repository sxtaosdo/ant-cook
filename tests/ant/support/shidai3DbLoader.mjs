const publicModules = {
  "db://shidai3/index": new URL("../../extensions/shidai3/assets/index.ts", import.meta.url).href,
  "db://shidai3/minigame/index": new URL("../../extensions/shidai3/assets/minigame/index.ts", import.meta.url).href,
};

export function resolve(specifier, context, nextResolve) {
  const url = publicModules[specifier];
  return url ? { shortCircuit: true, url } : nextResolve(specifier, context);
}
