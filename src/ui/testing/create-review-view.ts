import type { ReviewView } from '#contract/ipc-contract.ts';

/** Options of {@link createReviewView}. */
export interface ReviewViewOptions {
  readonly sessionId?: string;
  readonly headSha?: string;
  /** Paths of text files; `reviewed` marks them reviewed. */
  readonly files?: readonly string[];
  readonly reviewed?: readonly string[];
}

/** A review with only what the window's loaders read; the rest is not real. */
export function createReviewView(options: ReviewViewOptions = {}): ReviewView {
  const reviewed = new Set(options.reviewed);
  return {
    session: { id: options.sessionId ?? 's1' },
    headSha: options.headSha ?? 'a'.repeat(40),
    files: (options.files ?? ['src/a.ts']).map((path) => {
      return { path, status: 'modified', ...(reviewed.has(path) && { reviewed: 'yes' }) };
    }),
    reviewProgress: { reviewed: reviewed.size, total: options.files?.length ?? 1 },
  } as unknown as ReviewView;
}
