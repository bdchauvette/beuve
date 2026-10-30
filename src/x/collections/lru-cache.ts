/**
 * A bounded map that evicts the least recently used entry when full. `get` and `set` both
 * count as a use. O(1) operations, backed by `Map` insertion order.
 */
export class LruCache<K, V> {
  readonly #capacity: number;
  readonly #entries = new Map<K, V>();

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `LruCache capacity must be a positive integer, got ${String(capacity)}.`,
      );
    }
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    if (!this.#entries.has(key)) {
      return undefined;
    }
    const value = this.#entries.get(key) as V;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done !== true) {
        this.#entries.delete(oldest.value);
      }
    }
    return this;
  }

  /** Returns the entry for `key`, computing and storing `compute()` only when it is missing. */
  getOrInsertComputed(key: K, compute: () => V): V {
    if (this.#entries.has(key)) {
      return this.get(key) as V;
    }
    const value = compute();
    this.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  delete(key: K): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
