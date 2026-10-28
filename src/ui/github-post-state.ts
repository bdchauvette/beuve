import type { GithubReviewPreviewView } from '#contract/ipc-contract.ts';

/**
 * Where posting the dock's review to GitHub stands (ADR 0039): idle, waiting for main, asking
 * the reviewer to confirm what goes where, offering COMMENT after GitHub refused an approval on
 * the reviewer's own pull request, posted (with the review's URL), or failed.
 */
export type GithubPostState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly text: string }
  | { readonly kind: 'confirm'; readonly preview: GithubReviewPreviewView }
  | { readonly kind: 'own-pull-request'; readonly message: string }
  | { readonly kind: 'posted'; readonly url: string; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string };

/** What the dock needs to offer posting for a pull request session. */
export interface GithubDockState {
  /** `owner/repo#n`. */
  readonly target: string;
  readonly isSignedIn: boolean;
  /** Shown instead of the button when not signed in, e.g. "run gh auth login". */
  readonly signInHint: string;
  readonly post: GithubPostState;
}
