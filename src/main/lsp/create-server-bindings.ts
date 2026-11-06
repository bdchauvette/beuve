import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { LruCache } from '#x/collections/lru-cache.ts';

/**
 * Which servers apply to which checkout (ADR 0111). The reviewer's configuration is per
 * repository, but the multiplexer knows checkouts, so each language-server request binds the
 * servers of its session to the checkout it is about, and the multiplexer asks for them by path.
 * Two sessions of one repository at one commit share a checkout and a path glob names the same
 * clone for both, so the later binding is the same unless a `remote` override tells them apart.
 */
export interface ServerBindings {
  /** `root` is the checkout's real path. */
  readonly bind: (root: string, servers: readonly ServerDefinition[]) => void;
  readonly serversFor: (root: string) => readonly ServerDefinition[] | undefined;
}

/** Remembers the last few checkouts: older ones are pruned at startup anyway. */
export function createServerBindings(): ServerBindings {
  const bound = new LruCache<string, readonly ServerDefinition[]>(64);
  return {
    bind: (root, servers): void => {
      bound.set(root, servers);
    },
    serversFor: (root): readonly ServerDefinition[] | undefined => {
      return bound.get(root);
    },
  };
}
