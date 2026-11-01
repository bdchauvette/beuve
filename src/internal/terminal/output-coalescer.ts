/** Where a coalescer sends the text it collected. */
export type OutputFlush = (text: string) => void;

/** When a coalescer flushes: after `delay`, or at once once `limit` characters are waiting. */
export interface OutputCoalescerOptions {
  readonly delay: Temporal.Duration;
  readonly limit: number;
  readonly flush: OutputFlush;
}

/**
 * Collects small writes and passes them on together: a terminal's output arrives in many tiny
 * pieces, and one IPC message per piece would drown the renderer. Flushes after `delay` from the
 * first waiting write, or at once past `limit` characters. Dispose to flush and stop.
 */
export class OutputCoalescer implements Disposable {
  readonly #options: OutputCoalescerOptions;
  #pending = '';
  #timer: NodeJS.Timeout | undefined;

  constructor(options: OutputCoalescerOptions) {
    this.#options = options;
  }

  #delayMilliseconds(): number {
    return this.#options.delay
      .round({ smallestUnit: 'millisecond', roundingMode: 'ceil' })
      .total('milliseconds');
  }

  write(text: string): void {
    this.#pending += text;
    if (this.#pending.length >= this.#options.limit) {
      this.flush();
      return;
    }
    this.#timer ??= setTimeout(() => {
      this.flush();
    }, this.#delayMilliseconds());
  }

  /** Passes on what is waiting, if anything. */
  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#pending === '') {
      return;
    }
    const text = this.#pending;
    this.#pending = '';
    this.#options.flush(text);
  }

  [Symbol.dispose](): void {
    this.flush();
  }
}
