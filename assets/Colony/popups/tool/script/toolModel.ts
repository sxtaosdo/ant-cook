import mk from 'mk';
import type { ProgressPage } from '../../progress/script/progressModel';

/** A short, purpose-built projection for a single tool confirmation. */
export class ToolModel extends mk.MVCModelBase {
  public page: ProgressPage = { title: '', summary: '', rows: [] };
  public feedback = '';
}
