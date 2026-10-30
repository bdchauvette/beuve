import type { InvokeChannel } from './ipc-contract.ts';

/**
 * Invoke channels whose request changes or publishes state that belongs to one head, or whose
 * answer is cached per head (ADR 0078).
 * Each request carries a required `expectedHeadSha`: main refuses when the session's head is no
 * longer that one, and uses only that SHA for the whole operation. The contract test makes every
 * channel that takes a `sessionId` either appear here or say why it needs no head.
 */
export const perHeadInvokeChannels = Object.freeze([
  'session:mark-reviewed',
  'review:set-file-reviewed',
  'ura:set-verdict',
  'github:preview-review',
  'github:post-review',
  'lsp:call-hierarchy',
] as const satisfies readonly InvokeChannel[]);

export type PerHeadInvokeChannel = (typeof perHeadInvokeChannels)[number];
