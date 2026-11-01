import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ToolCandidate } from '#internal/deps/dependency-ecosystem.ts';
import type { ResolvedTool } from '#internal/deps/plan-install.ts';
import type { Logger } from '#x/log/create-logger.ts';
import type { Result } from '#x/result/result.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

import { wellKnownToolDirectories } from './well-known-tool-directories.ts';

/** The bundled corepack (ADR 0091) and the Node that runs it (ADR 0083). */
export interface CorepackRuntime {
  readonly node: string;
  /** `corepack/dist/corepack.js`, unpacked from the archive in a packaged app. */
  readonly script: string;
}

export interface ToolchainFinderOptions {
  readonly home: string;
  /** beuve's own `PATH`, searched last. */
  readonly inheritedPath: string | undefined;
  /** The login shell's environment (`captureLoginEnvironment`); asked once, then cached. */
  readonly captureEnvironment: () => Promise<Result<Readonly<Record<string, string>>, string>>;
  /** Per executable, a directory searched first (Settings). */
  readonly toolPaths: () => ReadonlyMap<string, string>;
  readonly corepack: Result<CorepackRuntime, string>;
  readonly logger: Logger;
  /** Defaults to {@link wellKnownToolDirectories}; tests pass none. */
  readonly wellKnown?: readonly string[];
  /** For `--version`. Defaults to 60 s: corepack may download the package manager first. */
  readonly versionTimeout?: Temporal.Duration;
}

/** Where a candidate is looked for, and the environment its `--version` runs with. */
export interface ToolRequest {
  readonly candidate: ToolCandidate;
  /** The unit's directory in the checkout: corepack reads `packageManager` from there. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Finds package managers on the host (ADR 0089, 0091). */
export interface ToolchainFinder {
  /** The candidate's executable and how to start it, or `undefined` when it isn't installed. */
  readonly find: (request: ToolRequest) => Promise<ResolvedTool | undefined>;
  /**
   * The `PATH` configured steps and the hook run with: beuve's Node, then the directories tools
   * are searched in.
   */
  readonly searchPath: () => Promise<string>;
  /** The variables the login shell set that tools read (`MISE_*`, `VOLTA_HOME`, …), `PATH` aside. */
  readonly environment: () => Promise<Readonly<Record<string, string>>>;
}

const runFile = promisify(execFile);
const defaultVersionTimeout = Temporal.Duration.from({ seconds: 60 });

/**
 * Toolchain discovery (ADR 0089). Node package managers run on beuve's Node through the bundled
 * corepack, which honours `packageManager` (ADR 0091). Every other tool is searched, in order,
 * in the directory Settings names for it, the login shell's `PATH` (captured once from `$HOME`),
 * the well-known directories (Homebrew, `~/.local/bin`, version-manager shims), then beuve's
 * own `PATH`. A Settings directory also overrides corepack for its tool. The tool's `PATH` puts
 * its own directory and beuve's Node first, so install scripts find `node`.
 */
export function createToolchainFinder(options: ToolchainFinderOptions): ToolchainFinder {
  let captured: Promise<Readonly<Record<string, string>>> | undefined;
  const capture = async (): Promise<Readonly<Record<string, string>>> => {
    captured ??= (async (): Promise<Readonly<Record<string, string>>> => {
      const result = await options.captureEnvironment();
      if (result.ok) {
        return result.value;
      }
      options.logger.warn('could not read the login shell environment; using known directories', {
        reason: result.error,
      });
      return {};
    })();
    return captured;
  };

  const searchDirectories = async (): Promise<readonly string[]> => {
    const environment = await capture();
    return unique([
      ...splitPath(environment['PATH']),
      ...(options.wellKnown ?? wellKnownToolDirectories(options.home)),
      ...splitPath(options.inheritedPath),
    ]);
  };

  const version = async ({ command, request }: VersionProbe): Promise<string | undefined> => {
    const [file, ...args] = command;
    if (file === undefined) {
      return undefined;
    }
    try {
      const { stdout } = await runFile(file, [...args, '--version'], {
        cwd: request.cwd,
        env: request.env,
        encoding: 'utf8',
        signal: timeoutSignal(options.versionTimeout ?? defaultVersionTimeout),
      });
      const first = stdout.trim().split('\n', 1)[0]?.trim() ?? '';
      if (first === '') {
        return undefined;
      }
      return first;
    } catch {
      return undefined;
    }
  };

  const resolved = async ({ command, request }: VersionProbe): Promise<ResolvedTool> => {
    const directories = await searchDirectories();
    const first: string[] = [];
    if (command[0] !== undefined) {
      first.push(path.dirname(command[0]));
    }
    if (options.corepack.ok) {
      first.push(path.dirname(options.corepack.value.node));
    }
    const env = { PATH: unique([...first, ...directories]).join(path.delimiter) };
    return {
      executable: request.candidate.executable,
      command,
      version: await version({ command, request: { ...request, env: { ...request.env, ...env } } }),
      env,
    };
  };

  return {
    searchPath: async (): Promise<string> => {
      const first: string[] = [];
      if (options.corepack.ok) {
        first.push(path.dirname(options.corepack.value.node));
      }
      return unique([...first, ...(await searchDirectories())]).join(path.delimiter);
    },
    environment: async (): Promise<Readonly<Record<string, string>>> => {
      const captured = await capture();
      return Object.fromEntries(Object.entries(captured).filter(([name]) => name !== 'PATH'));
    },
    find: async (request): Promise<ResolvedTool | undefined> => {
      const { executable } = request.candidate;
      const override = options.toolPaths().get(executable);
      if (override !== undefined) {
        const file = await executableIn([override], executable);
        if (file !== undefined) {
          return resolved({ command: [file], request });
        }
        options.logger.warn('the tool path set in Settings has no such executable', {
          executable,
          directory: override,
        });
      }
      if (request.candidate.toolchain === 'corepack') {
        if (!options.corepack.ok) {
          return undefined;
        }
        const { node, script } = options.corepack.value;
        return resolved({ command: [node, script, executable], request });
      }
      const file = await executableIn(await searchDirectories(), executable);
      if (file === undefined) {
        return undefined;
      }
      return resolved({ command: [file], request });
    },
  };
}

/** A command to ask for its version, for the request that found it. */
interface VersionProbe {
  readonly command: readonly string[];
  readonly request: ToolRequest;
}

function splitPath(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value.split(path.delimiter).filter((entry) => path.isAbsolute(entry));
}

function unique(entries: readonly string[]): readonly string[] {
  return [...new Set(entries)];
}

async function executableIn(
  directories: readonly string[],
  executable: string,
): Promise<string | undefined> {
  for (const directory of directories) {
    const file = path.join(directory, executable);
    try {
      await access(file, constants.X_OK);
      return file;
    } catch {
      continue;
    }
  }
  return undefined;
}
