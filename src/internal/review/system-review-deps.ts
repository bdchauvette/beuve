import { randomUUID } from 'node:crypto';

/** The real clock and `crypto.randomUUID()`, for {@link runPreliminaryReview}. */
export const systemReviewDeps = {
  clock: (): Date => new Date(),
  ids: (): string => randomUUID(),
} as const;
