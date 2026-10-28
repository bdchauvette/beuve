import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type {
  InsightListView,
  InsightStatusChangeView,
  IpcError,
  IpcResult,
  ListInsightsRequest,
  ReviewProgressView,
  ReviewRunErrorView,
  ReviewRunHandleView,
  ReviewRunRequest,
  ReviewRunSummaryView,
  SetInsightStatusRequest,
} from '#contract/ipc-contract.ts';
import { createClaudeCodeModel } from '#internal/llm/create-claude-code-model.ts';
import type { ClaudeCodeModelOptions } from '#internal/llm/create-claude-code-model.ts';
import type { LanguageModel } from '#internal/llm/language-model.ts';
import type { AgentInsightId, CommitSha, SessionId } from '#internal/review/agent-insight.ts';
import { findReviewRun } from '#internal/review/find-review-run.ts';
import { insertReviewRun } from '#internal/review/insert-review-run.ts';
import { listAgentInsights } from '#internal/review/list-agent-insights.ts';
import { listReviewRuns } from '#internal/review/list-review-runs.ts';
import { normalizePathScope } from '#internal/review/normalize-path-scope.ts';
import { replaceReviewRun } from '#internal/review/replace-review-run.ts';
import type { ModelProgress } from '#internal/review/review-model.ts';
import { runPreliminaryReview } from '#internal/review/run-preliminary-review.ts';
import { setAgentInsightStatus } from '#internal/review/set-agent-insight-status.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { ImpactServices } from '../impact/create-impact-services.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';

import { modelErrorToRunError } from './model-error-to-run-error.ts';
import type { AbortReason } from './model-error-to-run-error.ts';
import { resolveClaudeCommand } from './resolve-claude-command.ts';
import { toAgentInsightView } from './to-agent-insight-view.ts';
import { toReviewInput } from './to-review-input.ts';
import { toReviewRunSummary } from './to-review-run-summary.ts';

/** The opt-in preliminary agentic review (spec 5B), as the renderer reaches it (ADR 0022). */
export interface ReviewServices {
  /** Starts, joins or reuses the run for the session's current head; answers at once. */
  readonly run: (request: ReviewRunRequest) => Promise<IpcResult<ReviewRunHandleView>>;
  readonly listInsights: (request: ListInsightsRequest) => Promise<IpcResult<InsightListView>>;
  readonly setInsightStatus: (
    request: SetInsightStatusRequest,
  ) => IpcResult<InsightStatusChangeView>;
  /** Aborts the session's in-flight run if it reviews a head other than `headSha`. */
  readonly observeHead: (sessionId: string, headSha: string) => void;
  /** Subscribes to `review:progress` events; returns the unsubscribe function. */
  readonly onProgress: (listener: (event: ReviewProgressView) => void) => () => void;
  /** Aborts every run and waits until their Claude Code processes are gone. */
  readonly dispose: () => Promise<void>;
}

/** How Claude Code is found and run. Every field has a production default. */
export interface ClaudeCodeSettings {
  /** A fixed executable (tests use Node with the fake script); otherwise resolved per run. */
  readonly command?: string;
  readonly leadingArgs?: readonly string[];
  /** Where `BEUVE_CLAUDE_PATH`, `PATH` and Claude Code's allow-listed variables come from. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
  /** Per run; defaults to the review domain's 10 minutes. */
  readonly timeoutMs?: number;
  readonly model?: string;
  readonly killGraceMs?: number;
}

export interface ReviewServicesOptions {
  readonly context: SessionContext;
  readonly impact: ImpactServices;
  readonly worktrees: SessionWorktrees;
  readonly claude?: ClaudeCodeSettings;
}

interface Job {
  readonly runId: string;
  readonly sessionId: string;
  readonly headSha: string;
  /** The normalized path prefixes the run is limited to; `[]` is the whole change. */
  readonly pathScope: readonly string[];
  readonly controller: AbortController;
  done: Promise<void>;
}

