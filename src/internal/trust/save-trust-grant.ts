import type { DatabaseSync } from 'node:sqlite';

import type { TrustGrant } from './trust-scope.ts';
import { trustScopeKey } from './trust-scope-key.ts';

/** Stores `grant`, replacing any grant of the same scope kind and key. */
export function saveTrustGrant(db: DatabaseSync, grant: TrustGrant): void {
  db.prepare(
    `INSERT INTO trust_grants (kind, scope_key, scope, granted_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (kind, scope_key) DO UPDATE SET scope = excluded.scope, granted_at = excluded.granted_at;`,
  ).run(grant.scope.kind, trustScopeKey(grant.scope), JSON.stringify(grant.scope), grant.grantedAt);
}
