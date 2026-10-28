import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type {
  IpcError,
  IpcResult,
  TraceCancelledView,
  TraceCancelRequest,
  TraceFailureKind,
  TraceGetTrustRequest,
  TraceResultView,
  TraceRunRequest,
  TraceRunStartedView,
  TraceSetTrustRequest,
  TraceStatusView,
  TraceTrustView,
} from '#contract/ipc-contract.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { ParseSyntax } from '#internal/syntax/create-syntax-parser.ts';
import { createVitestTraceRunner } from '#internal/trace/create-vitest-trace-runner.ts';
import type { InstrumentationPlan } from '#internal/trace/instrumentation-plan.ts';
import { planInstrumentation } from '#internal/trace/plan-instrumentation.ts';
import { runTraceProbe } from '#internal/trace/run-trace-probe.ts';
import type { TraceRunner } from '#internal/trace/trace-runner.ts';
import { traceRulesByLanguage } from '#internal/trace/trace-rules-by-language.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';

import { describeTraceError } from './describe-trace-error.ts';
import { findTestFiles } from './find-test-files.ts';
import { toHunkChangedLines } from './to-hunk-changed-lines.ts';
import { toRepositoryRelativePath } from './to-repository-relative-path.ts';
import { toTraceResultView } from './to-trace-result-view.ts';
import type { TraceTrust } from './create-trace-trust.ts';

/** What an agent asks for (`beuve_run_trace_probe`). */
export interface TraceProbeInput {
  readonly sessionId: string;
  readonly path: string;
  readonly line: number;
  readonly testNamePattern?: string | undefined;
}

/** A finished probe: the trace, and whether some of the tests it ran failed. */
export interface TraceProbeOutput {
  readonly sessionId: string;
  readonly result: TraceResultView;
  readonly testsFailed: boolean;
}

/** Why an agent's probe produced no trace; `message` tells it what to do. */
export interface TraceProbeFailure {
  readonly failure: TraceFailureKind;
  readonly message: string;
}

/** Test-driven trace probes, as the renderer and the MCP tool reach them (ADR 0036, 0041). */
export interface TraceServices {
  /** Starts a probe in the background; progress and outcome arrive through `onStatus`. */
  readonly run: (request: TraceRunRequest) => Promise<IpcResult<TraceRunStartedView>>;
  /** Runs a probe for an agent and waits for it. Never asks for trust and never pushes events. */
  readonly probe: (input: TraceProbeInput) => Promise<Result<TraceProbeOutput, TraceProbeFailure>>;
  readonly cancel: (request: TraceCancelRequest) => IpcResult<TraceCancelledView>;
  readonly getTrust: (request: TraceGetTrustRequest) => Promise<IpcResult<TraceTrustView>>;
  readonly setTrust: (request: TraceSetTrustRequest) => Promise<IpcResult<TraceTrustView>>;
  /** Aborts the session's probe if it started at a head other than `headSha`. */
  readonly observeHead: (sessionId: string, headSha: string) => void;
  readonly onStatus: (listener: (event: TraceStatusView) => void) => () => void;
  /** Aborts every probe and waits until their processes are gone. */
  readonly dispose: () => Promise<void>;
}

export interface TraceServicesOptions {
  readonly context: SessionContext;
  readonly worktrees: SessionWorktrees;
  /** The syntax domain's `SyntaxParser.parse`. */
  readonly parse: ParseSyntax;
  readonly trust: TraceTrust;
  /** Replaces the Vitest runner; tests use it to count or fake runs. */
  readonly runner?: TraceRunner;
  /** Where each run makes its throwaway directory. Defaults to a folder under the OS temp. */
  readonly temporaryDirectory?: string;
  /** Longest a probe may run. Defaults to 30 s (ADR 0041). */
  readonly timeoutMs?: number;
}

type StopReason = 'cancelled' | 'head-changed' | 'app-quit';

interface Failed {
  readonly kind: 'failed';
  readonly failure: TraceFailureKind;
  readonly message: string;
  readonly repositoryPath?: string;
}

type Outcome =
  | Failed
  | { readonly kind: 'done'; readonly result: TraceResultView; readonly testsFailed: boolean };

interface Job {
  readonly sessionId: string;
  readonly runId: string;
  readonly headSha: string;
  readonly controller: AbortController;
  /** Settles with the outcome and, once it has, the job is gone from the registry. */
  outcome: Promise<Outcome>;
}

