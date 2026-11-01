/** How many installs may run at once: per repository, and in all. */
export interface InstallSlotLimits {
  readonly perRepository: number;
  readonly overall: number;
}

/** Someone waiting for a slot, and how to wake them. */
interface Waiter {
  readonly repository: string;
  readonly grant: (slot: Disposable) => void;
}

/**
 * A first-come queue of install slots (ADR 0089): at most `perRepository` installs of one
 * repository (they contend for its caches) and `overall` in all. `acquire` resolves with a slot
 * to release with `using`, or `aborted` when the signal aborts first, which leaves the queue.
 */
export class InstallSlots {
  readonly #limits: InstallSlotLimits;
  readonly #running = new Map<string, number>();
  #total = 0;
  readonly #waiting: Waiter[] = [];

  constructor(limits: InstallSlotLimits) {
    this.#limits = limits;
  }

  #admit(): void {
    for (let index = 0; index < this.#waiting.length;) {
      const waiter = this.#waiting[index];
      if (waiter === undefined || this.#total >= this.#limits.overall) {
        return;
      }
      const running = this.#running.get(waiter.repository) ?? 0;
      if (running >= this.#limits.perRepository) {
        index += 1;
        continue;
      }
      this.#waiting.splice(index, 1);
      this.#running.set(waiter.repository, running + 1);
      this.#total += 1;
      waiter.grant(this.#slotFor(waiter.repository));
    }
  }

  #slotFor(repository: string): Disposable {
    let isReleased = false;
    return {
      [Symbol.dispose]: (): void => {
        if (isReleased) {
          return;
        }
        isReleased = true;
        this.#total -= 1;
        this.#running.set(repository, (this.#running.get(repository) ?? 1) - 1);
        this.#admit();
      },
    };
  }

  async acquire(repository: string, signal: AbortSignal): Promise<Disposable | 'aborted'> {
    if (signal.aborted) {
      return 'aborted';
    }
    const { promise, resolve } = Promise.withResolvers<Disposable | 'aborted'>();
    const waiter: Waiter = { repository, grant: resolve };
    this.#waiting.push(waiter);
    const onAbort = (): void => {
      const index = this.#waiting.indexOf(waiter);
      if (index === -1) {
        return;
      }

      this.#waiting.splice(index, 1);
      resolve('aborted');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    this.#admit();
    const outcome = await promise;
    signal.removeEventListener('abort', onAbort);
    return outcome;
  }
}