/**
 * Runs the preliminary review in the background (ADR 0019 recipe, ADR 0022 lifecycle): the head is
 * refreshed up front so a run is keyed by (session, head, path scope); a stored run for that key is
 * reused unless `fresh`, an in-flight run with the same key is joined, and a run whose head moves,
 * that a fresh or differently scoped request supersedes (one run in flight per session), or that
 * is running when beuve quits is aborted. Each run builds the same diff `session:get-review` shows,
 * adds the cached ImpactGate findings, checks the head out (ADR 0020), asks Claude Code there and
 * stores the validated insights.
 */
export function createReviewServices(options: ReviewServicesOptions): ReviewServices {
  type RunOutcome = Result<ReviewRunSummaryView, ReviewRunErrorView>;
  const { context, impact, worktrees } = options;
  const { db, logger } = context;
  const claude = options.claude ?? {};
  const env = claude.env ?? process.env;
  const jobs = new Map<string, Job>();
  const listeners = new Set<(event: ReviewProgressView) => void>();
  let isDisposed = false;

  const publish = (event: ReviewProgressView): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        logger.warn('review progress listener failed', { error });
      }
    }
  };

  const abort = (job: Job, reason: AbortReason): void => {
    if (job.controller.signal.aborted) {
      return;
    }

    logger.info('review run aborted', { runId: job.runId, reason });
    job.controller.abort(reason);
  };

  const observeHead = (sessionId: string, headSha: string): void => {
    const job = jobs.get(sessionId);
    if (job !== undefined && job.headSha !== headSha) {
      abort(job, 'head-changed');
    }
  };

  const resolveModel = async (
    request: ReviewRunRequest,
  ): Promise<Result<LanguageModel, ReviewRunErrorView>> => {
    let { command } = claude;
    if (command === undefined) {
      const resolved = await resolveClaudeCommand({
        env,
        homeDirectory: claude.homeDirectory ?? os.homedir(),
        platform: process.platform,
        isExecutable,
      });
      if (resolved.kind === 'missing') {
        return err({ code: 'not-installed', message: resolved.message });
      }
      command = resolved.command;
    }
    const modelOptions: ClaudeCodeModelOptions = {
      command,
      logger,
      inheritedEnv: env,
      ...(claude.leadingArgs !== undefined && { leadingArgs: claude.leadingArgs }),
      ...(claude.model !== undefined && { model: claude.model }),
      ...(claude.killGraceMs !== undefined && { killGraceMs: claude.killGraceMs }),
      ...(request.effort !== undefined && { effort: request.effort }),
      // A GUI app's PATH may lack the directory of the `node` an npm-installed `claude` needs.
      ...(path.isAbsolute(command) && {
        extraEnv: { PATH: withDirectory(path.dirname(command), env['PATH']) },
      }),
    };
    return ok(createClaudeCodeModel(modelOptions));
  };

  const review = async (job: Job, request: ReviewRunRequest): Promise<RunOutcome> => {
    const { signal } = job.controller;
    const progress = (message: string): void => {
      publish({ ...identify(job), kind: 'progress', message });
    };
    const isAborted = (): boolean => signal.aborted;
    const stopped = (): RunOutcome =>
      err(modelErrorToRunError({ kind: 'cancelled' }, signal.reason as AbortReason));

    progress('Building the review diff');
    const diff = await loadReviewDiff(context, job.sessionId);
    if (isAborted()) {
      return stopped();
    }
    if (!diff.ok) {
      return err({ code: 'review-unavailable', message: diff.error.message });
    }
    const { refreshed, scope } = diff.value;
    if (refreshed.session.headSha !== job.headSha) {
      abort(job, 'head-changed');
      return stopped();
    }
    if (scope.kind === 'up-to-date') {
      return err({
        code: 'nothing-to-review',
        message: 'Everything up to the head is marked reviewed: there is nothing to review.',
      });
    }
    const pathPrefixes = job.pathScope;
    const impactView = await impact.getImpact({ sessionId: job.sessionId });
    const findings =
      impactView.ok && impactView.value.headSha === job.headSha
        ? impactView.value.findings
        : undefined;
    progress(`Checking out ${job.headSha.slice(0, 8)}`);
    const worktree = await worktrees.ensure(
      refreshed.repository,
      job.sessionId,
      refreshed.session.headSha,
    );
    if (isAborted()) {
      return stopped();
    }
    if (!worktree.ok) {
      return err({
        code: 'review-unavailable',
        message: gitFailure(logger, worktree.error).error.message,
      });
    }
    const input = toReviewInput({
      diff: diff.value,
      worktreePath: worktree.value,
      pathPrefixes,
      impactFindings: findings,
    });
    if (input.files.length === 0) {
      return err({
        code: 'nothing-to-review',
        message: `No changed file is under ${pathPrefixes.join(', ')}.`,
      });
    }
    const model = await resolveModel(request);
    if (!model.ok) {
      return model;
    }
    progress(`Claude Code is reviewing ${plural(input.files.length, 'file')}`);
    let toolUses = 0;
    const onProgress = (event: ModelProgress): void => {
      if (event.kind === 'started') {
        progress(`Claude Code started (${event.model ?? 'default model'})`);
        return;
      }
      toolUses += 1;
      progress(`Claude Code is reading the worktree (${plural(toolUses, 'tool call')})`);
    };
    const reviewed = await runPreliminaryReview(input, {
      model: model.value,
      clock: context.deps.now,
      ids: context.deps.newId,
      signal,
      onProgress,
      ...(claude.timeoutMs !== undefined && { timeoutMs: claude.timeoutMs }),
    });
    if (isAborted()) {
      return stopped();
    }
    if (!reviewed.ok) {
      return err(modelErrorToRunError(reviewed.error));
    }
    const { run, insights } = reviewed.value;
    const stored =
      request.fresh === true
        ? replaceReviewRun(db, run, insights)
        : insertReviewRun(db, run, insights);
    if (!stored.ok) {
      logger.warn('review run not stored', { error: stored.error });
      return err({
        code: 'review-unavailable',
        message:
          stored.error.kind === 'duplicate-run'
            ? 'Another run for this head was stored first; run /review to see it.'
            : 'The session no longer exists.',
      });
    }
    logger.info('review run stored', {
      runId: run.id,
      insights: run.insightCount,
      dropped: run.droppedCount,
      files: input.files.length,
    });
    return ok(
      toReviewRunSummary(run, {
        review: reviewed.value,
        fileCount: input.files.length,
        pathPrefixes,
      }),
    );
  };

  const start = (
    sessionId: string,
    headSha: string,
    pathScope: readonly string[],
    request: ReviewRunRequest,
  ): Job => {
    const job: Job = {
      runId: context.deps.newId(),
      sessionId,
      headSha,
      pathScope,
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    jobs.set(sessionId, job);
    job.done = (async (): Promise<void> => {
      publish({ ...identify(job), kind: 'started' });
      let outcome: RunOutcome;
      try {
        outcome = await review(job, request);
      } catch (error: unknown) {
        logger.error('review run failed unexpectedly', { error });
        outcome = err({ code: 'model-failed', message: 'internal error' });
      }
      if (jobs.get(sessionId) === job) {
        jobs.delete(sessionId);
      }
      publish(
        outcome.ok
          ? { ...identify(job), kind: 'completed', summary: outcome.value }
          : { ...identify(job), kind: 'failed', error: outcome.error },
      );
    })();
    return job;
  };

  return {
    run: async (request): Promise<IpcResult<ReviewRunHandleView>> => {
      if (isDisposed) {
        return err({ code: 'not-wired', message: 'beuve is quitting' });
      }
      const head = await refreshHead(context, request.sessionId);
      if (!head.ok) {
        return head;
      }
      const { sessionId, headSha } = head.value;
      observeHead(sessionId, headSha);
      const pathScope = normalizePathScope(request.pathPrefixes ?? []);
      const active = jobs.get(sessionId);
      if (
        active !== undefined &&
        request.fresh !== true &&
        hasSameScope(active.pathScope, pathScope)
      ) {
        return ok({ status: 'attached', ...identify(active) });
      }
      if (request.fresh !== true) {
        const stored = findReviewRun(db, sessionId as SessionId, headSha as CommitSha, pathScope);
        if (!stored.ok) {
          return corrupt(context, stored.error);
        }
        if (stored.value !== undefined) {
          return ok({
            status: 'reused',
            runId: stored.value.id,
            sessionId,
            headSha,
            summary: toReviewRunSummary(stored.value),
          });
        }
      }
      if (active !== undefined) {
        abort(active, 'superseded');
      }
      const job = start(sessionId, headSha, pathScope, request);
      return ok({ status: 'started', ...identify(job) });
    },

    listInsights: async ({ sessionId: requested }): Promise<IpcResult<InsightListView>> => {
      const head = await refreshHead(context, requested);
      if (!head.ok) {
        return head;
      }
      const { sessionId, headSha } = head.value;
      observeHead(sessionId, headSha);
      const insights = listAgentInsights(db, sessionId as SessionId, headSha as CommitSha);
      if (!insights.ok) {
        return corrupt(context, insights.error);
      }
      const runs = listReviewRuns(db, sessionId as SessionId, headSha as CommitSha);
      if (!runs.ok) {
        return corrupt(context, runs.error);
      }
      const [newest] = runs.value;
      const active = jobs.get(sessionId);
      return ok({
        sessionId,
        headSha,
        ...(newest !== undefined && { run: toReviewRunSummary(newest) }),
        ...(active?.headSha === headSha && { activeRunId: active.runId }),
        insights: insights.value.map((insight) => toAgentInsightView(insight)),
      });
    },

    setInsightStatus: ({ insightId, status }): IpcResult<InsightStatusChangeView> => {
      const changed = setAgentInsightStatus(db, insightId as AgentInsightId, status);
      return changed.ok
        ? ok({ insightId, status })
        : err({ code: 'not-found', message: 'no such insight' });
    },

    observeHead,

    onProgress: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },

    dispose: async (): Promise<void> => {
      isDisposed = true;
      const stopping = Array.from(jobs.values(), async (job) => {
        abort(job, 'app-quit');
        return job.done;
      });
      await Promise.all(stopping);
    },
  };
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    const stats = await stat(file);
    return stats.isFile();
  } catch {
    return false;
  }
}

function withDirectory(directory: string, searchPath = ''): string {
  const entries = searchPath.split(path.delimiter).filter((entry) => entry !== '');
  return [directory, ...entries.filter((entry) => entry !== directory)].join(path.delimiter);
}

function hasSameScope(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((prefix, index) => prefix === right[index]);
}

function identify(job: Job): { runId: string; sessionId: string; headSha: string } {
  return { runId: job.runId, sessionId: job.sessionId, headSha: job.headSha };
}

async function refreshHead(
  context: SessionContext,
  sessionId: string,
): Promise<Result<{ sessionId: string; headSha: string }, IpcError>> {
  const loaded = loadSession(context, sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const refreshed = await refreshSession(context, loaded.value);
  return refreshed.ok
    ? ok({ sessionId: refreshed.value.session.id, headSha: refreshed.value.session.headSha })
    : refreshed;
}

function corrupt(context: SessionContext, error: unknown): Result<never, IpcError> {
  context.logger.error('review data is corrupt', { error });
  return err({ code: 'internal', message: 'stored review data is corrupt' });
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
