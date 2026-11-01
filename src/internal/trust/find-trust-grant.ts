import { doesScopeCover } from './does-scope-cover.ts';
import type { TrustGrant, TrustSubject } from './trust-scope.ts';

/** The first grant whose scope covers `subject`, or `undefined` when none does: untrusted. */
export function findTrustGrant(
  grants: readonly TrustGrant[],
  subject: TrustSubject,
): TrustGrant | undefined {
  return grants.find((grant) => doesScopeCover(grant.scope, subject));
}
