import type { DatabaseSync } from 'node:sqlite';

import { parseTrustScope } from './parse-trust-scope.ts';
import type { TrustGrant } from './trust-scope.ts';

/**
 * Every stored grant this version understands, ordered by kind and key. Rows of an unknown kind or
 * with a malformed scope are left out, so they never match (ADR 0090).
 */
export function listTrustGrants(db: DatabaseSync): readonly TrustGrant[] {
  const rows = db
    .prepare('SELECT scope, granted_at FROM trust_grants ORDER BY kind, scope_key;')
    .all();
  return rows.flatMap((row): TrustGrant[] => {
    const scope = parseTrustScope(String(row['scope']));
    if (scope === undefined) {
      return [];
    }
    return [{ scope, grantedAt: String(row['granted_at']) }];
  });
}
