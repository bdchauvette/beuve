/**
 * `AbortSignal.timeout` for a `Temporal.Duration`: aborts with a `TimeoutError` `DOMException`
 * once `duration` has passed. `AbortSignal.timeout` throws on a fractional or negative number, so
 * the duration is rounded up to whole milliseconds and a negative one aborts at once. Like
 * `AbortSignal.timeout`, its timer does not keep the process alive and needs no clearing.
 * Combine it with a caller's signal through `AbortSignal.any`, and tell a timeout from a
 * cancellation by comparing the combined signal's `reason` with this signal's (ADR 0076).
 */
export function timeoutSignal(duration: Temporal.Duration): AbortSignal {
  return AbortSignal.timeout(
    duration.sign < 0
      ? 0
      : duration
          .round({ smallestUnit: 'milliseconds', roundingMode: 'ceil' })
          .total('milliseconds'),
  );
}
