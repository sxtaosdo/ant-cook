import { Color } from 'cc';
import type { GameColor } from '../gameModel';

const COLOR_HEX: Readonly<Record<GameColor, string>> = {
  berry: '#F34F62',
  citrus: '#F4A522',
  leaf: '#78B94A',
  plum: '#9854C7',
  blue: '#467CCC',
  cocoa: '#80513A',
  gold: '#F2C84B',
  orange: '#FEAB59',
  yellow: '#FFDE5A',
  white: '#F6F6F9',
  cream: '#FFE1B4',
  charcoal: '#4A4853',
};

/** 将玩法颜色映射为 Creator Color。 */
export function colonyColor(color: GameColor): Color {
  return Color.fromHEX(new Color(), COLOR_HEX[color]);
}
