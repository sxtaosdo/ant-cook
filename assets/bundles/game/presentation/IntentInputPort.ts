import type { CocosInputPort } from 'db://shidai3/index';

/**
 * Presentation-owned intent stream. Buttons publish typed intents here while
 * P0002's CocosAdapter owns the single subscription and its cleanup.
 */
export class IntentInputPort<TIntent> implements CocosInputPort<TIntent> {
    private readonly handlers = new Set<(intent: TIntent) => void>();

    public subscribe(handler: (intent: TIntent) => void): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    public publish(intent: TIntent): void {
        for (const handler of this.handlers) {
            handler(intent);
        }
    }

    public clear(): void {
        this.handlers.clear();
    }
}
