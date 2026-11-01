import { constants } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type {
  DependencyInstallRequest,
  DependencyLogView,
  DependencySessionRequest,
  DependencySettingsView,
  DependencySkipRequest,
  DependencyState,
  DependencyStatusView,
  DependencyToolView,
  IpcError,
  IpcResult,
  SetRepositoryDependencySettingsRequest,
  SetToolPathRequest,
} from '#contract/ipc-contract.ts';
import { deleteDependencyInstall } from '#internal/deps/delete-dependency-install.ts';
import type { ToolId } from '#internal/deps/dependency-ecosystem.ts';
import { dependencyInputsIn } from '#internal/deps/dependency-inputs-in.ts';
import type { InstallState } from '#internal/deps/dependency-install.ts';
import { detectInstallUnits } from '#internal/deps/detect-install-units.ts';
import { detectionReadsFrom } from '#internal/deps/detection-reads-from.ts';
import { ecosystemRows } from '#internal/deps/ecosystem-rows.ts';
import { failInterruptedInstalls } from '#internal/deps/fail-interrupted-installs.ts';
import { findDependencyInstall } from '#internal/deps/find-dependency-install.ts';
import { findInstallDecision } from '#internal/deps/find-install-decision.ts';
import { findRepositoryInstallSettings } from '#internal/deps/find-repository-install-settings.ts';
import type { InstallConfig } from '#internal/deps/install-config.ts';
import { listToolPaths } from '#internal/deps/list-tool-paths.ts';
import { mergeInstallConfig } from '#internal/deps/merge-install-config.ts';
import { parseInstallConfig } from '#internal/deps/parse-install-config.ts';
import { planInstall } from '#internal/deps/plan-install.ts';
import type {
  InstallPlan,
  MissingTool,
  ResolvedTool,
  ToolUse,
} from '#internal/deps/plan-install.ts';
import { runInstallStep } from '#internal/deps/run-install-step.ts';
import type { StepFailure } from '#internal/deps/run-install-step.ts';
import { saveDependencyInstall } from '#internal/deps/save-dependency-install.ts';
import { saveInstallDecision } from '#internal/deps/save-install-decision.ts';
import { saveRepositoryInstallSettings } from '#internal/deps/save-repository-install-settings.ts';
import { saveToolPath } from '#internal/deps/save-tool-path.ts';
import type { TreeEntry } from '#internal/deps/tree-entry.ts';
import { unitsToInstall } from '#internal/deps/units-to-install.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { listTreeBlobs } from '#internal/git/list-tree-blobs.ts';
import type { TreeFile } from '#internal/git/list-tree-blobs.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { tailOf } from '#x/text/tail-of.ts';
import { formatDuration } from '#x/time/format-duration.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import type { RepositoryTrust } from '../trust/create-repository-trust.ts';
import type { SessionWorktrees } from '../worktrees/create-session-worktrees.ts';

import { installEnvironmentFrom } from './install-environment-from.ts';
import { InstallSlots } from './install-slots.ts';
import type { ToolchainFinder } from './create-toolchain-finder.ts';

