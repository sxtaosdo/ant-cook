export interface ToastMessage { type: string; object: string; text: string }

/** One active message plus three waiting messages, owned by one page lifetime. */
export class ToastQueue {
  private current: ToastMessage | null = null;
  private waiting: ToastMessage[] = [];
  private revision = 0;
  constructor(private readonly start: (message: ToastMessage, complete: () => void) => void,
    private readonly cancel: () => void) {}
  public show(message: ToastMessage): void {
    if (!message.text.trim()) return;
    const key = (item: ToastMessage): string => JSON.stringify([item.type, item.object, item.text]);
    if ([...(this.current ? [this.current] : []), ...this.waiting].some(item => key(item) === key(message))) return;
    if (this.current) {
      if (this.waiting.length === 3) this.waiting.shift();
      this.waiting.push({ ...message });
    } else this.begin({ ...message });
  }
  public clear(): void {
    ++this.revision; this.current = null; this.waiting = []; this.cancel();
  }
  private begin(message: ToastMessage): void {
    this.current = message;
    const revision = ++this.revision;
    this.start(message, () => {
      if (revision !== this.revision || this.current !== message) return;
      this.current = null;
      const next = this.waiting.shift();
      if (next) this.begin(next);
    });
  }
}
