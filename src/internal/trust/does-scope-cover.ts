import type { TrustScope, TrustSubject } from './trust-scope.ts';

/** One matcher per scope kind; a new kind is a new entry here (ADR 0090). */
type ScopeMatchers = {
  readonly [K in TrustScope['kind']]: (
    scope: Extract<TrustScope, { readonly kind: K }>,
    subject: TrustSubject,
  ) => boolean;
};

const matchers: ScopeMatchers = {
  repository: (scope, subject): boolean => {
    if (scope.path !== subject.repositoryPath) {
      return false;
    }
    return scope.remoteUrl === undefined || scope.remoteUrl === subject.remoteUrl;
  },
};

/**
 * Whether `scope` covers `subject`, by the matcher for its kind (ADR 0090). A repository scope
 * holds for the same real path and, when it recorded a remote URL, only while the repository
 * still has that URL: a path that now holds another project, or whose remote was swapped, is not
 * covered.
 */
export function doesScopeCover(scope: TrustScope, subject: TrustSubject): boolean {
  return matchers[scope.kind](scope, subject);
}
