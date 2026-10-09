import type { PlayerProgressSnapshot } from './playerProgress';
export interface GuideProgress { status: 'pending' | 'done' | 'skipped'; segment: number }
export interface GuideTransportReceipt { roundId: string; transported: number }
export function isGuideProgress(value: unknown): value is GuideProgress {
  const g = value as GuideProgress | null;
  return Boolean(g && typeof g === 'object' && Number.isInteger(g.segment) && g.segment >= 0 &&
    (g.status === 'done' ? g.segment === 4 : ['pending', 'skipped'].includes(g.status) && g.segment < 4));
}
/** Accepted permanent facts, or the active main-round Model's completed transport. */
export function guideCanAdvance(s: PlayerProgressSnapshot, receipt?: GuideTransportReceipt): boolean {
  if (s.guide.status !== 'pending') return false;
  switch (s.guide.segment) {
    case 0: return s.clearedLevels.length > 0 || Boolean(receipt && Number.isSafeInteger(receipt.transported) && receipt.transported > 0 && s.rounds[receipt.roundId]?.mode === 'main' && !s.rounds[receipt.roundId]?.settled);
    case 1: return s.clearedLevels.length > 0;
    case 2: return s.trackedObjectId !== null;
    case 3: return (s.partnerDialogue?.step ?? 0) >= 3 && s.trackedObjectId === s.partnerDialogue?.objectId;
    default: return false;
  }
}
