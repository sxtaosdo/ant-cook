import assert from 'node:assert/strict';
import test from 'node:test';
import { ShellPromotion, PROMOTION_DECLINE_MS } from '../../assets/shell/promotion';
import { PlayerProgress, PROGRESS_SAVE_KEY, PROGRESS_CALENDAR_START } from '../../assets/Colony/scripts/application/playerProgress';
import { leaderboardTestConfig, socialTestConfig } from '../ant/support/leaderboardTestConfig';

function store() {
  const values = new Map<string,string>(), accesses: string[] = []; let fail = false;
  return { values, accesses, fail: (v:boolean) => fail=v,
    getItem(key:string) { accesses.push(key); return values.get(key) ?? null; },
    setItem(key:string,value:string) { accesses.push(key); if(fail) throw Error('quota'); values.set(key,value); },
    removeItem(key:string) { values.delete(key); } };
}
test('decline persists seven days for its source only, with exact expiry and per-session deduplication',()=>{
  const s=store();let now=1000;const p=new ShellPromotion(s,()=>now);
  assert.equal(p.canOffer('ant'),true);p.markShown('ant');assert.equal(p.canOffer('ant'),false);assert.equal(p.canOffer('cook'),true);
  p.decline('ant');let restored=new ShellPromotion(s,()=>now);assert.equal(restored.canOffer('ant'),false);assert.equal(restored.canOffer('cook'),true);
  now+=PROMOTION_DECLINE_MS-1;assert.equal(restored.canOffer('ant'),false);now++;assert.equal(restored.canOffer('ant'),true);
  restored.decline('cook');restored=new ShellPromotion(s,()=>now);assert.equal(restored.canOffer('ant'),true);assert.equal(restored.canOffer('cook'),false);
  assert.ok(s.accesses.every(k=>k==='p4000.ant-cook.dev1.shell.promotion'));
});
test('failed decline publishes nothing; the same displayed owner can retry without touching gameplay',()=>{
  const s=store(),p=new ShellPromotion(s,()=>1000);p.markShown('ant');s.fail(true);
  assert.throws(()=>p.decline('ant'),/quota/);assert.equal(s.values.size,0);assert.equal(new ShellPromotion(s,()=>1000).canOffer('ant'),true);
  s.fail(false);p.decline('ant');assert.equal(new ShellPromotion(s,()=>1000).canOffer('ant'),false);
});
test('corrupt recommendation metadata is preserved and disables automatic offers',()=>{
  const s=store(),key='p4000.ant-cook.dev1.shell.promotion';s.values.set(key,'{broken');const p=new ShellPromotion(s,()=>1000);
  assert.equal(p.canOffer('ant'),false);assert.equal(p.canOffer('cook'),false);assert.throws(()=>p.decline('ant'),/未保存/);assert.equal(s.values.get(key),'{broken');
});
test('committed Ant threshold is 18 first clears; failed save and day rollover never change the pure qualification',()=>{
  const values=new Map<string,string>();let fail=false,writes=0,now=PROGRESS_CALENDAR_START;
  const p=new PlayerProgress({read:key=>values.get(key)??null,write:(key,value)=>{writes++;if(fail&&key===PROGRESS_SAVE_KEY)throw Error('disk');values.set(key,value);}}, {now:()=>now},leaderboardTestConfig,socialTestConfig);
  for(let l=1;l<=17;l++)p.settleRound(p.startRound(l).id,'SUCCESS',1);
  assert.equal(p.promotionMilestoneReached(),false);const round=p.startRound(18);fail=true;assert.throws(()=>p.settleRound(round.id,'SUCCESS',1),/disk/);assert.equal(p.promotionMilestoneReached(),false);
  fail=false;p.settleRound(round.id,'SUCCESS',1);assert.equal(p.promotionMilestoneReached(),true);
  const before=writes;now+=86400000;for(let i=0;i<10;i++)assert.equal(p.promotionMilestoneReached(),true);assert.equal(writes,before);
});
