import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

/** Where the Node came from: the app's `resources/node/node`, or `node` on `PATH` (unpackaged). */
export type NodeRuntimeSource = 'bundled' | 'path';

/** A Node that beuve's Node children (the TypeScript language server) run on. */
export interface NodeRuntime {
  /** Absolute path of the `node` executable. */
  readonly command: string;
  /** What `--version` printed, without the `v`: `26.13.0`. */
  readonly version: string;
  readonly source: NodeRuntimeSource;
}

/** Why there is no usable Node. Every variant is an expected failure. */
export type NodeRuntimeError =
  | {
      readonly kind: 'missing';
      readonly source: NodeRuntimeSource;
      /** The paths that were tried. */
      readonly searched: readonly string[];
    }
  | { readonly kind: 'unrunnable'; readonly command: string; readonly reason: string }
  | {
      readonly kind: 'too-old';
      readonly command: string;
      readonly version: string;
      readonly minimumMajor: number;
    };

export interface ResolveNodeRuntimeOptions {
  /** `app.isPackaged`: packaged builds use only the bundled Node. */
  readonly packaged: boolean;
  /** `process.resourcesPath`; the bundled Node is `<resourcesPath>/node/node`. */
  readonly resourcesPath: string;
  /** The `PATH` searched for `node` when unpackaged. */
  readonly pathVariable: string | undefined;
  /** The oldest accepted major version. Defaults to 26, the `.node-version` beuve is tested on. */
  readonly minimumMajor?: number;
  /** For `node --version`. Defaults to 10 s (a first launch on macOS checks the signature). */
  readonly timeout?: Temporal.Duration;
  readonly signal?: AbortSignal;
}

const defaultMinimumMajor = 26;
const defaultTimeout = Temporal.Duration.from({ seconds: 10 });
const versionPattern = /^v(\d+)\.\d+\.\d+\S*$/u;
const runFile = promisify(execFile);

/**
 * Finds the Node that beuve's Node children run on (ADR 0083), never Electron's own binary: the
 * `runAsNode` fuse is off. A packaged app uses the Node it ships in `resources/node/node`;
 * `npm start` and tests use the first `node` on `PATH`. Either way the binary is run once with
 * `--version`, and anything older than `minimumMajor` is refused: beuve is built and tested
 * on Node 26 (`.node-version`). Call it once and share the result.
 */
export async function resolveNodeRuntime(
  options: ResolveNodeRuntimeOptions,
): Promise<Result<NodeRuntime, NodeRuntimeError>> {
  let source: NodeRuntimeSource;
  let candidates: string[];
  if (options.packaged) {
    source = 'bundled';
    candidates = [path.join(options.resourcesPath, 'node', 'node')];
  } else {
    source = 'path';
    candidates = pathCandidatesFrom(options.pathVariable);
  }
  const command = await firstExecutable(candidates);
  if (command === undefined) {
    return err({ kind: 'missing', source, searched: candidates });
  }
  const version = await readVersion(command, options);
  if (!version.ok) {
    return version;
  }
  const minimumMajor = options.minimumMajor ?? defaultMinimumMajor;
  if (version.value.major < minimumMajor) {
    return err({ kind: 'too-old', command, version: version.value.text, minimumMajor });
  }
  return ok({ command, version: version.value.text, source });
}

function pathCandidatesFrom(pathVariable = ''): string[] {
  const directories = pathVariable.split(path.delimiter).filter((entry) => path.isAbsolute(entry));
  return Array.from(new Set(directories), (directory) => path.join(directory, 'node'));
}

async function firstExecutable(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    const stats = await stat(file);
    await access(file, constants.X_OK);
    return stats.isFile();
  } catch {
    return false;
  }
}

/** What `node --version` printed, and its major version. */
interface PrintedVersion {
  readonly text: string;
  readonly major: number;
}

async function readVersion(
  command: string,
  options: ResolveNodeRuntimeOptions,
): Promise<Result<PrintedVersion, NodeRuntimeError>> {
  const timeout = timeoutSignal(options.timeout ?? defaultTimeout);
  let signal = timeout;
  if (options.signal !== undefined) {
    signal = AbortSignal.any([options.signal, timeout]);
  }
  let stdout: string;
  try {
    // No inherited environment: NODE_OPTIONS and the like must not change the answer.
    ({ stdout } = await runFile(command, ['--version'], { env: {}, signal, encoding: 'utf8' }));
  } catch (error: unknown) {
    return err({ kind: 'unrunnable', command, reason: errorFrom(error).message });
  }
  const printed = stdout.trim();
  const major = versionPattern.exec(printed)?.[1];
  if (major === undefined) {
    return err({
      kind: 'unrunnable',
      command,
      reason: `--version printed ${JSON.stringify(printed)}`,
    });
  }
  return ok({ text: printed.slice(1), major: Number(major) });
}
