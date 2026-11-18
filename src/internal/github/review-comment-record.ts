/** What `GET …/pulls/{n}/comments` says about one comment, with absent fields as `undefined`. */
export interface ReviewCommentRecord {
  readonly id: number;
  /** The id of the comment this one replies to. */
  readonly replyTo: number | undefined;
  readonly path: string;
  /** `LEFT` for the base side of the diff, `RIGHT` for the head side. */
  readonly side: 'LEFT' | 'RIGHT';
  /** The comment is on the whole file, not on lines. */
  readonly isFileLevel: boolean;
  /** The lines at `commitId`; absent when the comment is outdated. */
  readonly line: number | undefined;
  readonly startLine: number | undefined;
  readonly commitId: string;
  /** The lines where it was first written, at `originalCommitId`. */
  readonly originalLine: number | undefined;
  readonly originalStartLine: number | undefined;
  readonly originalCommitId: string;
  readonly author: string;
  readonly body: string;
  readonly at: string;
  readonly url: string;
}
