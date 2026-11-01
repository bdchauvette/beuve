import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { PlannedStep } from './plan-install.ts';

/** One step to run, where, and what to do with its output. */
export interface InstallStepRun {
  readonly step: PlannedStep;
  /** The checkout's real path; the step's `cwd` must resolve inside it. */
  readonly checkout: string;
  /** Aborting stops the step (its process group): a cancel, a deadline, or quitting. */
  readonly signal: AbortSignal;
  /** Every chunk of stdout and stderr, decoded as UTF-8, in order. */
  readonly onOutput?: (chunk: string) => void;
  /** Between SIGTERM and SIGKILL. Defaults to 5 s. */
  readonly killGrace?: Temporal.Duration;
}

/** Why a step did not succeed. */
export type StepFailure =
  | {
      readonly kind: 'exited';
      readonly code: number | undefined;
      readonly signal: string | undefined;
    }
  | { readonly kind: 'not-started'; readonly message: string }
  /** The signal aborted; `reason` is its reason, which tells a deadline from a cancel. */
  | { readonly kind: 'stopped'; readonly reason: unknown };

const defaultKillGrace = Temporal.Duration.from({ seconds: 5 });

/**
 * Runs one install step (ADR 0089) without a shell, stdin closed, in its own process group, with
 * exactly `step.env`. An abort is `owned-write` in ADR 0079's terms: SIGTERM to the group, SIGKILL
 * after the grace if anything is left, and the step answers `stopped` once the process has exited.
 * A step whose directory resolves outside the checkout (a committed link) never starts.
 */
export async function runInstallStep(run: InstallStepRun): Promise<Result<undefined, StepFailure>> {
  const { step, signal } = run;
  if (signal.aborted) {
    return err({ kind: 'stopped', reason: signal.reason as unknown });
  }
  const cwd = await containedDirectory({ checkout: run.checkout, relative: step.cwd });
  if (cwd === undefined) {
    return err({
      kind: 'not-started',
      message: `${step.cwd} is not a directory inside the checkout`,
    });
  }
  const [command, ...args] = step.argv;
  if (command === undefined) {
    return err({ kind: 'not-started', message: 'an empty command' });
  }
  const isOwnGroup = process.platform !== 'win32';
  // eslint-disable-next-line local/forward-abort-signal -- the abort listener below signals the whole process group, then SIGKILLs it after a grace; spawn's own signal would reach only the leader.
  const child = spawn(command, args, {
    cwd,
    env: step.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: isOwnGroup,
    shell: false,
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const onOutput = (chunk: string): void => {
    run.onOutput?.(chunk);
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);
  const signalGroup = (name: NodeJS.Signals): void => {
    try {
      if (isOwnGroup && child.pid !== undefined) {
        process.kill(-child.pid, name);
      } else {
        child.kill(name);
      }
    } catch {
      // The group is already gone.
    }
  };
  using stack = new DisposableStack();
  let killTimer: NodeJS.Timeout | undefined;
  stack.defer(() => {
    clearTimeout(killTimer);
  });
  const listeners = stack.adopt(new AbortController(), (controller) => {
    controller.abort();
  });
  signal.addEventListener(
    'abort',
    () => {
      signalGroup('SIGTERM');
      killTimer = setTimeout(
        () => {
          signalGroup('SIGKILL');
        },
        (run.killGrace ?? defaultKillGrace).total('milliseconds'),
      );
    },
    { once: true, signal: listeners.signal },
  );
  // Awaited, not returned: the stack must outlive the process.
  return await new Promise<Result<undefined, StepFailure>>((resolve) => {
    child.once('error', (error) => {
      resolve(err({ kind: 'not-started', message: error.message }));
    });
    child.once('close', (code, exitSignal) => {
      if (signal.aborted) {
        resolve(err({ kind: 'stopped', reason: signal.reason as unknown }));
      } else if (code === 0) {
        resolve(ok(undefined));
      } else {
        resolve(err({ kind: 'exited', code: code ?? undefined, signal: exitSignal ?? undefined }));
      }
    });
  });
}

/** A step's directory, relative to the checkout it must stay inside. */
interface StepDirectory {
  readonly checkout: string;
  readonly relative: string;
}

/** `relative` under `checkout`, links resolved, when that is still inside the checkout. */
async function containedDirectory({
  checkout,
  relative,
}: StepDirectory): Promise<string | undefined> {
  try {
    const resolved = await realpath(path.join(checkout, relative));
    const inside = path.relative(checkout, resolved);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      return undefined;
    }
    return resolved;
  } catch {
    return undefined;
  }
}
