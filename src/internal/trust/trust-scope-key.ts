import type { TrustScope } from './trust-scope.ts';

/** How each scope kind names the one grant it may have (ADR 0090). */
type ScopeKeys = {
  readonly [K in TrustScope['kind']]: (scope: Extract<TrustScope, { readonly kind: K }>) => string;
};

const keys: ScopeKeys = {
  repository: (scope): string => {
    return scope.path;
  },
};

/**
 * The key a scope is stored under beside its kind: one grant per (kind, key). A repository's key
 * is its real path, so trusting it again replaces the grant and its remote.
 */
export function trustScopeKey(scope: TrustScope): string {
  return keys[scope.kind](scope);
}
