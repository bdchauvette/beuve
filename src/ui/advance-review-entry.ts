import type { ReviewProgressView } from '#contract/ipc-contract.ts';

import type { ReviewChatEntry } from './chat-entry.ts';

/**
 * Folds one `review:progress` event into the transcript entry following that run. Events for
 * other runs, and anything after the run finished, leave the entry as it is.
 */
export function advanceReviewEntry(
  entry: ReviewChatEntry,
  event: ReviewProgressView,
): ReviewChatEntry {
  if (entry.runId !== event.runId || entry.status === 'completed' || entry.status === 'failed') {
    return entry;
  }
  switch (event.kind) {
    case 'started': {
      return { ...entry, status: 'running' };
    }
    case 'progress': {
      return { ...entry, status: 'running', progress: event.message };
    }
    case 'completed': {
      return { ...entry, status: 'completed', summary: event.summary };
    }
    case 'failed': {
      return { ...entry, status: 'failed', error: event.error };
    }
  }
}
