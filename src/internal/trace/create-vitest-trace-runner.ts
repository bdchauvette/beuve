import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtempDisposable,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { createTraceEnvironment } from './create-trace-environment.ts';
import { findVitestEntry } from './find-vitest-entry.ts';
import { parseTraceRecord } from './parse-trace-record.ts';
import { parseVitestReport } from './parse-vitest-report.ts';
import { renderSetupModule } from './render-setup-module.ts';
import { renderVitestConfig } from './render-vitest-config.ts';
import type { TraceError } from './trace-error.ts';
import type { TraceRecord } from './trace-record.ts';
import type { TraceRunner, TraceRunOutput, TraceRunRequest } from './trace-runner.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';
import { tailOf } from '#x/text/tail-of.ts';

export interface VitestTraceRunnerOptions {
  /** The Node binary that runs Vitest: in the app, the one main resolved (ADR 0083). */
  readonly nodePath: string;
  /** Usually `process.env`; only an allow-list passes through (`createTraceEnvironment`). */
  readonly inheritedEnvironment: Readonly<Record<string, string | undefined>>;
  readonly extraEnvironment?: Readonly<Record<string, string>>;
  /** A beuve-owned directory; each run works in a fresh subdirectory and removes it. */
  readonly temporaryDirectory: string;
  readonly logger?: Logger;
  /** Grace between SIGTERM and SIGKILL when a run is stopped. Defaults to 1 s. */
  readonly killGrace?: Temporal.Duration;
}

interface Workspace {
  readonly worktree: string;
  readonly dependencyRoot: string;
  readonly root: string;
  readonly projectConfig: string | undefined;
  readonly testFiles: readonly string[];
  readonly files: Readonly<Record<string, { original: string; code: string }>>;
}

interface Exit {
  readonly code: number | undefined;
  readonly signal: string | undefined;
  readonly stopped: 'timeout' | 'cancelled' | undefined;
  readonly output: string;
}

const configNames = ['vitest.config', 'vite.config'].flatMap((name) =>
  ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].map((extension) => `${name}${extension}`),
);
const outputTailLength = 8192;

/**
 * Runs a Vitest project's tests against instrumented sources, one Vitest process per run
 * (ADR 0036). Nothing is written into the worktree: the generated config, setup module, run file,
 * caches and reports live in a fresh directory under `temporaryDirectory`, which links to the
 * dependency root's `node_modules` so the config can import Vitest. The process gets no shell, an
 * allow-listed environment and its own process group, which is killed on timeout, cancellation
 * and exit.
 */
export function createVitestTraceRunner(options: VitestTraceRunnerOptions): TraceRunner {
  return {
    run: async (request): Promise<Result<TraceRunOutput, TraceError>> => {
      if (!isTrusted(request.trusted)) {
        return err({ kind: 'untrusted' });
      }
      if (request.signal?.aborted === true) {
        return err({ kind: 'cancelled' });
      }
      const workspace = await resolveWorkspace(request);
      if (!workspace.ok) {
        return workspace;
      }
      const entry = await findVitestEntry(workspace.value.dependencyRoot);
      if (!entry.ok) {
        return entry;
      }
      await mkdir(options.temporaryDirectory, { recursive: true, mode: 0o700 });
      const parent = await realpath(options.temporaryDirectory);
      await using directory = await mkdtempDisposable(path.join(parent, 'trace-'));
      return await runIn(options, request, workspace.value, entry.value.script, directory.path);
    },
  };
}

function isTrusted(value: unknown): boolean {
  return value === true;
}

