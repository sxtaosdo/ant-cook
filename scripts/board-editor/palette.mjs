import { readFile } from 'node:fs/promises';
import ts from 'typescript';

/** Read existing declarations without executing the Cocos module or keeping a copied palette. */
export async function readPalette() {
  const root = new URL('../../', import.meta.url);
  const literal = async (path, name) => {
    const source = ts.createSourceFile(path, await readFile(new URL(path, root), 'utf8'), ts.ScriptTarget.Latest, true);
    let result;
    source.forEachChild(node => {
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
          result = declaration.initializer;
          while (result && ts.isAsExpression(result)) result = result.expression;
        }
      }
    });
    if (!result) throw new Error(`Missing palette declaration: ${name}`);
    return result;
  };
  const ids = await literal('assets/Colony/scripts/application/levelCatalog.ts', 'GAME_COLORS');
  const values = await literal('assets/Colony/scripts/presentation/colonyColors.ts', 'COLOR_HEX');
  if (!ts.isArrayLiteralExpression(ids) || !ts.isObjectLiteralExpression(values)) throw new Error('Unsupported palette declarations');
  const hex = new Map();
  for (const property of values.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !ts.isStringLiteral(property.initializer)) throw new Error('Invalid palette entry');
    hex.set(property.name.text, property.initializer.text);
  }
  const palette = ids.elements.map(id => {
    if (!ts.isStringLiteral(id)) throw new Error('Invalid color ID');
    return { id: id.text, hex: hex.get(id.text) };
  });
  if (palette.length !== 12 || hex.size !== 12 || new Set(palette.map(p => p.id)).size !== 12 || palette.some(p => !/^#[0-9A-Fa-f]{6}$/.test(p.hex ?? ''))) throw new Error('Invalid game palette');
  return palette;
}
