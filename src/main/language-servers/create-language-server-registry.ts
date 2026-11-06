import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import type { Logger } from '#x/log/create-logger.ts';

import { loadLanguageServersConfig } from './load-language-servers-config.ts';
import type { LoadedLanguageServersConfig } from './load-language-servers-config.ts';
import { resolveServerDefinitions } from './resolve-server-definitions.ts';
import type { ResolvedServers } from './resolve-server-definitions.ts';
import type { RepositoryIdentity } from './repository-identity.ts';

/** Which repository to resolve for, over which built-in servers. */
export interface RegistryQuery {
  readonly builtins: readonly ServerDefinition[];
  readonly repository: RepositoryIdentity;
}

/** The reviewer's `language-servers.json` files, read, and what they mean for a repository. */
export interface LanguageServerRegistry {
  /**
   * The servers for a repository (ADR 0111). `problems` also holds what was wrong with the files
   * themselves, so a typo is visible wherever diagnostics are.
   */
  readonly resolve: (query: RegistryQuery) => ResolvedServers;
  /** Reads the files again, as Restart Language Servers does. Never rejects. */
  readonly reload: () => Promise<void>;
}

export interface LanguageServerRegistryOptions {
  /** The files, earliest first (`languageServersConfigPaths`). */
  readonly paths: readonly string[];
  /** For `~` in an override's path. */
  readonly home: string;
  readonly logger: Logger;
}

/** Reads the configuration once, now; `reload` reads it again. */
export async function createLanguageServerRegistry(
  options: LanguageServerRegistryOptions,
): Promise<LanguageServerRegistry> {
  const { logger } = options;
  const read = async (): Promise<LoadedLanguageServersConfig> => {
    const result = await loadLanguageServersConfig(options.paths);
    for (const problem of result.problems) {
      logger.warn('language server configuration problem', { problem });
    }
    logger.info('read the language server configuration', {
      files: result.layers.length,
      problems: result.problems.length,
    });
    return result;
  };
  let loaded = await read();

  return {
    resolve: ({ builtins, repository }): ResolvedServers => {
      const resolved = resolveServerDefinitions({
        builtins,
        layers: loaded.layers,
        repository,
        home: options.home,
      });
      return {
        definitions: resolved.definitions,
        problems: [...loaded.problems, ...resolved.problems],
      };
    },
    reload: async (): Promise<void> => {
      loaded = await read();
    },
  };
}
