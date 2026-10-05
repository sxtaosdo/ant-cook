import { Rect, Size, SpriteFrame } from 'cc';

/** One source image is partitioned at integer pixel boundaries, with no UV scaling drift. */
export class PuzzleFrames {
  private readonly pieces = new Map<number, SpriteFrame>();
  private readonly width: number;
  private readonly height: number;
  public dispose(): void { for (const frame of this.pieces.values()) frame.destroy(); this.pieces.clear(); }

  public constructor(
    private readonly source: SpriteFrame,
    private readonly rows: number,
    private readonly columns: number,
  ) {
    if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) {
      throw new Error('Puzzle grid dimensions must be positive integers');
    }
    const texture = source.texture;
    const rect = source.rect;
    if (!texture || source.rotated || source.original || source.atlasUuid
      || rect.x !== 0 || rect.y !== 0 || rect.width !== texture.width || rect.height !== texture.height
      || source.originalSize.width !== rect.width || source.originalSize.height !== rect.height
      || source.offset.x !== 0 || source.offset.y !== 0) {
      throw new Error(`Puzzle image ${source.name} has unsupported texture layout: ${texture?.width}x${texture?.height}, original ${source.originalSize.width}x${source.originalSize.height}, rect ${rect.x},${rect.y},${rect.width},${rect.height}, rotated ${source.rotated}, atlas ${source.atlasUuid}`);
    }
    this.width = rect.width;
    this.height = rect.height;
    if (this.width < columns || this.height < rows) throw new Error('Puzzle image has fewer pixels than grid cells');
    // A source frame packed after slices are created would invalidate their texture coordinates.
    source.packable = false;
  }

  public piece(row: number, column: number): SpriteFrame {
    if (!Number.isInteger(row) || row < 0 || row >= this.rows
      || !Number.isInteger(column) || column < 0 || column >= this.columns) {
      throw new Error(`Puzzle cell ${row}:${column} is outside ${this.rows}x${this.columns}`);
    }
    const key = row * this.columns + column;
    const existing = this.pieces.get(key);
    if (existing) return existing;
    const x0 = Math.floor(column * this.width / this.columns);
    const x1 = Math.floor((column + 1) * this.width / this.columns);
    const y0 = Math.floor(row * this.height / this.rows);
    const y1 = Math.floor((row + 1) * this.height / this.rows);
    const frame = new SpriteFrame(`puzzle-${this.source.name}-${row}-${column}`);
    frame.texture = this.source.texture;
    frame.rect = new Rect(x0, y0, x1 - x0, y1 - y0);
    frame.originalSize = new Size(x1 - x0, y1 - y0);
    frame.packable = false;
    this.pieces.set(key, frame);
    return frame;
  }
}
