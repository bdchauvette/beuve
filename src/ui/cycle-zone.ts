import type { ZoneId } from './zones.ts';

/** The zone `step` places after `current` in `order`, wrapping around; `current` if it isn't listed. */
export function cycleZone(order: readonly ZoneId[], current: ZoneId, step: 1 | -1): ZoneId {
  const index = order.indexOf(current);
  if (index === -1) {
    return order[0] ?? current;
  }
  return order[(index + step + order.length) % order.length] ?? current;
}
