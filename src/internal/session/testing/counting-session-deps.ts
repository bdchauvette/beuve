import type { SessionDeps } from '../session.ts';

/** Deps whose ids are UUIDs ending in a counter from `start`: `…-000000000001`, `…-000000000002`, … */
export function countingSessionDeps(start = 1): SessionDeps {
  let next = start;
  return {
    newId: (): string => {
      const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
      next += 1;
      return id;
    },
  };
}
