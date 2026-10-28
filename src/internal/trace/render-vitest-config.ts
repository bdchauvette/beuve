export interface VitestConfigInput {
  /** The project's own config (absolute), merged underneath; `undefined` when it has none. */
  readonly projectConfig: string | undefined;
  /** Vitest's root: the directory of the project config, inside the worktree (real path). */
  readonly root: string;
  /** The checkout under test (real path); bare imports from it fall back to `dependencyRoot`. */
  readonly worktree: string;
  /** A directory whose `node_modules` holds the project's dependencies (real path). */
  readonly dependencyRoot: string;
  /** JSON `{ files: { [absolutePath]: { original, code } } }` read by the transform. */
  readonly runFile: string;
  readonly setupFile: string;
  readonly reportFile: string;
  readonly cacheDirectory: string;
}

/**
 * The Vitest config beuve generates in its own temp directory (ADR 0036). It loads the project's
 * config and overrides what must not vary: beuve's setup module goes last, the transform that swaps
 * in instrumented sources goes first, reports go to `reportFile` as JSON, and every cache, snapshot
 * update, coverage and watch mode is off so nothing is written into the worktree. Bare imports
 * from worktree files that resolve nowhere are retried from `dependencyRoot`, because beuve's
 * worktrees have no `node_modules` (ADR 0020).
 */
export function renderVitestConfig(input: VitestConfigInput): string {
  const settings = {
    root: input.root,
    worktree: input.worktree,
    dependencyAnchor: `${input.dependencyRoot}/package.json`,
    runFile: input.runFile,
    setupFile: input.setupFile,
    reportFile: input.reportFile,
    cacheDirectory: input.cacheDirectory,
  };
  const projectImport =
    input.projectConfig === undefined
      ? 'const projectConfig = {};'
      : `import projectConfig from ${JSON.stringify(input.projectConfig)};`;
  return String.raw`import { readFileSync } from 'node:fs';
import { mergeConfig } from 'vitest/config';
${projectImport}

const settings = ${JSON.stringify(settings, undefined, 2)};
const run = JSON.parse(readFileSync(settings.runFile, 'utf8'));
const isBare = (source) =>
  !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('\0') && !source.includes(':');

const tracePlugin = {
  name: 'beuve-trace',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (importer === undefined || !isBare(source) || !importer.startsWith(settings.worktree + '/')) {
      return null;
    }
    const found = await this.resolve(source, importer, { ...options, skipSelf: true });
    return found ?? this.resolve(source, settings.dependencyAnchor, { ...options, skipSelf: true });
  },
  transform(code, id) {
    const entry = run.files[id.split('?', 1)[0]];
    if (entry === undefined) {
      return null;
    }
    if (code !== entry.original) {
      throw new Error('beuve trace: ' + id + ' differs from the text the probe was planned on');
    }
    return { code: entry.code, map: null };
  },
};

export default async function beuveTraceConfig(env) {
  const loaded = typeof projectConfig === 'function' ? await projectConfig(env) : await projectConfig;
  const merged = mergeConfig(loaded ?? {}, { test: { setupFiles: [settings.setupFile] } });
  const test = merged.test ?? {};
  return {
    ...merged,
    root: settings.root,
    cacheDir: settings.cacheDirectory,
    plugins: [tracePlugin, ...(merged.plugins ?? [])],
    test: {
      ...test,
      watch: false,
      update: false,
      ui: false,
      open: false,
      api: false,
      reporters: ['json'],
      outputFile: settings.reportFile,
      coverage: { ...test.coverage, enabled: false },
      typecheck: { ...test.typecheck, enabled: false },
      cache: false,
      fsModuleCache: false,
      fsModuleCachePath: settings.cacheDirectory,
    },
  };
}
`;
}
