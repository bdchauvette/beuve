/**
 * What a trust grant covers (ADR 0090). One kind today: a repository, by the real path of its top
 * level and the remote URL it had when the reviewer trusted it. Later kinds (a branch, an author)
 * are new members of this union, stored in the same table under their own `kind` with no
 * migration, and matched by a new entry in `doesScopeCover`'s table.
 */
export type TrustScope = RepositoryTrustScope;

/** Every repository at this real path, while it keeps `remoteUrl` (when one was recorded). */
export interface RepositoryTrustScope {
  readonly kind: 'repository';
  readonly path: string;
  readonly remoteUrl?: string;
}

/** What a scope is matched against: the repository a session reviews. */
export interface TrustSubject {
  readonly repositoryPath: string;
  readonly remoteUrl: string | undefined;
}

/** A stored grant: what it covers and when the reviewer gave it (an ISO instant). */
export interface TrustGrant {
  readonly scope: TrustScope;
  readonly grantedAt: string;
}