const defaultTimeoutMs = 30_000;
const stopReasons: ReadonlySet<string> = new Set(['cancelled', 'head-changed', 'app-quit']);
const stopMessages: Readonly<Record<StopReason, string>> = {
  cancelled: 'The probe was cancelled.',
  'head-changed': 'The head moved while the probe ran, so it was stopped.',
  'app-quit': 'beuve is quitting.',
};

/**
 * Runs the tests covering a hunk with execution tracing (ADR 0036). A probe loads the review
 * diff, checks the repository's approval (nothing runs before it), makes sure the head checkout
 * exists (ADR 0020), plans the instrumentation from the head blob, picks tests statically and
 * runs one Vitest process against the user's clone for dependencies. One probe is in flight per
 * session; cancelling, a head change and quitting abort it. The renderer gets `trace:status`
 * events, agents wait for the outcome.
 */
export function createTraceServices(options: TraceServicesOptions): TraceServices {
  const { context, worktrees, parse, trust } = options;
  const { logger } = context;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const runner =
    options.runner ??
    createVitestTraceRunner({
      nodePath: process.execPath,
      inheritedEnvironment: process.env,
      // Electron's own binary runs Vitest as a plain Node.
      ...(Object.hasOwn(process.versions, 'electron') && {
        extraEnvironment: { ELECTRON_RUN_AS_NODE: '1' },
      }),
      temporaryDirectory: options.temporaryDirectory ?? defaultTemporaryDirectory(),
      logger,
    });
  const jobs = new Map<string, Job>();
  const listeners = new Set<(event: TraceStatusView) => void>();
  let isDisposed = false;

  const notify = (event: TraceStatusView): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        logger.warn('trace listener failed', { error });
      }
    }
  };

  const stop = (job: Job, reason: StopReason): void => {
    if (job.controller.signal.aborted) {
      return;
    }

    logger.info('trace probe aborted', { runId: job.runId, reason });
    job.controller.abort(reason);
  };

  const stopMessage = (job: Job): string => describeStop(job.controller.signal);

  const plan = async (
    filePath: string,
    source: string,
    changedLines: ReadonlySet<number>,
  ): Promise<Result<InstrumentationPlan, Failed>> => {
    const planned = await parse(
      filePath,
      source,
      (root, language): Result<InstrumentationPlan, Failed> => {
        const rules = traceRulesByLanguage[language];
        if (rules === undefined) {
          return err(unsupportedLanguage(filePath));
        }
        const made = planInstrumentation(root, { path: filePath, changedLines }, rules);
        if (made.ok) {
          return made;
        }
        return err(
          made.error.kind === 'no-function'
            ? failed(
                'no-function-at-line',
                `No function with a body encloses the change in ${filePath}.`,
              )
            : failed(
                'too-large',
                `The functions around this change have more than ${String(made.error.probeLimit)} places to trace.`,
              ),
        );
      },
    );
    if (planned.ok) {
      return planned.value;
    }
    switch (planned.error.kind) {
      case 'unsupported-language': {
        return err(unsupportedLanguage(filePath));
      }
      case 'too-large': {
        return err(failed('too-large', `${filePath} is too large to analyse.`));
      }
      case 'load-failed': {
        logger.error('trace parse failed', { error: planned.error });
        return err(failed('runner-failed', 'The syntax parser could not be loaded.'));
      }
    }
  };

  const execute = async (
    job: Job,
    diff: ReviewDiff,
    request: { path: string; line: number; testNamePattern?: string | undefined },
    onRunning: (testFiles: readonly string[]) => void,
  ): Promise<Outcome> => {
    const { session, repository } = diff.refreshed;
    const aborted = (): Outcome => failed('cancelled', stopMessage(job));
    const approval = await trust.status(repository);
    if (!approval.trusted) {
      return {
        ...failed('untrusted', 'This repository has not been approved to run its tests.'),
        repositoryPath: approval.repositoryPath,
      };
    }
    const filePath = toRepositoryRelativePath(repository, request.path);
    const headSha = session.headSha;
    const search = await findTestFiles(repository, headSha, filePath);
    if (hasStopped(job)) {
      return aborted();
    }
    if (!search.ok) {
      gitFailure(logger, search.error);
      return failed('runner-failed', 'git could not list the head commit.');
    }
    if (search.value.objectId === undefined) {
      return failed('file-unavailable', `${filePath} does not exist at the head.`);
    }
    const blobs = await readBlobs(repository, [{ objectId: search.value.objectId }]);
    const blob = blobs.ok ? blobs.value.get(search.value.objectId) : undefined;
    if (blob?.kind !== 'text') {
      return failed('file-unavailable', `${filePath} has no readable text at the head.`);
    }
    const file = diff.files.find((candidate) => headPathOf(candidate) === filePath);
    const planned = await plan(filePath, blob.text, toHunkChangedLines(file, request.line));
    if (!planned.ok) {
      return planned.error;
    }
    const testFiles = search.value.selections.map((selection) => selection.path);
    if (testFiles.length === 0) {
      return failed(
        'no-tests-found',
        `No test file is named after ${filePath} or imports it. Name one beside it, like ${suggestTestName(filePath)}.`,
      );
    }
    const worktree = await worktrees.ensure(repository, session.id, headSha);
    if (hasStopped(job)) {
      return aborted();
    }
    if (!worktree.ok) {
      gitFailure(logger, worktree.error);
      return failed('runner-failed', 'The head checkout could not be made.');
    }
    onRunning(testFiles);
    const probed = await runTraceProbe(
      {
        trusted: true,
        worktree: worktree.value,
        dependencyRoot: repository.root,
        testFiles,
        timeoutMs,
        signal: job.controller.signal,
        plan: planned.value,
        source: blob.text,
        ...(request.testNamePattern !== undefined && { testNamePattern: request.testNamePattern }),
      },
      runner,
    );
    if (!probed.ok) {
      if (probed.error.kind === 'run-failed') {
        logger.warn('trace runner failed', { error: probed.error });
      }
      return { ...describeTraceError(probed.error, stopMessage(job)), kind: 'failed' };
    }
    const result = toTraceResultView(probed.value, { headSha: session.headSha, testFiles });
    return {
      kind: 'done',
      result,
      testsFailed: result.timelines.some((timeline) => timeline.status === 'failed'),
    };
  };

  /** Registers the session's job and starts it, or refuses while another is in flight. */
  const launch = async (
    request: {
      sessionId: string;
      path: string;
      line: number;
      testNamePattern?: string | undefined;
    },
    onRunning?: (job: Job, testFiles: readonly string[]) => void,
  ): Promise<Result<Job, IpcError>> => {
    if (isDisposed) {
      return err({ code: 'not-wired', message: 'beuve is quitting' });
    }
    const loaded = loadSession(context, request.sessionId);
    if (!loaded.ok) {
      return loaded;
    }
    const stopping = jobs.get(loaded.value.id);
    if (stopping?.controller.signal.aborted === true) {
      await stopping.outcome;
    }
    if (jobs.has(loaded.value.id)) {
      return busy();
    }
    const diff = await loadReviewDiff(context, loaded.value.id);
    if (!diff.ok) {
      return diff;
    }
    if (jobs.has(loaded.value.id)) {
      return busy();
    }
    const job: Job = {
      sessionId: loaded.value.id,
      runId: context.deps.newId(),
      headSha: diff.value.refreshed.session.headSha,
      controller: new AbortController(),
      outcome: Promise.resolve(failed('runner-failed', 'not started')),
    };
    jobs.set(job.sessionId, job);
    job.outcome = (async (): Promise<Outcome> => {
      try {
        return await execute(job, diff.value, request, (testFiles) => {
          onRunning?.(job, testFiles);
        });
      } catch (error: unknown) {
        logger.error('trace probe failed unexpectedly', { error });
        return failed('runner-failed', "The probe failed unexpectedly; see beuve's log.");
      } finally {
        if (jobs.get(job.sessionId) === job) {
          jobs.delete(job.sessionId);
        }
      }
    })();
    return ok(job);
  };

  const repositoryOf = async (
    sessionId: string,
  ): Promise<Result<ReviewDiff['refreshed'], IpcError>> => {
    const diff = await loadReviewDiff(context, sessionId);
    return diff.ok ? ok(diff.value.refreshed) : diff;
  };

  return {
    run: async (request): Promise<IpcResult<TraceRunStartedView>> => {
      const echo = (
        job: Job,
      ): { sessionId: string; runId: string; path: string; line: number } => ({
        sessionId: job.sessionId,
        runId: job.runId,
        path: request.path,
        line: request.line,
      });
      const launched = await launch(request, (job, testFiles) => {
        notify({ ...echo(job), state: 'running', testFiles });
      });
      if (!launched.ok) {
        return launched;
      }
      const job = launched.value;
      void (async (): Promise<void> => {
        notify(toStatus(echo(job), await job.outcome));
      })();
      return ok({ runId: job.runId });
    },

    probe: async (input): Promise<Result<TraceProbeOutput, TraceProbeFailure>> => {
      const launched = await launch(input);
      if (!launched.ok) {
        return err({ failure: 'runner-failed', message: launched.error.message });
      }
      const outcome = await launched.value.outcome;
      if (outcome.kind === 'failed') {
        return err({ failure: outcome.failure, message: outcome.message });
      }
      return ok({
        sessionId: launched.value.sessionId,
        result: outcome.result,
        testsFailed: outcome.testsFailed,
      });
    },

    cancel: ({ sessionId }): IpcResult<TraceCancelledView> => {
      const job = jobs.get(sessionId);
      if (job === undefined) {
        return ok({ cancelled: false });
      }
      stop(job, 'cancelled');
      return ok({ cancelled: true });
    },

    getTrust: async ({ sessionId }): Promise<IpcResult<TraceTrustView>> => {
      const refreshed = await repositoryOf(sessionId);
      return refreshed.ok ? ok(await trust.status(refreshed.value.repository)) : refreshed;
    },

    setTrust: async ({ sessionId, trusted }): Promise<IpcResult<TraceTrustView>> => {
      const refreshed = await repositoryOf(sessionId);
      if (!refreshed.ok) {
        return refreshed;
      }
      const { repository } = refreshed.value;
      return ok(trusted ? await trust.grant(repository) : await trust.revoke(repository));
    },

    observeHead: (sessionId, headSha): void => {
      const job = jobs.get(sessionId);
      if (job !== undefined && job.headSha !== headSha) {
        stop(job, 'head-changed');
      }
    },

    onStatus: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    dispose: async (): Promise<void> => {
      isDisposed = true;
      const running = Array.from(jobs.values(), async (job) => {
        stop(job, 'app-quit');
        await job.outcome;
      });
      await Promise.all(running);
    },
  };
}

