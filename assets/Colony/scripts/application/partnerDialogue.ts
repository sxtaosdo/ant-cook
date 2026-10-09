import { collectionObject } from './collectionObject';

export interface PartnerDialogue {
  partner: { id: string; name: string; avatar: number };
  objectId: string;
  step: 0 | 1 | 2 | 3 | 4;
}
export const PARTNER_DIALOGUE_LINES = [
  '我：这个收集物从哪里来？',
  '伙伴：首次通关指定关卡就能收集，来源写在对象详情里。',
  '伙伴：我们一起关注这个目标吧，一次只关注一个。',
  '伙伴：按自己的节奏收集，完成后再来看看。',
  '伙伴：目标已经集齐，成果保存在你的摊位里。',
] as const;
export function isPartnerDialogue(value: unknown, nextPartnerId: number, avatarCount: number): value is PartnerDialogue {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<PartnerDialogue>, p = v.partner;
  return !!p && typeof p.id === 'string' && /^bot-\d+$/.test(p.id) && Number.isSafeInteger(Number(p.id.slice(4))) && Number(p.id.slice(4)) < nextPartnerId
    && typeof p.name === 'string' && Array.from(p.name).length >= 1 && Array.from(p.name).length <= 12
    && Number.isSafeInteger(p.avatar) && p.avatar >= 0 && p.avatar < avatarCount
    && typeof v.objectId === 'string' && !!collectionObject(v.objectId)
    && typeof v.step === 'number' && Number.isInteger(v.step) && v.step >= 0 && v.step <= 4;
}
