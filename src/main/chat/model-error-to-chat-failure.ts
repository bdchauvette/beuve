import type { ChatErrorCode } from '#contract/ipc-contract.ts';
import type { ModelError } from '#internal/llm/language-model.ts';

/** How an answer ended badly: stopped on purpose, or failed with a code the UI explains. */
export type ChatFailure =
  { readonly kind: 'cancelled' } | { readonly kind: 'failed'; readonly code: ChatErrorCode };

/** Maps the model port's failure to the chat's: a cancellation is not an error (ADR 0031). */
export function modelErrorToChatFailure(error: ModelError): ChatFailure {
  switch (error.kind) {
    case 'cancelled': {
      return { kind: 'cancelled' };
    }
    case 'not-installed':
    case 'not-authenticated':
    case 'rate-limited':
    case 'timeout': {
      return { kind: 'failed', code: error.kind };
    }
    case 'invalid-request':
    case 'invalid-output':
    case 'output-too-large':
    case 'model-failed':
    case 'process-failed': {
      return { kind: 'failed', code: 'model-failed' };
    }
  }
}
