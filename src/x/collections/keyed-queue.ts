/**
 * First-in, first-out queues of jobs, one per key, each running one job at a time: `enqueue`
 * starts a job at once when its key is idle, otherwise it waits behind the others. At most
 * `maxWaiting` jobs wait per key. The runner reports its own failures: a rejection is swallowed
 * here, and the next job starts either way.
 */
export class KeyedQueue<K, J> {
  readonly #run: (job: J) => Promise<void>;
  readonly #maxWaiting: number;
  readonly #queues = new Map<K, { running: J | undefined; done: Promise<void>; waiting: J[] }>();

  constructor(run: (job: J) => Promise<void>, maxWaiting: number) {
    if (!Number.isSafeInteger(maxWaiting) || maxWaiting < 0) {
      throw new RangeError(
        `KeyedQueue maxWaiting must be a non-negative integer, got ${String(maxWaiting)}.`,
      );
    }
    this.#run = run;
    this.#maxWaiting = maxWaiting;
  }

  #pump(key: K): void {
    const queue = this.#queues.get(key);
    if (queue === undefined || queue.running !== undefined) {
      return;
    }
    const next = queue.waiting.shift();
    if (next === undefined) {
      this.#queues.delete(key);
      return;
    }
    queue.running = next;
    queue.done = (async (): Promise<void> => {
      try {
        await this.#run(next);
      } catch {
        // The runner reports its own failures.
      } finally {
        queue.running = undefined;
        this.#pump(key);
      }
    })();
  }

  /** Whether a job of `key` is running, so a new one would wait. */
  isBusy(key: K): boolean {
    return this.#queues.get(key)?.running !== undefined;
  }

  /** Whether a new job of `key` would exceed `maxWaiting`. */
  isFull(key: K): boolean {
    const queue = this.#queues.get(key);
    return queue?.running !== undefined && queue.waiting.length >= this.#maxWaiting;
  }

  /** Runs `job` now if `key` is idle, else queues it; `false` (and nothing queued) when full. */
  enqueue(key: K, job: J): boolean {
    if (this.isFull(key)) {
      return false;
    }
    const queue = this.#queues.getOrInsertComputed(key, () => {
      return {
        running: undefined,
        done: Promise.resolve(),
        waiting: [],
      };
    });
    queue.waiting.push(job);
    this.#pump(key);
    return true;
  }

  running(key: K): J | undefined {
    return this.#queues.get(key)?.running;
  }

  /** The jobs of `key` waiting to run, oldest first. */
  waiting(key: K): readonly J[] {
    return this.#queues.get(key)?.waiting ?? [];
  }

  /** Every running and waiting job, of every key. */
  all(): J[] {
    const jobs: J[] = [];
    for (const queue of this.#queues.values()) {
      if (queue.running !== undefined) {
        jobs.push(queue.running);
      }
      jobs.push(...queue.waiting);
    }
    return jobs;
  }

  /** Takes the waiting jobs of `key` that `isPicked` picks out of the queue and returns them. */
  remove(key: K, isPicked: (job: J) => boolean): J[] {
    const queue = this.#queues.get(key);
    if (queue === undefined) {
      return [];
    }
    const removed = queue.waiting.filter((job) => isPicked(job));
    queue.waiting = queue.waiting.filter((job) => !isPicked(job));
    return removed;
  }

  /** Settles once every job running now has finished (the ones waiting are not awaited). */
  async idle(): Promise<void> {
    await Promise.all(Array.from(this.#queues.values(), async (queue) => queue.done));
  }
}
