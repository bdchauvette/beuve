import { randomUUID } from 'node:crypto';

import type { SessionDeps } from './session.ts';

/** `crypto.randomUUID()`. Time is read from `Temporal.Now` directly (ADR 0059). */
export const systemSessionDeps: SessionDeps = {
  newId: (): string => randomUUID(),
};
