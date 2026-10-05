import { IntentInputPort } from '../assets/bundles/game/presentation/IntentInputPort.ts';

type Intent = { readonly type: 'increment'; readonly payload: { readonly amount: number } };

const input = new IntentInputPort<Intent>();
let total = 0;
const unsubscribe = input.subscribe((intent) => {
    total += intent.payload.amount;
});

input.publish({ type: 'increment', payload: { amount: 2 } });
if (total !== 2) throw new Error(`intent was not delivered exactly once: ${total}`);

unsubscribe();
input.publish({ type: 'increment', payload: { amount: 4 } });
if (total !== 2) throw new Error(`unsubscribed intent listener still ran: ${total}`);

input.subscribe((intent) => {
    total += intent.payload.amount;
});
input.clear();
input.publish({ type: 'increment', payload: { amount: 8 } });
if (total !== 2) throw new Error(`cleared intent listener still ran: ${total}`);

console.log('P10 presentation input smoke: PASS');
