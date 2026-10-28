import type { UraVerdict } from './ura-artifact.ts';

/** Why a stored choice was dropped: it became impossible to honour. */
export type VerdictClearReason = 'blocker-staged';

/**
 * The verdict the reviewer picked for a session (ADR 0029). `chosen` is absent when they follow
 * the derived verdict; `cleared` says the last choice was dropped, until they choose again.
 */
export interface UraVerdictChoice {
  readonly chosen?: UraVerdict;
  readonly cleared?: VerdictClearReason;
}
