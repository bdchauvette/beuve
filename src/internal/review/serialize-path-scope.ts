import { normalizePathScope } from './normalize-path-scope.ts';

/** The stored form of a path scope: a JSON array of its normalized prefixes (`[]` = whole change). */
export function serializePathScope(prefixes: readonly string[]): string {
  return JSON.stringify(normalizePathScope(prefixes));
}
