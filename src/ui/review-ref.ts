/** The open review, as far as a controller cares: its session and the head the reviewer sees. */
export interface ReviewRef {
  readonly sessionId: string;
  readonly headSha: string;
}
