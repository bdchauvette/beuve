import { randomUUID } from 'node:crypto';

import type { SessionDeps } from './session.ts';

/** The real clock and `crypto.randomUUID()`. */
export const systemSessionDeps: SessionDeps = {
  now: (): Date => new Date(),
  newId: (): string => randomUUID(),
};
