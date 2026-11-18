import type { GithubReviewPreviewView } from '#contract/ipc-contract.ts';

/**
 * Where posting the dock's review to GitHub stands (ADR 0039): ready, posting, offering COMMENT
 * after GitHub refused an approval on the reviewer's own pull request, posted (with the review's
 * URL), failed, or voided because the head moved since the reviewer opened it (ADR 0078).
 */
export type GithubPostState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly text: string }
  | { readonly kind: 'own-pull-request'; readonly message: string }
  | { readonly kind: 'posted'; readonly url: string; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'head-moved' };

/**
 * What posting would send, which the dock shows beside the Post button (ADR 0039 amendment
 * 2026-11-18): not asked yet, being compiled (with the last answer, kept on screen meanwhile),
 * compiled, or failed.
 */
export type GithubPreviewState =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading'; readonly last: GithubReviewPreviewView | undefined }
  | { readonly kind: 'ready'; readonly preview: GithubReviewPreviewView }
  | { readonly kind: 'failed'; readonly text: string };

/** What the dock needs to offer posting for a pull request session. */
export interface GithubDockState {
  /** `owner/repo#n`. */
  readonly target: string;
  readonly isSignedIn: boolean;
  /** Shown instead of the button when not signed in, e.g. "run gh auth login". */
  readonly signInHint: string;
  readonly post: GithubPostState;
  readonly preview: GithubPreviewState;
}
