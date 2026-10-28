/**
 * One inline comment of `POST /repos/{o}/{r}/pulls/{n}/reviews`. Declared here structurally
 * (ADR 0030): the ura domain's `buildGithubReview` output is assignable to it, and main's call
 * is what checks that.
 */
export interface ReviewComment {
  readonly path: string;
  readonly line: number;
  readonly side: 'RIGHT' | 'LEFT';
  readonly body: string;
  readonly start_line?: number;
  readonly start_side?: 'RIGHT' | 'LEFT';
}

/** The body of `POST /repos/{owner}/{repo}/pulls/{number}/reviews`. */
export interface ReviewPayload {
  /** The head the comments' line numbers refer to: the SHA the review was written against. */
  readonly commit_id: string;
  readonly event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  readonly body: string;
  readonly comments: readonly ReviewComment[];
}
