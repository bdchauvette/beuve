import type { ModelRole } from './ipc-contract.ts';

/** Every model role, in the order Settings lists them (ADR 0070). */
export const modelRoles = Object.freeze([
  'chat',
  'review',
  'verify',
  'summarize',
  'compact',
] as const satisfies readonly ModelRole[]);
