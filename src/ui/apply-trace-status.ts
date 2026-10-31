import type { TraceStatusView } from '#contract/ipc-contract.ts';

import type { TraceState } from './trace-state.ts';

/**
 * The portal's state after a `trace:status` event, or `current` unchanged when the event is for
 * another session, file or line than the one the portal shows (a stale probe). Pure.
 */
export function applyTraceStatus(
  current: TraceState | undefined,
  sessionId: string | undefined,
  event: TraceStatusView,
): TraceState | undefined {
  if (
    current === undefined ||
    sessionId !== event.sessionId ||
    current.path !== event.path ||
    current.line !== event.line
  ) {
    return current;
  }
  const { path, line } = event;
  switch (event.state) {
    case 'running': {
      return { path, line, status: 'loading', testFiles: event.testFiles };
    }
    case 'completed': {
      return { path, line, status: 'ready', result: event.result, note: undefined };
    }
    case 'failed': {
      if (event.failure === 'untrusted') {
        return {
          path,
          line,
          status: 'needs-trust',
          repositoryPath: event.repositoryPath ?? '',
        };
      }
      if (event.result === undefined) {
        return { path, line, status: 'error', failure: event.failure, message: event.message };
      }
      return { path, line, status: 'ready', result: event.result, note: event.message };
    }
  }
}
