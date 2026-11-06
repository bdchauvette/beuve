/** How many calls may run at once. */
export interface ConcurrencyOptions {
  readonly limit: number;
}

/**
 * `map` over `items` with at most `limit` calls in flight, the results in the order of `items`
 * (like `Promise.all(items.map(map))`, throttled). A rejection rejects the whole, once the calls
 * already started have settled; no new call starts after it.
 */
export async function mapConcurrently<T, R>(
  items: readonly T[],
  options: ConcurrencyOptions,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  let failure: { readonly error: unknown } | undefined;
  const worker = async (): Promise<void> => {
    while (failure === undefined && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await map(items[index] as T, index);
      } catch (error: unknown) {
        failure ??= { error };
      }
    }
  };
  const workers = Math.max(1, Math.min(options.limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure !== undefined) {
    throw failure.error;
  }
  return results;
}
