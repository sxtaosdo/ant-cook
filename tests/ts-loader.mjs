import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const modules = {
  'db://shidai3/index': new URL('../extensions/shidai3/assets/index.ts', import.meta.url).href,
  'db://shidai3/minigame/index': new URL('../extensions/shidai3/assets/minigame/index.ts', import.meta.url).href,
};
export async function resolve(specifier, context, nextResolve) {
  if (modules[specifier]) return { shortCircuit: true, url: modules[specifier] };
  if (specifier.startsWith('.') && context.parentURL) {
    for (const path of [specifier.replace(/\.js$/, '.ts'), specifier + '.ts', specifier + '/index.ts']) {
      const url = new URL(path, context.parentURL);
      if (existsSync(fileURLToPath(url)) && statSync(fileURLToPath(url)).isFile()) return { shortCircuit: true, url: url.href };
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false },
    }).outputText;
    return { shortCircuit: true, format: 'module', source };
  }
  return nextLoad(url, context);
}
