import type { InterdiffFallbackView, ReviewScope } from '#contract/ipc-contract.ts';

/** A one-line label for what the diff stream shows, e.g. "Interdiff · rebased". */
export function describeReviewScope(scope: ReviewScope): string {
  switch (scope.kind) {
    case 'full': {
      return 'Full review';
    }
    case 'up-to-date': {
      return 'Up to date';
    }
    case 'interdiff': {
      const { outcome } = scope;
      switch (outcome.kind) {
        case 'exact': {
          return 'Interdiff · exact';
        }
        case 'rebased': {
          return 'Interdiff · rebased';
        }
        case 'fallback': {
          return `Full review · interdiff unavailable: ${fallbackReason(outcome.reason)}`;
        }
      }
    }
  }
}

function fallbackReason(reason: InterdiffFallbackView): string {
  switch (reason.kind) {
    case 'conflicts': {
      const count = reason.paths.length;
      return `the rebase conflicts in ${String(count)} ${count === 1 ? 'file' : 'files'}`;
    }
    case 'git-too-old': {
      return `needs git ${reason.required} (have ${reason.version})`;
    }
    case 'reviewed-commits-missing': {
      return 'the reviewed commits are gone';
    }
  }
}
