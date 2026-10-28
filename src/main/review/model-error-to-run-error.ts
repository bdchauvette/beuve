import type { ReviewRunErrorView } from '#contract/ipc-contract.ts';
import type { ModelError } from '#internal/llm/language-model.ts';

/** Why a run was aborted; the `AbortSignal` reason main passes. */
export type AbortReason = Extract<ReviewRunErrorView, { code: 'cancelled' }>['reason'];

/**
 * Maps the review model port's failure to what the chat transcript shows (ADR 0022): a typed code
 * and a message that says what to do. `abortReason` names why a `cancelled` run was stopped.
 */
export function modelErrorToRunError(
  error: ModelError,
  abortReason: AbortReason = 'app-quit',
): ReviewRunErrorView {
  switch (error.kind) {
    case 'not-installed': {
      return {
        code: 'not-installed',
        message: `Claude Code could not be started (${error.command} was not found). Install it, or set BEUVE_CLAUDE_PATH.`,
      };
    }
    case 'not-authenticated': {
      return {
        code: 'not-authenticated',
        message: 'Claude Code is not logged in. Run `claude` in a terminal and log in, then retry.',
      };
    }
    case 'rate-limited': {
      return {
        code: 'rate-limited',
        message: `Claude Code is rate-limited: ${error.message}`,
        ...(error.resetsAt !== undefined && { resetsAt: error.resetsAt }),
      };
    }
    case 'timeout': {
      const minutes = Math.round(error.timeoutMs / 60_000);
      return {
        code: 'timeout',
        message: `Claude Code did not finish within ${String(minutes)} minutes.`,
      };
    }
    case 'cancelled': {
      return cancelled(abortReason);
    }
    case 'invalid-request':
    case 'invalid-output': {
      return {
        code: 'model-failed',
        message: `Claude Code gave no usable answer: ${error.reason}`,
      };
    }
    case 'output-too-large': {
      return { code: 'model-failed', message: 'Claude Code printed more output than beuve reads.' };
    }
    case 'model-failed': {
      return {
        code: 'model-failed',
        message: `Claude Code failed (${error.reason}): ${error.message}`,
      };
    }
    case 'process-failed': {
      const status =
        error.exitCode === undefined ? (error.signal ?? 'unknown') : String(error.exitCode);
      const detail = error.stderr.trim().split('\n').at(-1) ?? '';
      return {
        code: 'model-failed',
        message: `Claude Code exited with ${status}${detail === '' ? '' : `: ${detail}`}`,
      };
    }
  }
}

function cancelled(reason: AbortReason): ReviewRunErrorView {
  const messages: Record<AbortReason, string> = {
    'head-changed': 'Stopped: the head moved. Run /review again for the new head.',
    superseded: 'Stopped: a fresh run replaced this one.',
    'app-quit': 'Stopped: beuve is quitting.',
  };
  return { code: 'cancelled', reason, message: messages[reason] };
}
