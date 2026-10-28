import type { UraDeps } from '../ura-item.ts';

/**
 * Deterministic deps: the clock starts at `start` and each id is a UUID ending in a counter
 * (`…-000000000001`, `…-000000000002`, …).
 */
export function fixedUraDeps(start = '2026-10-28T12:00:00.000Z'): UraDeps {
  let ids = 0;
  return {
    now: (): Date => new Date(start),
    newId: (): string => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
    },
  };
}
