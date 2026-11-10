import type { UraVerdict } from './ura-artifact.ts';

/** Why a stored choice was dropped: it became impossible to honour. */
export type VerdictClearReason = 'blocking-staged' | 'head-moved';

/**
 * The verdict the reviewer picked for a session (ADR 0029, 0045). `chosen` is absent when they
 * follow the derived verdict, and comes with the `headSha` it was chosen at, since a new commit
 * ends it; `cleared` says the last choice was dropped, until they choose again.
 */
export interface UraVerdictChoice {
  readonly chosen?: UraVerdict;
  readonly headSha?: string;
  readonly cleared?: VerdictClearReason;
}
