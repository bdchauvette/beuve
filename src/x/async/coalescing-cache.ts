import { untilAborted } from './until-aborted.ts';

export interface CoalescingCacheOptions<V> {
  /** Most settled values kept; the least recently used goes first. */
  readonly maxEntries: number;
  /**
   * Most total weight kept, with `weigh`. A value heavier than this on its own is returned but
   * not kept. Defaults to no bound.
   */
  readonly maxWeight?: number;
  /** A value's weight, such as its approximate size in bytes. Defaults to 1. */
  readonly weigh?: (value: V) => number;
  /** Whether a settled value is kept, e.g. only successes. Defaults to every value. */
  readonly keep?: (value: V) => boolean;
}

export interface CoalescingGetOptions {
  /**
   * Stops this caller waiting: `get` answers `'aborted'`. The computation goes on while another
   * caller still waits for it, and is aborted only when the last one gives up.
   */
  readonly signal?: AbortSignal | undefined;
}

/** A computation in flight, and the callers waiting for it. */
interface Flight<V> {
  readonly promise: Promise<V>;
  readonly controller: AbortController;
  waiters: number;
  /** A caller without a signal waits for good, so the computation is never aborted. */
  isAnchored: boolean;
}

/**
 * A bounded memo of asynchronous computations by key. Concurrent misses on one key share a single
 * computation, which gets its own signal: a caller that gives up stops waiting at once, and the
 * computation is aborted (and not kept) only when no caller is left waiting for it. A caller
 * without a signal always counts. Settled values are kept least recently used first, bounded by
 * count and by total weight. The computation should not reject; if it does, its waiters reject
 * and nothing is kept.
 */
export class CoalescingCache<K, V> {
  readonly #maxEntries: number;
  readonly #maxWeight: number;
  readonly #weigh: (value: V) => number;
  readonly #keep: (value: V) => boolean;
  readonly #settled = new Map<K, { readonly value: V; readonly weight: number }>();
  readonly #flights = new Map<K, Flight<V>>();
  #weight = 0;

  constructor(options: CoalescingCacheOptions<V>) {
    const { maxEntries, maxWeight = Infinity } = options;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError(
        `CoalescingCache maxEntries must be a non-negative integer, got ${String(maxEntries)}.`,
      );
    }
    if (Number.isNaN(maxWeight) || maxWeight < 0) {
      throw new RangeError(
        `CoalescingCache maxWeight must be non-negative, got ${String(maxWeight)}.`,
      );
    }
    this.#maxEntries = maxEntries;
    this.#maxWeight = maxWeight;
    this.#weigh = options.weigh ?? ((): number => 1);
    this.#keep = options.keep ?? ((): boolean => true);
  }

  #start(key: K, compute: (signal: AbortSignal) => Promise<V>): Flight<V> {
    const controller = new AbortController();
    const promise = (async (): Promise<V> => compute(controller.signal))();
    const flight: Flight<V> = { promise, controller, waiters: 0, isAnchored: false };
    this.#flights.set(key, flight);
    void this.#settle(key, flight);
    return flight;
  }

  /** Keeps the flight's value once it settles, unless it was aborted, dropped or refused. */
  async #settle(key: K, flight: Flight<V>): Promise<void> {
    let value: V;
    try {
      value = await flight.promise;
    } catch {
      // Its waiters get the rejection; nothing is kept.
      this.#land(key, flight);
      return;
    }
    if (this.#land(key, flight) && !flight.controller.signal.aborted && this.#keep(value)) {
      this.#store(key, value);
    }
  }

  /** Ends `flight`; whether it was still the key's current one (not deleted or abandoned). */
  #land(key: K, flight: Flight<V>): boolean {
    if (this.#flights.get(key) !== flight) {
      return false;
    }
    this.#flights.delete(key);
    return true;
  }

  async #wait(key: K, flight: Flight<V>, signal: AbortSignal | undefined): Promise<V | 'aborted'> {
    if (signal === undefined) {
      flight.isAnchored = true;
      return flight.promise;
    }
    flight.waiters += 1;
    let outcome: V | 'aborted';
    try {
      outcome = await untilAborted(flight.promise, signal);
    } finally {
      flight.waiters -= 1;
    }
    if (outcome === 'aborted' && flight.waiters === 0 && !flight.isAnchored) {
      this.#land(key, flight);
      flight.controller.abort();
    }
    return outcome;
  }

  #store(key: K, value: V): void {
    const weight = this.#weigh(value);
    this.#forget(key);
    if (this.#maxEntries === 0 || weight > this.#maxWeight) {
      return;
    }
    this.#settled.set(key, { value, weight });
    this.#weight += weight;
    for (const oldest of this.#settled.keys()) {
      if (this.#settled.size <= this.#maxEntries && this.#weight <= this.#maxWeight) {
        break;
      }
      this.#forget(oldest);
    }
  }

  #forget(key: K): void {
    const kept = this.#settled.get(key);
    if (kept === undefined) {
      return;
    }
    this.#settled.delete(key);
    this.#weight -= kept.weight;
  }

  /** Settled values kept now. */
  get size(): number {
    return this.#settled.size;
  }

  /** Total weight of the settled values kept now. */
  get weight(): number {
    return this.#weight;
  }

  /**
   * The value for `key`: kept, joined from a computation in flight, or computed by `compute` with
   * a signal that aborts once every caller has given up. `'aborted'` when `options.signal` aborts
   * first (at once if it already has, and then nothing starts).
   */
  async get(
    key: K,
    compute: (signal: AbortSignal) => Promise<V>,
    options: CoalescingGetOptions = {},
  ): Promise<V | 'aborted'> {
    const { signal } = options;
    if (signal?.aborted === true) {
      return 'aborted';
    }
    const kept = this.#settled.get(key);
    if (kept !== undefined) {
      this.#settled.delete(key);
      this.#settled.set(key, kept);
      return kept.value;
    }
    const flight = this.#flights.get(key) ?? this.#start(key, compute);
    return this.#wait(key, flight, signal);
  }

  /** Forgets `key`'s settled value; a computation in flight goes on but is not kept. */
  delete(key: K): void {
    this.#forget(key);
    this.#flights.delete(key);
  }

  /** Forgets every settled value; computations in flight go on but are not kept. */
  clear(): void {
    this.#settled.clear();
    this.#weight = 0;
    this.#flights.clear();
  }
}
