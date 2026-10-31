import path from 'node:path';

import { parseModuleConfig } from './parse-module-config.ts';
import type { ModuleConfig } from './parse-module-config.ts';

/** Resolves a module specifier to a repository path, or `undefined`. */
export type ModuleResolver = (request: ModuleRequest) => string | undefined;

/** A module specifier and the file that wrote it. */
export interface ModuleRequest {
  readonly specifier: string;
  /** Repository-relative, `/`-separated. */
  readonly fromPath: string;
}

export interface ModuleResolverInput {
  /** Every file of the repository at the head, `/`-separated and repository-relative. */
  readonly paths: ReadonlySet<string>;
  /** The texts of the repository's `package.json` and `tsconfig.json` files, by path. */
  readonly configs: ReadonlyMap<string, string>;
}

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

/** A TypeScript source may be imported under its emitted extension. */
const emittedExtensions: ReadonlyMap<string, readonly string[]> = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

const importConditions = ['types', 'import', 'node', 'default', 'require'];

/** The parsed configs and the file probe a resolution looks things up in. */
interface ResolverScope {
  readonly configs: ReadonlyMap<string, ModuleConfig>;
  readonly probe: (base: string) => string | undefined;
}

type ConfigName = 'package.json' | 'tsconfig.json';

/** The exact key of an `imports` or `paths` table, or a `*` pattern and what its `*` matched. */
interface PatternMatch {
  readonly pattern: string;
  readonly star: string;
}

/**
 * Module resolution over the files of a repository at one commit, with no file system access:
 * relative specifiers (with the extension and `index` probing TypeScript and Node do),
 * `#alias` specifiers through the nearest enclosing `package.json` `imports`, and `tsconfig.json`
 * `paths` (with `baseUrl`) from the nearest enclosing tsconfig that has them. Bare package
 * specifiers are external and resolve to `undefined`, as does anything that matches no file.
 */
export function createModuleResolver(input: ModuleResolverInput): ModuleResolver {
  const configs = new Map<string, ModuleConfig>(
    Array.from(input.configs, ([file, text]) => {
      return [file, parseModuleConfig(text)];
    }),
  );
  const isFile = (candidate: string): boolean => input.paths.has(candidate);
  const probe = (base: string): string | undefined => probeFile(base, isFile);

  const scope: ResolverScope = { configs, probe };

  return (request) => {
    const { specifier, fromPath } = request;
    if (specifier === '.' || specifier.startsWith('./') || specifier.startsWith('../')) {
      const directory = path.posix.dirname(fromPath);
      return probe(path.posix.normalize(path.posix.join(directory, specifier)));
    }
    if (specifier.startsWith('#')) {
      return resolveAlias(scope, request);
    }
    return resolveTsconfigPath(scope, request);
  };
}

function probeFile(base: string, isFile: (candidate: string) => boolean): string | undefined {
  const candidates = [base];
  const extension = path.posix.extname(base);
  const stem = base.slice(0, base.length - extension.length);
  const emitted = emittedExtensions.get(extension) ?? [];
  for (const added of emitted) {
    candidates.push(`${stem}${added}`);
  }
  for (const added of sourceExtensions) {
    candidates.push(`${base}${added}`);
  }
  for (const added of sourceExtensions) {
    candidates.push(`${base}/index${added}`);
  }
  return candidates.find((candidate) => isFile(candidate));
}

/** Directories from `directory` up to the repository root (`''`), nearest first. */
function ancestorsOf(directory: string): string[] {
  const chain: string[] = [];
  let current = rootAsEmpty(directory);
  for (;;) {
    chain.push(current);
    if (current === '') {
      return chain;
    }
    current = rootAsEmpty(path.posix.dirname(current));
  }
}

/** `''` for the repository root, which `path.posix.dirname` writes as `.`. */
function rootAsEmpty(directory: string): string {
  if (directory === '.') {
    return '';
  }
  return directory;
}

function configPathIn(directory: string, name: ConfigName): string {
  if (directory === '') {
    return name;
  }
  return `${directory}/${name}`;
}

function resolveAlias(
  { configs, probe }: ResolverScope,
  { specifier, fromPath }: ModuleRequest,
): string | undefined {
  const ancestors = ancestorsOf(path.posix.dirname(fromPath));
  for (const ancestor of ancestors) {
    const imports = configs.get(configPathIn(ancestor, 'package.json'))?.imports;
    if (imports === undefined) {
      continue;
    }
    const match = matchPattern(Object.keys(imports), specifier);
    if (match === undefined) {
      return undefined;
    }
    const target = targetOf(imports[match.pattern]);
    if (target === undefined) {
      return undefined;
    }
    if (target.startsWith('./')) {
      return probe(expandIn(ancestor, { target, match }));
    }
    return undefined;
  }
  return undefined;
}

/** The first string target under the conditions an import from source can satisfy. */
function targetOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => targetOf(entry)).find((entry) => entry !== undefined);
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const condition of importConditions) {
    const target = targetOf(record[condition]);
    if (target !== undefined) {
      return target;
    }
  }
  return undefined;
}

function resolveTsconfigPath(
  { configs, probe }: ResolverScope,
  { specifier, fromPath }: ModuleRequest,
): string | undefined {
  const ancestors = ancestorsOf(path.posix.dirname(fromPath));
  for (const ancestor of ancestors) {
    const config = configs.get(configPathIn(ancestor, 'tsconfig.json'));
    if (config?.paths === undefined) {
      continue;
    }
    const root = path.posix.join(ancestor, config.baseUrl ?? '.');
    const match = matchPattern(Object.keys(config.paths), specifier);
    if (match === undefined) {
      return undefined;
    }
    return (config.paths[match.pattern] ?? [])
      .map((target) => {
        return probe(expandIn(root, { target, match }));
      })
      .find((resolved) => resolved !== undefined);
  }
  return undefined;
}

/** A target of a matched `imports` or `paths` pattern. */
interface MatchedTarget {
  readonly target: string;
  readonly match: PatternMatch;
}

/** `target` with its `*` replaced by what the pattern's `*` matched, relative to `directory`. */
function expandIn(directory: string, { target, match }: MatchedTarget): string {
  return path.posix.normalize(
    path.posix.join(
      directory,
      target.replace('*', () => match.star),
    ),
  );
}

/** The exact key, else the pattern with a single `*` and the longest prefix, and what `*` matched. */
function matchPattern(patterns: readonly string[], specifier: string): PatternMatch | undefined {
  if (patterns.includes(specifier)) {
    return { pattern: specifier, star: '' };
  }
  let best: { pattern: string; star: string } | undefined;
  for (const pattern of patterns) {
    const at = pattern.indexOf('*');
    if (at === -1) {
      continue;
    }
    const prefix = pattern.slice(0, at);
    const suffix = pattern.slice(at + 1);
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (best === undefined || prefix.length > best.pattern.indexOf('*'))
    ) {
      best = { pattern, star: specifier.slice(prefix.length, specifier.length - suffix.length) };
    }
  }
  return best;
}
