/**
 * `duration` repeated `times` times: a whole-number multiple, as `Temporal.Duration` has no
 * multiply. `times` must be a non-negative integer, and `duration` must have no calendar units.
 */
export function multiplyDuration(duration: Temporal.Duration, times: number): Temporal.Duration {
  if (!Number.isSafeInteger(times) || times < 0) {
    throw new RangeError(`times must be a non-negative integer, got ${String(times)}`);
  }
  let total = new Temporal.Duration();
  for (let count = 0; count < times; count += 1) {
    total = total.add(duration);
  }
  return total;
}