async function resolveWorkspace(request: TraceRunRequest): Promise<Result<Workspace, TraceError>> {
  const worktree = await realDirectory(request.worktree);
  const dependencyRoot = await realDirectory(request.dependencyRoot);
  if (worktree === undefined) {
    return err({ kind: 'invalid-path', path: request.worktree, reason: 'not a directory' });
  }
  if (dependencyRoot === undefined) {
    return err({ kind: 'invalid-path', path: request.dependencyRoot, reason: 'not a directory' });
  }
  const testFiles: string[] = [];
  for (const file of request.testFiles) {
    const resolved = await realFileInside(worktree, file);
    if (!resolved.ok) {
      return resolved;
    }
    testFiles.push(resolved.value);
  }
  const first = testFiles[0];
  if (first === undefined) {
    return err({ kind: 'no-tests', testFiles: request.testFiles });
  }
  const files: Record<string, { original: string; code: string }> = {};
  for (const file of request.files) {
    const resolved = await realFileInside(worktree, file.path);
    if (!resolved.ok) {
      return resolved;
    }
    files[resolved.value] = { original: file.original, code: file.code };
  }
  const projectConfig = await findProjectConfig(worktree, path.dirname(first));
  const root = projectConfig === undefined ? worktree : path.dirname(projectConfig);
  const inRoot = testFiles.filter((file) => isInside(root, file));
  return inRoot.length === 0
    ? err({ kind: 'no-tests', testFiles: request.testFiles })
    : ok({ worktree, dependencyRoot, root, projectConfig, testFiles: inRoot, files });
}

async function runIn(
  options: VitestTraceRunnerOptions,
  request: TraceRunRequest,
  workspace: Workspace,
  script: string,
  directory: string,
): Promise<Result<TraceRunOutput, TraceError>> {
  const eventsDirectory = path.join(directory, 'events');
  const configFile = path.join(directory, 'vitest.config.mjs');
  const reportFile = path.join(directory, 'report.json');
  await mkdir(eventsDirectory);
  await symlink(
    path.join(workspace.dependencyRoot, 'node_modules'),
    path.join(directory, 'node_modules'),
    'dir',
  );
  const runFile = path.join(directory, 'run.json');
  const setupFile = path.join(directory, 'setup.mjs');
  /* eslint-disable local/forward-abort-signal -- Small temporary files; an abort is answered once Vitest
     starts (`spawnVitest` stops it at once), so the run resolves `cancelled` instead of rejecting. */
  await writeFile(runFile, JSON.stringify({ files: workspace.files }));
  await writeFile(setupFile, renderSetupModule(eventsDirectory));
  await writeFile(
    configFile,
    renderVitestConfig({
      projectConfig: workspace.projectConfig,
      root: workspace.root,
      worktree: workspace.worktree,
      dependencyRoot: workspace.dependencyRoot,
      runFile,
      setupFile,
      reportFile,
      cacheDirectory: path.join(directory, 'cache'),
    }),
  );
  /* eslint-enable local/forward-abort-signal */
  const args = [script, 'run', '--config', configFile, '--root', workspace.root];
  if (request.testNamePattern !== undefined) {
    args.push(`--testNamePattern=${request.testNamePattern}`);
  }
  args.push(...workspace.testFiles);

  const stopwatch = new Stopwatch();
  const exit = await spawnVitest(options, request, args, workspace.root);
  const duration = stopwatch.elapsed();
  options.logger?.debug('trace: vitest exited', { duration, ...exit, output: undefined });
  if (exit.stopped === 'cancelled') {
    return err({ kind: 'cancelled' });
  }
  if (exit.stopped === 'timeout') {
    return err({ kind: 'timeout', timeout: request.timeout });
  }
  const report = await readText(reportFile);
  const outcomes = report === undefined ? undefined : parseVitestReport(report, workspace.worktree);
  if (outcomes === undefined) {
    return err({
      kind: 'run-failed',
      exitCode: exit.code,
      signal: exit.signal,
      output: exit.output,
    });
  }
  if (outcomes.length === 0) {
    return err({ kind: 'no-tests', testFiles: request.testFiles });
  }
  const records = await readRecords(eventsDirectory, workspace.worktree);
  return ok({ records, outcomes, duration });
}