/** Dependency installs in beuve's checkouts, as the renderer and the composition root reach them. */
export interface DependencyServices {
  readonly status: (request: DependencySessionRequest) => Promise<IpcResult<DependencyStatusView>>;
  /** Install (or reinstall) now; also the safeguard's Install for that head. */
  readonly install: (request: DependencyInstallRequest) => Promise<IpcResult<DependencyStatusView>>;
  /** The safeguard's Skip: the checkout stays uninstalled for that head. */
  readonly skip: (request: DependencySkipRequest) => Promise<IpcResult<DependencyStatusView>>;
  readonly cancel: (request: DependencySessionRequest) => Promise<IpcResult<DependencyStatusView>>;
  readonly readLog: (request: DependencySessionRequest) => Promise<IpcResult<DependencyLogView>>;
  readonly getSettings: () => Promise<IpcResult<DependencySettingsView>>;
  readonly setRepositorySettings: (
    request: SetRepositoryDependencySettingsRequest,
  ) => Promise<IpcResult<DependencySettingsView>>;
  readonly setToolPath: (request: SetToolPathRequest) => Promise<IpcResult<DependencySettingsView>>;
  /**
   * Installs for the session's head when its repository is trusted and nothing has run for that
   * checkout: on session open and when trust is granted. Asks at the safeguard instead when the
   * range changes a dependency input. Never rejects.
   */
  readonly ensure: (sessionId: string) => Promise<void>;
  /** Whether the checkout at `checkoutPath` finished an install (trace probes then use it). */
  readonly isInstalled: (checkoutPath: string) => boolean;
  /** Forgets a checkout's install: it was checked out afresh or removed. */
  readonly forget: (checkoutPath: string) => void;
  /** A session's head moved: an install only it waited for, at another commit, is stopped. */
  readonly observeHead: (sessionId: string, headSha: CommitSha) => void;
  readonly onStatus: (listener: (event: DependencyStatusView) => void) => () => void;
  /** Stops every install and waits for their processes. */
  readonly dispose: () => Promise<void>;
}

export interface DependencyServicesOptions {
  readonly context: SessionContext;
  readonly worktrees: SessionWorktrees;
  readonly trust: RepositoryTrust;
  readonly toolchains: ToolchainFinder;
  /** `<userData>/deps`: `cache/`, `logs/` and `corepack/` live there, 0700 (ADR 0082). */
  readonly root: string;
  /** Called after an install finished, for restarting the checkout's language servers. */
  readonly onInstalled?: (checkoutPath: string) => Promise<void>;
  /** beuve's own environment, filtered into each install's (`installEnvironmentFrom`). */
  readonly inheritedEnvironment: Readonly<Record<string, string | undefined>>;
  /** Default timeout of a whole install, unless the configuration sets one. 15 min. */
  readonly timeout?: Temporal.Duration;
  /** Between SIGTERM and SIGKILL of a stopped step. 5 s. */
  readonly killGrace?: Temporal.Duration;
  readonly limits?: { readonly perRepository: number; readonly overall: number };
}

/** An install in flight for one checkout, shared by every session that waits for it. */
interface Job {
  readonly checkoutPath: string;
  readonly repoPath: string;
  readonly commit: CommitSha;
  readonly controller: AbortController;
  readonly waiters: Set<string>;
  state: 'pending' | 'running';
  step: string | undefined;
  tools: readonly ToolUse[];
  done: Promise<void>;
}

/** A session's repository and head, with the checkout path and trust that go with them. */
interface SessionHead {
  readonly sessionId: string;
  readonly headSha: CommitSha;
  readonly repository: GitRepository;
  readonly repositoryPath: string;
  readonly checkoutPath: string;
  readonly trusted: boolean;
}

/** What starts an install, and for which session head. */
interface InstallTrigger {
  readonly head: SessionHead;
  /** The reviewer asked (Install, Reinstall, the safeguard's Install). */
  readonly isExplicit: boolean;
  readonly isReinstall: boolean;
}

const defaultTimeout = Temporal.Duration.from({ minutes: 15 });
const tailLength = 4000;
const maxLogRead = 512 * 1024;

/**
 * Installs a reviewed repository's dependencies directly in beuve's per-commit checkout, as in
 * a clone (ADR 0089): detection from the head's tree, the trust grant (ADR 0090), the lockfile
 * safeguard, `.beuve/` configuration (ADR 0092), toolchains (corepack for Node, ADR 0091; host
 * discovery for the rest), one install per checkout shared by the sessions at that commit,
 * slots (one per repository, two in all), a timeout, and a log per checkout.
 */
