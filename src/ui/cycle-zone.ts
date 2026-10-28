import type { ZoneId } from './zones.ts';

/** The zone `step` places after `current` in `order`, wrapping around; `current` if it isn't listed. */
export function cycleZone(order: readonly ZoneId[], current: ZoneId, step: 1 | -1): ZoneId {
  const index = order.indexOf(current);
  const next = index === -1 ? 0 : (index + step + order.length) % order.length;
  return order[next] ?? current;
}
