import path from 'node:path';

import { parseModuleConfig } from './parse-module-config.ts';
import type { ModuleConfig } from './parse-module-config.ts';

/** Resolves a module specifier written in `fromPath` to a repository path, or `undefined`. */
export type ModuleResolver = (specifier: string, fromPath: string) => string | undefined;

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

/**
 * Module resolution over the files of a repository at one commit, with no file system access:
 * relative specifiers (with the extension and `index` probing TypeScript and Node do),
 * `#alias` specifiers through the nearest enclosing `package.json` `imports`, and `tsconfig.json`
 * `paths` (with `baseUrl`) from the nearest enclosing tsconfig that has them. Bare package
 * specifiers are external and resolve to `undefined`, as does anything that matches no file.
 */
export function createModuleResolver(input: ModuleResolverInput): ModuleResolver {
  const configs = new Map<string, ModuleConfig>(
    Array.from(input.configs, ([file, text]) => [file, parseModuleConfig(text)]),
  );
  const isFile = (candidate: string): boolean => input.paths.has(candidate);
  const probe = (base: string): string | undefined => probeFile(base, isFile);

  return (specifier, fromPath) => {
    const directory = path.posix.dirname(fromPath);
    if (specifier === '.' || specifier.startsWith('./') || specifier.startsWith('../')) {
      return probe(path.posix.normalize(path.posix.join(directory, specifier)));
    }
    if (specifier.startsWith('#')) {
      return resolveAlias(configs, directory, specifier, probe);
    }
    return resolveTsconfigPath(configs, directory, specifier, probe);
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
  let current = directory === '.' ? '' : directory;
  for (;;) {
    chain.push(current);
    if (current === '') {
      return chain;
    }
    const parent = path.posix.dirname(current);
    current = parent === '.' ? '' : parent;
  }
}

function configPathIn(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

function resolveAlias(
  configs: ReadonlyMap<string, ModuleConfig>,
  directory: string,
  specifier: string,
  probe: (base: string) => string | undefined,
): string | undefined {
  for (const ancestor of ancestorsOf(directory)) {
    const imports = configs.get(configPathIn(ancestor, 'package.json'))?.imports;
    if (imports === undefined) {
      continue;
    }
    const match = matchPattern(Object.keys(imports), specifier);
    const target = match === undefined ? undefined : targetOf(imports[match.pattern]);
    if (match === undefined || target === undefined) {
      return undefined;
    }
    return target.startsWith('./') ? probe(inDirectory(ancestor, target, match.star)) : undefined;
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
  configs: ReadonlyMap<string, ModuleConfig>,
  directory: string,
  specifier: string,
  probe: (base: string) => string | undefined,
): string | undefined {
  for (const ancestor of ancestorsOf(directory)) {
    const config = configs.get(configPathIn(ancestor, 'tsconfig.json'));
    if (config?.paths === undefined) {
      continue;
    }
    const root = path.posix.join(ancestor, config.baseUrl ?? '.');
    const match = matchPattern(Object.keys(config.paths), specifier);
    const targets = match === undefined ? [] : (config.paths[match.pattern] ?? []);
    return targets
      .map((target) => probe(inDirectory(root, target, match?.star ?? '')))
      .find((resolved) => resolved !== undefined);
  }
  return undefined;
}

/** `target` with its `*` replaced, relative to `directory`, normalized. */
function inDirectory(directory: string, target: string, star: string): string {
  return path.posix.normalize(
    path.posix.join(
      directory,
      target.replace('*', () => star),
    ),
  );
}

/** The exact key, else the pattern with a single `*` and the longest prefix, and what `*` matched. */
function matchPattern(
  patterns: readonly string[],
  specifier: string,
): { readonly pattern: string; readonly star: string } | undefined {
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