function toStatus(
  echo: { sessionId: string; runId: string; path: string; line: number },
  outcome: Outcome,
): TraceStatusView {
  if (outcome.kind === 'done') {
    return outcome.testsFailed
      ? {
          ...echo,
          state: 'failed',
          failure: 'test-failed-with-trace',
          message: 'Some of the tests failed; the trace shows what ran.',
          result: outcome.result,
        }
      : { ...echo, state: 'completed', result: outcome.result };
  }
  return {
    ...echo,
    state: 'failed',
    failure: outcome.failure,
    message: outcome.message,
    ...(outcome.repositoryPath !== undefined && { repositoryPath: outcome.repositoryPath }),
  };
}

function busy(): Result<never, IpcError> {
  return err({
    code: 'refused',
    message: 'A trace probe is already running for this session. Cancel it or wait for it.',
  });
}

function unsupportedLanguage(filePath: string): Failed {
  return {
    kind: 'failed',
    failure: 'unsupported-language',
    message: `Trace probes cover TypeScript and JavaScript; ${filePath} is neither.`,
  };
}

function suggestTestName(filePath: string): string {
  const { dir, name, ext } = path.posix.parse(filePath);
  return path.posix.join(dir, `${name}.test${ext}`);
}

function headPathOf(file: ReviewDiff['files'][number]): string {
  return 'newPath' in file ? file.newPath : file.path;
}

function failed(failure: TraceFailureKind, message: string): Failed {
  return { kind: 'failed', failure, message };
}

function hasStopped(job: Job): boolean {
  return job.controller.signal.aborted;
}

function describeStop(signal: AbortSignal): string {
  const reason = String(signal.reason);
  return isStopReason(reason) ? stopMessages[reason] : stopMessages.cancelled;
}

function defaultTemporaryDirectory(): string {
  return path.join(os.tmpdir(), `beuve-trace-${String(os.userInfo().uid)}`);
}

function isStopReason(reason: string): reason is StopReason {
  return stopReasons.has(reason);
}
