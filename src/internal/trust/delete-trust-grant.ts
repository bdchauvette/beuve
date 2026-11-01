import type { DatabaseSync } from 'node:sqlite';

/** What to revoke: a scope kind and its key (a repository's real path). */
export interface TrustGrantKey {
  readonly kind: string;
  readonly key: string;
}

/** Removes the grant stored under `kind` and `key`; answers how many it removed (0 or 1). */
export function deleteTrustGrant(db: DatabaseSync, { kind, key }: TrustGrantKey): number {
  const { changes } = db
    .prepare('DELETE FROM trust_grants WHERE kind = ? AND scope_key = ?;')
    .run(kind, key);
  return Number(changes);
}
