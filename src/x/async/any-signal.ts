/**
 * `AbortSignal.any` over the signals that are present: `undefined` for none and the signal itself
 * for one, so a caller that may or may not have each signal needs no branches.
 */
export function anySignal(
  ...signals: readonly (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const present = [...new Set(signals.filter((signal) => signal !== undefined))];
  if (present.length <= 1) {
    return present[0];
  }
  return AbortSignal.any(present);
}
