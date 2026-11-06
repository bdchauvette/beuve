import type { ServerDefinition } from '#internal/lsp/server-definition.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { isGlobMatch } from './is-glob-match.ts';
import type {
  LanguageServersConfig,
  OverrideMatch,
  ServerSettings,
} from './language-servers-config-schema.ts';
import type { RepositoryIdentity } from './repository-identity.ts';

/** The configuration layers to apply to a repository, over beuve's own servers. */
export interface ResolveServersOptions {
  /** beuve's own definitions, in the order they are tried. */
  readonly builtins: readonly ServerDefinition[];
  /** Each file read, earliest first; a later one wins where they differ. */
  readonly layers: readonly LanguageServersConfig[];
  readonly repository: RepositoryIdentity;
  /** For `~` in an override's path. */
  readonly home: string;
}

export interface ResolvedServers {
  /** The servers for the repository, in the order they are tried. */
  readonly definitions: readonly ServerDefinition[];
  /** What was wrong with servers that were left out, one sentence each. */
  readonly problems: readonly string[];
}

const defaultQuiet = Temporal.Duration.from({ milliseconds: 500 });

/**
 * The language servers for one repository (ADR 0111). The layers' `servers` merge per id and per
 * field (a later layer's field replaces an earlier one's; nothing merges inside a field), then the
 * layers' overrides, in order, are applied the same way for those whose `match` names the
 * repository. A built-in id keeps what the config does not say; `enabled: false` turns a server off;
 * a new id defines a server of the reviewer's, which needs a command and extensions, and
 * everything the config touched is marked as the reviewer's own, which the trust check consults.
 * A server that is incomplete is left out with a problem. Builtins come first, in their order,
 * then new ids in the order the config first names them. Pure.
 */
export function resolveServerDefinitions(options: ResolveServersOptions): ResolvedServers {
  const merged = new Map<string, ServerSettings>();
  const apply = (servers: Readonly<Record<string, ServerSettings>> | undefined): void => {
    const entries = Object.entries(servers ?? {});
    for (const [id, settings] of entries) {
      merged.set(id, { ...merged.get(id), ...settings });
    }
  };
  for (const layer of options.layers) {
    apply(layer.servers);
  }
  for (const layer of options.layers) {
    const overrides = layer.overrides ?? [];
    for (const override of overrides) {
      if (doesOverrideApply(override.match, options)) {
        apply(override.servers);
      }
    }
  }
  const definitions: ServerDefinition[] = [];
  const problems: string[] = [];
  const ids = new Set([...options.builtins.map((builtin) => builtin.id), ...merged.keys()]);
  for (const id of ids) {
    const base = options.builtins.find((builtin) => builtin.id === id);
    const settings = merged.get(id);
    if (settings?.enabled === false) {
      continue;
    }
    const built = definitionFrom(id, { base, settings });
    if (built.ok) {
      definitions.push(built.value);
    } else {
      problems.push(built.error);
    }
  }
  return { definitions, problems };
}

/** What one server's definition is made of: beuve's own, and what the config says. */
interface DefinitionParts {
  readonly base: ServerDefinition | undefined;
  readonly settings: ServerSettings | undefined;
}

function definitionFrom(id: string, parts: DefinitionParts): Result<ServerDefinition, string> {
  const { base, settings } = parts;
  if (settings === undefined && base !== undefined) {
    return ok(base);
  }
  const command = settings?.command ?? base?.command;
  if (command === undefined) {
    return err(`The ${id} language server has no command.`);
  }
  const languageIds = extensionsFrom(settings, base);
  if (Object.keys(languageIds).length === 0) {
    return err(`The ${id} language server handles no file extensions.`);
  }
  const rootMarkers = settings?.rootMarkers ?? base?.rootMarkers;
  const initializationOptions = settings?.initializationOptions ?? base?.initializationOptions;
  const settingsForServer = settings?.settings ?? base?.settings;
  const env = settings?.env ?? base?.env;
  const inheritEnv = settings?.inheritEnv ?? base?.inheritEnv;
  let diagnosticsQuiet = base?.diagnosticsQuiet ?? defaultQuiet;
  if (settings?.diagnosticsQuietMs !== undefined) {
    diagnosticsQuiet = Temporal.Duration.from({ milliseconds: settings.diagnosticsQuietMs });
  }
  return ok({
    id,
    command,
    args: settings?.args ?? base?.args ?? [],
    languageIds,
    source: settings?.source ?? base?.source ?? 'path',
    origin: originOf(parts),
    diagnosticsQuiet,
    ...(rootMarkers !== undefined && { rootMarkers }),
    ...(initializationOptions !== undefined && { initializationOptions }),
    ...(settingsForServer !== undefined && { settings: settingsForServer }),
    ...(env !== undefined && { env }),
    ...(inheritEnv !== undefined && { inheritEnv }),
  });
}

function extensionsFrom(
  settings: ServerSettings | undefined,
  base: ServerDefinition | undefined,
): Record<string, string> {
  if (settings?.extensions === undefined) {
    return { ...base?.languageIds };
  }
  const lowered: Record<string, string> = {};
  for (const [extension, languageId] of Object.entries(settings.extensions)) {
    lowered[extension.toLowerCase()] = languageId;
  }
  return lowered;
}

/** The reviewer's own when the config says anything about the server but whether it is on. */
function originOf({ base, settings }: DefinitionParts): 'builtin' | 'reviewer' {
  const isTouched = Object.keys(settings ?? {}).some((key) => key !== 'enabled');
  if (base === undefined || isTouched) {
    return 'reviewer';
  }
  return base.origin ?? 'builtin';
}

function doesOverrideApply(match: OverrideMatch, options: ResolveServersOptions): boolean {
  const { repository, home } = options;
  if ('path' in match) {
    return isGlobMatch({
      pattern: expandHome({ pattern: match.path, home }),
      value: withoutTrailingSlash(repository.clonePath),
    });
  }
  if (repository.remote === undefined) {
    return false;
  }
  return isGlobMatch({
    pattern: match.remote.toLowerCase(),
    value: repository.remote.toLowerCase(),
  });
}

/** A path glob and the home directory its leading `~` stands for. */
interface HomeExpansion {
  readonly pattern: string;
  readonly home: string;
}

function expandHome({ pattern, home }: HomeExpansion): string {
  if (pattern === '~') {
    return home;
  }
  if (pattern.startsWith('~/')) {
    return `${withoutTrailingSlash(home)}${pattern.slice(1)}`;
  }
  return pattern;
}

function withoutTrailingSlash(value: string): string {
  if (value.length > 1 && value.endsWith('/')) {
    return value.slice(0, -1);
  }
  return value;
}