export function createDependencyServices(options: DependencyServicesOptions): DependencyServices {
  const { context, worktrees, trust, toolchains } = options;
  const { db, logger } = context;
  const jobs = new Map<string, Job>();
  const listeners = new Set<(event: DependencyStatusView) => void>();
  const slots = new InstallSlots(options.limits ?? { perRepository: 1, overall: 2 });
  const cacheRoot = path.join(options.root, 'cache');
  const logRoot = path.join(options.root, 'logs');
  let isDisposed = false;
  failInterruptedInstalls(db, now());

  const logPathOf = (checkoutPath: string): string => {
    const commit = path.basename(checkoutPath);
    const repository = path.basename(path.dirname(checkoutPath));
    return path.join(logRoot, repository, `${commit}.log`);
  };

  const headOf = async (sessionId: string): Promise<Result<SessionHead, IpcError>> => {
    const loaded = loadSession(context, sessionId);
    if (!loaded.ok) {
      return loaded;
    }
    const refreshed = await refreshSession(context, loaded.value);
    if (!refreshed.ok) {
      return refreshed;
    }
    const { repository, session } = refreshed.value;
    const [granted, checkout] = await Promise.all([
      trust.status(repository),
      worktrees.checkoutPath(repository, session.headSha),
    ]);
    if (!checkout.ok) {
      return err({ code: 'git-failed', message: 'beuve could not place the head checkout.' });
    }
    return ok({
      sessionId: session.id,
      headSha: session.headSha,
      repository,
      repositoryPath: granted.repositoryPath,
      checkoutPath: checkout.value,
      trusted: granted.trusted,
    });
  };

  /** The reviewed range's dependency inputs, when the safeguard is on for the repository. */
  const guardedInputs = async (head: SessionHead): Promise<readonly string[]> => {
    const settings = findRepositoryInstallSettings(db, head.repositoryPath);
    if (!settings.safeguard) {
      return [];
    }
    const diff = await loadReviewDiff(context, head.sessionId, { headSha: head.headSha });
    if (!diff.ok) {
      logger.warn('deps: could not read the reviewed range for the safeguard', {
        error: diff.error,
      });
      return ['(the reviewed range could not be read)'];
    }
    const paths = diff.value.files.flatMap((file): string[] => {
      if ('newPath' in file) {
        return [file.oldPath, file.newPath];
      }
      return [file.path];
    });
    return dependencyInputsIn(paths);
  };

  const viewOf = async (head: SessionHead): Promise<DependencyStatusView> => {
    const base = {
      sessionId: head.sessionId,
      headSha: head.headSha,
      repositoryPath: head.repositoryPath,
    };
    const hasLog = await isPresent(logPathOf(head.checkoutPath));
    const shaped = (
      state: DependencyState,
      extra: Partial<DependencyStatusView> = {},
    ): DependencyStatusView => {
      return { ...base, state, tools: [], inputs: [], hasLog, ...extra };
    };
    if (!head.trusted) {
      return shaped('untrusted');
    }
    const job = jobs.get(head.checkoutPath);
    if (job !== undefined) {
      return shaped(job.state, {
        tools: toolViewsFrom(job.tools),
        ...(job.step !== undefined && { detail: job.step }),
      });
    }
    const stored = findDependencyInstall(db, head.checkoutPath);
    if (stored?.state === 'done') {
      if (stored.tools.length === 0 && stored.reason !== undefined) {
        return shaped('nothing', { detail: stored.reason });
      }
      return shaped('done', { tools: toolViewsFrom(stored.tools) });
    }
    const decision = findInstallDecision(db, head);
    if (decision?.decision === 'decline') {
      return shaped('declined', { inputs: decision.inputs });
    }
    if (decision === undefined && stored?.state !== 'failed') {
      const inputs = await guardedInputs(head);
      if (inputs.length > 0) {
        return shaped('needs-approval', { inputs });
      }
    }
    if (stored?.state === 'failed') {
      return shaped('failed', {
        tools: toolViewsFrom(stored.tools),
        ...(stored.reason !== undefined && { detail: stored.reason }),
      });
    }
    return shaped('not-installed');
  };

  const notify = async (head: SessionHead): Promise<void> => {
    const view = await viewOf(head);
    for (const listener of listeners) {
      try {
        listener(view);
      } catch (error: unknown) {
        logger.warn('deps listener failed', { error });
      }
    }
  };

  const notifyWaiters = async (job: Job): Promise<void> => {
    for (const sessionId of job.waiters) {
      const head = await headOf(sessionId);
      if (head.ok && head.value.checkoutPath === job.checkoutPath) {
        await notify(head.value);
      }
    }
  };

  const store = (job: Job, outcome: StoredOutcome): void => {
    saveDependencyInstall(db, {
      checkoutPath: job.checkoutPath,
      repoPath: job.repoPath,
      commitSha: job.commit,
      state: outcome.state,
      tools: job.tools,
      reason: outcome.reason,
      logTail: outcome.logTail ?? '',
      updatedAt: now(),
    });
  };

  const run = async (job: Job, head: SessionHead): Promise<void> => {
    const { signal } = job.controller;
    store(job, { state: 'pending', reason: undefined });
    await notifyWaiters(job);
    using stack = new DisposableStack();
    const slot = await slots.acquire(job.repoPath, signal);
    if (slot === 'aborted') {
      store(job, { state: 'failed', reason: stopMessage(signal) });
      return;
    }
    stack.use(slot);
    const leased = await worktrees.acquire(
      head.repository,
      { kind: 'session-head', sessionId: head.sessionId, headSha: head.headSha },
      { signal },
    );
    if (!leased.ok) {
      store(job, { state: 'failed', reason: leaseFailure(leased.error.kind, signal) });
      return;
    }
    stack.use(leased.value);
    job.state = 'running';
    store(job, { state: 'running', reason: undefined });
    await notifyWaiters(job);
    const planned = await planFor({ job, head, checkout: leased.value.path });
    if (!planned.ok) {
      store(job, { state: planned.error.state, reason: planned.error.reason });
      return;
    }
    if (planned.value.steps.length === 0) {
      store(job, { state: 'done', reason: 'Nothing to install: no lockfile, step or hook.' });
      return;
    }
    job.tools = planned.value.tools;
    const executed = await execute({ job, plan: planned.value, checkout: leased.value.path });
    store(job, executed);
    if (executed.state === 'done') {
      await options.onInstalled?.(job.checkoutPath);
    }
  };

  const planFor = async ({
    job,
    head,
    checkout,
  }: PlanRequest): Promise<Result<InstallPlan, StoredOutcome>> => {
    const listing = await listTreeBlobs(head.repository, head.headSha);
    if (!listing.ok) {
      return err({ state: 'failed', reason: 'git could not list the head commit.' });
    }
    const entries: TreeEntry[] = listing.value.map((file) => {
      return { path: file.path, mode: file.mode };
    });
    const texts = await readTexts(head.repository, {
      files: listing.value,
      wanted: [...detectionReadsFrom(entries), '.beuve/config.json'],
    });
    const config = configFor({ texts, repositoryPath: head.repositoryPath });
    if (!config.ok) {
      return err({ state: 'failed', reason: config.error });
    }
    const detected = detectInstallUnits({ entries, contents: texts });
    const hookEntry = listing.value.find((file) => file.path === '.beuve/hooks/install');
    let hook: string | undefined;
    if (hookEntry?.mode === '100755') {
      hook = path.join(checkout, '.beuve', 'hooks', 'install');
    }
    const units = unitsToInstall(detected.units, config.value);
    const environment = installEnvironmentFrom({
      inherited: options.inheritedEnvironment,
      login: await toolchains.environment(),
      beuve: {
        PATH: await toolchains.searchPath(),
        BEUVE_CHECKOUT: checkout,
        BEUVE_HEAD_SHA: head.headSha,
        BEUVE_SESSION_ID: head.sessionId,
        BEUVE_REPOSITORY: head.repository.root,
        BEUVE_DEPS_CACHE: cacheRoot,
        COREPACK_HOME: path.join(options.root, 'corepack'),
      },
    });
    const tools = new Map<ToolId, ResolvedTool>();
    for (const unit of units) {
      if (tools.has(unit.tool)) {
        continue;
      }
      const found = await findTool({
        tool: unit.tool,
        cwd: path.join(checkout, unit.directory),
        env: environment,
      });
      if (found !== undefined) {
        tools.set(unit.tool, found);
      }
    }
    job.tools = Array.from(tools.values(), (tool) => {
      return { tool: tool.executable, version: tool.version };
    });
    const planned = planInstall({
      units: detected.units,
      config: config.value,
      hook,
      tools,
      cacheRoot,
      env: environment,
    });
    if (!planned.ok) {
      return err({ state: 'failed', reason: describeMissing(planned.error) });
    }
    return planned;
  };

  const findTool = async ({ tool, cwd, env }: ToolLookup): Promise<ResolvedTool | undefined> => {
    const row = ecosystemRows.find((candidate) => candidate.tool === tool);
    const candidates = row?.candidates ?? [];
    for (const candidate of candidates) {
      const found = await toolchains.find({ candidate, cwd, env });
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };

  const configFor = ({ texts, repositoryPath }: ConfigRequest): Result<InstallConfig, string> => {
    let checkout: InstallConfig | undefined;
    const fileText = texts.get('.beuve/config.json');
    if (fileText !== undefined) {
      const parsed = parseInstallConfig({ text: fileText, source: '.beuve/config.json' });
      if (!parsed.ok) {
        return parsed;
      }
      checkout = parsed.value;
    }
    let override: InstallConfig | undefined;
    const overrideText = findRepositoryInstallSettings(db, repositoryPath).override;
    if (overrideText !== undefined) {
      const parsed = parseInstallConfig({ text: overrideText, source: 'the Settings override' });
      if (!parsed.ok) {
        return parsed;
      }
      override = parsed.value;
    }
    return ok(mergeInstallConfig({ checkout, override }));
  };

  const execute = async ({ job, plan, checkout }: Execution): Promise<StoredOutcome> => {
    const logPath = logPathOf(job.checkoutPath);
    await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    for (const row of ecosystemRows) {
      await mkdir(path.join(cacheRoot, row.cache), { recursive: true, mode: 0o700 });
    }
    await mkdir(path.join(options.root, 'corepack'), { recursive: true, mode: 0o700 });
    await using log = await openLog(logPath);
    let tail = '';
    let writing = Promise.resolve();
    /** Appends to the log in order; `await writing` waits for everything appended so far. */
    const append = (text: string): void => {
      tail = tailOf(tail + text, tailLength);
      const previous = writing;
      writing = (async (): Promise<void> => {
        await previous;
        try {
          await log.write(text);
        } catch (error: unknown) {
          logger.warn('deps: could not write the install log', { error: errorFrom(error) });
        }
      })();
    };
    const deadline = timeoutSignal(options.timeout ?? defaultTimeout);
    const signal = AbortSignal.any([job.controller.signal, deadline]);
    const stopwatch = new Stopwatch();
    append(`beuve install of ${job.commit} in ${checkout}\n`);
    for (const step of plan.steps) {
      job.step = step.label;
      await notifyWaiters(job);
      append(`\n$ ${step.argv.join(' ')}    # ${step.label}, in ./${step.cwd}\n`);
      const ran = await runInstallStep({
        step,
        checkout,
        signal,
        ...(options.killGrace !== undefined && { killGrace: options.killGrace }),
        onOutput: append,
      });
      if (!ran.ok) {
        const reason = describeStepFailure({ failure: ran.error, label: step.label, deadline });
        append(`\n${reason}\n`);
        await writing;
        return { state: 'failed', reason, logTail: tail };
      }
    }
    append(`\nInstalled in ${formatDuration(stopwatch.elapsed())}.\n`);
    await writing;
    return { state: 'done', reason: undefined, logTail: tail };
  };

  const start = (trigger: InstallTrigger): void => {
    const { head } = trigger;
    const running = jobs.get(head.checkoutPath);
    if (running !== undefined) {
      running.waiters.add(head.sessionId);
      return;
    }
    const job: Job = {
      checkoutPath: head.checkoutPath,
      repoPath: head.repositoryPath,
      commit: head.headSha,
      controller: new AbortController(),
      waiters: new Set([head.sessionId]),
      state: 'pending',
      step: undefined,
      tools: [],
      done: Promise.resolve(),
    };
    jobs.set(job.checkoutPath, job);
    logger.info('deps: install starting', {
      checkout: job.checkoutPath,
      reinstall: trigger.isReinstall,
    });
    job.done = (async (): Promise<void> => {
      try {
        await run(job, head);
      } catch (error: unknown) {
        logger.error('deps: install failed unexpectedly', { error: errorFrom(error) });
        store(job, {
          state: 'failed',
          reason: "The install failed unexpectedly; see beuve's log.",
        });
      } finally {
        jobs.delete(job.checkoutPath);
        job.step = undefined;
        await notifyWaiters(job);
      }
    })();
  };

  /** Decides what a trigger does; answers the session head's view afterwards. */
  const consider = async (trigger: InstallTrigger): Promise<DependencyStatusView> => {
    const { head } = trigger;
    if (isDisposed || !head.trusted) {
      return viewOf(head);
    }
    if (jobs.has(head.checkoutPath)) {
      start(trigger);
      return viewOf(head);
    }
    const stored = findDependencyInstall(db, head.checkoutPath);
    if (stored !== undefined && !trigger.isExplicit && stored.state !== 'declined') {
      return viewOf(head);
    }
    if (stored?.state === 'done' && !trigger.isReinstall) {
      return viewOf(head);
    }
    const decision = findInstallDecision(db, head);
    if (trigger.isExplicit) {
      const inputs = await guardedInputs(head);
      if (inputs.length > 0) {
        saveInstallDecision(db, {
          sessionId: head.sessionId,
          headSha: head.headSha,
          decision: 'install',
          inputs,
          decidedAt: now(),
        });
      }
    } else if (decision?.decision === 'decline') {
      return viewOf(head);
    } else if (decision === undefined) {
      const inputs = await guardedInputs(head);
      if (inputs.length > 0) {
        logger.info('deps: the safeguard asks before installing', { inputs });
        const view = await viewOf(head);
        await notify(head);
        return view;
      }
    }
    start(trigger);
    return viewOf(head);
  };

  const withHead = async <T>(
    sessionId: string,
    use: (head: SessionHead) => Promise<IpcResult<T>>,
  ): Promise<IpcResult<T>> => {
    const head = await headOf(sessionId);
    if (!head.ok) {
      return head;
    }
    return use(head.value);
  };

  const settingsView = async (): Promise<DependencySettingsView> => {
    const trusted = await trust.list();
    const toolPaths = listToolPaths(db);
    return {
      repositories: trusted.map((entry) => {
        const settings = findRepositoryInstallSettings(db, entry.repositoryPath);
        return {
          repositoryPath: entry.repositoryPath,
          safeguard: settings.safeguard,
          override: settings.override ?? '',
        };
      }),
      toolPaths: Array.from(toolPaths, ([executable, directory]) => {
        return { executable, directory };
      }),
      executables: [
        ...new Set(
          ecosystemRows.flatMap((row) => {
            return row.candidates.map((entry) => entry.executable);
          }),
        ),
      ].toSorted((left, right) => left.localeCompare(right)),
    };
  };

  return {
    status: async ({ sessionId }): Promise<IpcResult<DependencyStatusView>> => {
      return withHead(sessionId, async (head) => {
        return ok(await viewOf(head));
      });
    },
    install: async ({
      sessionId,
      expectedHeadSha,
      reinstall,
    }): Promise<IpcResult<DependencyStatusView>> => {
      return withHead(sessionId, async (head) => {
        if (head.headSha !== expectedHeadSha) {
          return staleHead();
        }
        if (!head.trusted) {
          return err({ code: 'refused', message: 'Trust this repository first.' });
        }
        return ok(await consider({ head, isExplicit: true, isReinstall: reinstall }));
      });
    },
    skip: async ({ sessionId, expectedHeadSha }): Promise<IpcResult<DependencyStatusView>> => {
      return withHead(sessionId, async (head) => {
        if (head.headSha !== expectedHeadSha) {
          return staleHead();
        }
        saveInstallDecision(db, {
          sessionId: head.sessionId,
          headSha: head.headSha,
          decision: 'decline',
          inputs: await guardedInputs(head),
          decidedAt: now(),
        });
        await notify(head);
        return ok(await viewOf(head));
      });
    },
    cancel: async ({ sessionId }): Promise<IpcResult<DependencyStatusView>> => {
      return withHead(sessionId, async (head) => {
        const job = jobs.get(head.checkoutPath);
        if (job !== undefined && !job.controller.signal.aborted) {
          logger.info('deps: install cancelled', { checkout: job.checkoutPath });
          job.controller.abort('cancelled');
          await job.done;
        }
        return ok(await viewOf(head));
      });
    },
    readLog: async ({ sessionId }): Promise<IpcResult<DependencyLogView>> => {
      return withHead(sessionId, async (head) => {
        const read = await readLogTail(logPathOf(head.checkoutPath));
        if (read === undefined) {
          return err({ code: 'not-found', message: 'No install has run for this checkout yet.' });
        }
        return ok({ sessionId: head.sessionId, headSha: head.headSha, ...read });
      });
    },
    getSettings: async (): Promise<IpcResult<DependencySettingsView>> => {
      return ok(await settingsView());
    },
    setRepositorySettings: async ({
      repositoryPath,
      safeguard,
      override,
    }): Promise<IpcResult<DependencySettingsView>> => {
      const text = override.trim();
      if (text !== '') {
        const parsed = parseInstallConfig({ text, source: 'The override' });
        if (!parsed.ok) {
          return err({ code: 'invalid-request', message: parsed.error });
        }
      }
      saveRepositoryInstallSettings(db, { repoPath: repositoryPath, safeguard, override: text });
      return ok(await settingsView());
    },
    setToolPath: async ({ executable, directory }): Promise<IpcResult<DependencySettingsView>> => {
      if (directory !== '' && !path.isAbsolute(directory)) {
        return err({ code: 'invalid-request', message: 'The directory must be an absolute path.' });
      }
      saveToolPath(db, { executable, directory });
      return ok(await settingsView());
    },
    ensure: async (sessionId): Promise<void> => {
      try {
        const head = await headOf(sessionId);
        if (head.ok) {
          await consider({ head: head.value, isExplicit: false, isReinstall: false });
        }
      } catch (error: unknown) {
        logger.warn('deps: could not consider an install', { error: errorFrom(error) });
      }
    },
    isInstalled: (checkoutPath): boolean => {
      const stored = findDependencyInstall(db, checkoutPath);
      return stored?.state === 'done' && stored.tools.length > 0 && !jobs.has(checkoutPath);
    },
    forget: (checkoutPath): void => {
      deleteDependencyInstall(db, checkoutPath);
      void rm(logPathOf(checkoutPath), { force: true });
    },
    observeHead: (sessionId, headSha): void => {
      for (const job of jobs.values()) {
        if (!job.waiters.has(sessionId) || job.commit === headSha) {
          continue;
        }
        job.waiters.delete(sessionId);
        if (job.waiters.size > 0) {
          continue;
        }

        logger.info('deps: no session waits for this install any more', {
          checkout: job.checkoutPath,
        });
        job.controller.abort('head-changed');
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
      const stopping = Array.from(jobs.values(), async (job) => {
        job.controller.abort('app-quit');
        await job.done;
      });
      await Promise.all(stopping);
    },
  };
}

/** What an install ended as, for its row. */
interface StoredOutcome {
  readonly state: InstallState;
  readonly reason: string | undefined;
  readonly logTail?: string;
}

/** An install to plan: its job, the session head it serves, and the leased checkout. */
interface PlanRequest {
  readonly job: Job;
  readonly head: SessionHead;
  readonly checkout: string;
}

/** A planned install to run in its checkout. */
interface Execution {
  readonly job: Job;
  readonly plan: InstallPlan;
  readonly checkout: string;
}

/** A row's tool to find, for a unit's directory and environment. */
interface ToolLookup {
  readonly tool: ToolId;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** The texts read from the head, and the repository whose Settings override applies. */
interface ConfigRequest {
  readonly texts: ReadonlyMap<string, string>;
  readonly repositoryPath: string;
}

/** The head's files, and which of them to read as text. */
interface TextRequest {
  readonly files: readonly TreeFile[];
  readonly wanted: readonly string[];
}

async function readTexts(
  repository: GitRepository,
  { files, wanted }: TextRequest,
): Promise<ReadonlyMap<string, string>> {
  const chosen = files.filter((file) => wanted.includes(file.path) && file.mode !== '120000');
  const blobs = await readBlobs(
    repository,
    chosen.map((file) => {
      return { objectId: file.objectId, mode: file.mode };
    }),
  );
  const texts = new Map<string, string>();
  if (!blobs.ok) {
    return texts;
  }
  for (const file of chosen) {
    const blob = blobs.value.get(file.objectId);
    if (blob?.kind === 'text') {
      texts.set(file.path, blob.text);
    }
  }
  return texts;
}

function toolViewsFrom(tools: readonly ToolUse[]): readonly DependencyToolView[] {
  return tools.map(({ tool, version }) => {
    return { tool, ...(version !== undefined && { version }) };
  });
}

function describeMissing(missing: readonly MissingTool[]): string {
  return missing
    .map((tool) => `${tool.executables.join(' or ')} not found (for ${tool.label}). ${tool.fix}`)
    .join(' ');
}

/** A failed step, its label, and the install's deadline (to tell a timeout from a cancel). */
interface StepOutcome {
  readonly failure: StepFailure;
  readonly label: string;
  readonly deadline: AbortSignal;
}

function describeStepFailure({ failure, label, deadline }: StepOutcome): string {
  switch (failure.kind) {
    case 'exited': {
      if (failure.code === undefined) {
        return `${label} was killed (${failure.signal ?? 'signal'}).`;
      }
      return `${label} exited with code ${String(failure.code)}.`;
    }
    case 'not-started': {
      return `${label} did not start: ${failure.message}`;
    }
    case 'stopped': {
      if (failure.reason === deadline.reason) {
        return `${label} timed out; the install was stopped.`;
      }
      return stopText(failure.reason);
    }
  }
}

function stopMessage(signal: AbortSignal): string {
  return stopText(signal.reason);
}

function stopText(reason: unknown): string {
  if (reason === 'head-changed') {
    return 'Stopped: no open session is at this commit any more.';
  }
  if (reason === 'app-quit') {
    return 'Stopped: beuve quit.';
  }
  return 'Cancelled.';
}

function leaseFailure(kind: string, signal: AbortSignal): string {
  if (signal.aborted) {
    return stopMessage(signal);
  }
  if (kind === 'stale-head') {
    return 'The head moved before the checkout was ready.';
  }
  return 'The head checkout could not be made.';
}

function staleHead(): IpcResult<never> {
  return err({ code: 'stale-review', message: 'The head moved; showing the new commits.' });
}

function now(): string {
  return Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
}

async function openLog(file: string): Promise<FileHandle> {
  return open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await using handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.stat();
    return true;
  } catch {
    return false;
  }
}

/** The log's last part. */
interface LogTail {
  readonly text: string;
  readonly truncated: boolean;
}

async function readLogTail(file: string): Promise<LogTail | undefined> {
  try {
    await using handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxLogRead);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return { text: buffer.toString('utf8'), truncated: start > 0 };
  } catch {
    return undefined;
  }
}