async function spawnVitest(
  options: VitestTraceRunnerOptions,
  request: TraceRunRequest,
  args: readonly string[],
  cwd: string,
): Promise<Exit> {
  const isOwnGroup = process.platform !== 'win32';
  // eslint-disable-next-line local/forward-abort-signal -- `onAbort` below stops the whole process group, with a grace period; spawn's `signal` would kill only the child.
  const child = spawn(options.nodePath, args, {
    cwd,
    env: createTraceEnvironment(options.inheritedEnvironment, options.extraEnvironment),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: isOwnGroup,
    shell: false,
    windowsHide: true,
  });
  let output = '';
  const collect = (chunk: string): void => {
    output = tailOf(output + chunk, outputTailLength);
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (isOwnGroup && child.pid !== undefined) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // The group is already gone.
    }
  };
  using stack = new DisposableStack();
  // Last out: reaps whatever Vitest left running in its group, after any other cleanup.
  stack.defer(() => {
    signalGroup('SIGKILL');
  });
  let stopped: Exit['stopped'];
  let killTimer: NodeJS.Timeout | undefined;
  stack.defer(() => {
    clearTimeout(killTimer);
  });
  const stop = (reason: 'timeout' | 'cancelled'): void => {
    stopped ??= reason;
    signalGroup('SIGTERM');
    killTimer ??= setTimeout(
      () => {
        signalGroup('SIGKILL');
      },
      (options.killGrace ?? Temporal.Duration.from({ seconds: 1 })).total('milliseconds'),
    );
  };
  const deadline = timeoutSignal(request.timeout);
  const bounded =
    request.signal === undefined ? deadline : AbortSignal.any([request.signal, deadline]);
  const onStop = (): void => {
    stop(bounded.reason === deadline.reason ? 'timeout' : 'cancelled');
  };
  const listeners = stack.adopt(new AbortController(), (controller) => {
    controller.abort();
  });
  bounded.addEventListener('abort', onStop, { once: true, signal: listeners.signal });
  if (bounded.aborted) {
    onStop();
  }
  // Awaited, not returned: the stack must outlive the process.
  return await new Promise<Exit>((resolve) => {
    child.once('error', (error) => {
      resolve({
        code: undefined,
        signal: undefined,
        stopped,
        output: `${output}\n${error.message}`,
      });
    });
    child.once('close', (code, signal) => {
      resolve({ code: code ?? undefined, signal: signal ?? undefined, stopped, output });
    });
  });
}

async function readRecords(directory: string, worktree: string): Promise<TraceRecord[]> {
  const entries = await readdir(directory);
  const names = entries
    .filter((name) => name.endsWith('.jsonl'))
    .toSorted((left, right) => left.localeCompare(right));
  const records: TraceRecord[] = [];
  for (const name of names) {
    const text = (await readText(path.join(directory, name))) ?? '';
    for (const line of text.split('\n')) {
      const record = line === '' ? undefined : parseTraceRecord(line);
      if (record !== undefined) {
        records.push(
          record.test === undefined
            ? record
            : {
                ...record,
                test: { ...record.test, file: path.relative(worktree, record.test.file) },
              },
        );
      }
    }
  }
  return records;
}

async function findProjectConfig(worktree: string, from: string): Promise<string | undefined> {
  for (let directory = from; isInside(worktree, directory); directory = path.dirname(directory)) {
    for (const name of configNames) {
      const candidate = path.join(directory, name);
      if (await isFile(candidate)) {
        return candidate;
      }
    }
    if (directory === worktree) {
      break;
    }
  }
  return undefined;
}

async function realFileInside(root: string, file: string): Promise<Result<string, TraceError>> {
  if (path.isAbsolute(file) || file.includes('\0')) {
    return err({ kind: 'invalid-path', path: file, reason: 'not a relative path' });
  }
  let resolved: string;
  try {
    resolved = await realpath(path.join(root, file));
  } catch {
    return err({ kind: 'invalid-path', path: file, reason: 'no such file' });
  }
  return isInside(root, resolved) && (await isFile(resolved))
    ? ok(resolved)
    : err({ kind: 'invalid-path', path: file, reason: 'not a file inside the worktree' });
}

async function realDirectory(directory: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(directory);
    const stats = await stat(resolved);
    return stats.isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    const stats = await stat(file);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}
