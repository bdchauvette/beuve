import { randomUUID } from 'node:crypto';

import type { UraDeps } from './ura-item.ts';

/** The real clock and `crypto.randomUUID()`. */
export const systemUraDeps: UraDeps = {
  now: (): Date => new Date(),
  newId: (): string => randomUUID(),
};
