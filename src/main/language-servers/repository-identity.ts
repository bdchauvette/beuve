/** What identifies the repository a session reviews, for the config's overrides to match (ADR 0111). */
export interface RepositoryIdentity {
  /** The reviewer's clone, absolute: what an override's `path` glob is tried against. */
  readonly clonePath: string;
  /** `host/owner/repo`, lowercase, for a pull request session: what a `remote` pattern is tried against. */
  readonly remote?: string;
}
