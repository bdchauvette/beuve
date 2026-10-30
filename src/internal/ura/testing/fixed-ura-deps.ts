import type { UraDeps } from '../ura-item.ts';

/** Deterministic deps: each id is a UUID ending in a counter (`…-000000000001`, `…-000000000002`, …). */
export function fixedUraDeps(): UraDeps {
  let ids = 0;
  return {
    newId: (): string => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
    },
  };
}
