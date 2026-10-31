import { describe } from 'vitest';

import type { ImpactReport } from '#internal/impact/impact-report.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { err } from '#x/result/err.ts';
import type { Result } from '#x/result/result.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import type { MainServices } from '../main-services.ts';
import type { CreateServices } from '../testing/test.ts';
import { test } from '../testing/test.ts';
import type { ImpactRunFailure, ImpactRunner } from './create-impact-worker.ts';

describe('ImpactGate waiters (ADR 0079)', () => {
  test('the last waiter to give up cancels the shared computation', async ({
    expect,
    repo,
    createServices,
    signal,
  }) => {
    const { services, sessionId, runner } = await heldImpact(repo, createServices);
    const leaving = new AbortController();
    const waiting = services.impact.getImpactForRenderer(
      { sessionId },
      { signal: AbortSignal.any([signal, leaving.signal]) },
    );
    const run = await runner.started();
    leaving.abort();
    await expect(waiting).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(run.aborted).toBe(true);
  });

  test('a computation another caller still waits for goes on', async ({
    expect,
    repo,
    createServices,
    signal,
  }) => {
    const { services, sessionId, runner } = await heldImpact(repo, createServices);
    // eslint-disable-next-line local/forward-abort-signal -- stands for a caller without a signal (chat, MCP).
    const agent = services.impact.getImpact({ sessionId });
    const run = await runner.started();
    const leaving = new AbortController();
    const renderer = services.impact.getImpactForRenderer(
      { sessionId },
      { signal: AbortSignal.any([signal, leaving.signal]) },
    );
    leaving.abort();
    await expect(renderer).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(run.aborted).toBe(false);
    run.finish();
    await expect(agent).resolves.toMatchObject({ ok: true });
  });
});

interface HeldRun {
  readonly signal: AbortSignal;
  readonly aborted: boolean;
  readonly finish: () => void;
}

/** A hold-until-signal ImpactGate runner: each run waits for `finish` or its signal. */
/** An ImpactGate runner that also answers each run as it starts. */
interface HeldRunner extends ImpactRunner {
  readonly started: () => Promise<HeldRun>;
}

function heldRunner(): HeldRunner {
  const started = Promise.withResolvers<HeldRun>();
  const report: ImpactReport = {
    cognitiveMax: 15,
    population: 0,
    files: [],
    findings: [],
    totals: {
      analyzedFiles: 0,
      skippedFiles: 0,
      added: 0,
      removed: 0,
      modified: 0,
      cognitiveDelta: 0,
      findings: 0,
    },
  };
  return {
    run: async (_sources, signal): Promise<Result<ImpactReport, ImpactRunFailure>> => {
      const done = Promise.withResolvers<Result<ImpactReport, ImpactRunFailure>>();
      const own = signal ?? new AbortController().signal;
      own.addEventListener(
        'abort',
        () => {
          done.resolve(err({ kind: 'cancelled' }));
        },
        { once: true },
      );
      started.resolve({
        signal: own,
        get aborted(): boolean {
          return own.aborted;
        },
        finish: (): void => {
          done.resolve({ ok: true, value: report });
        },
      });
      return done.promise;
    },
    dispose: (): void => {
      // The held runner owns nothing.
    },
    started: async (): Promise<HeldRun> => {
      return started.promise;
    },
  };
}

/** A session whose ImpactGate runs wait for the test. */
interface HeldImpact {
  readonly services: MainServices;
  readonly sessionId: string;
  readonly runner: HeldRunner;
}

async function heldImpact(
  repo: TestRepository,
  createServices: CreateServices,
): Promise<HeldImpact> {
  repo.write('a.ts', 'export function a(): number {\n  return 1;\n}\n');
  await repo.commit('base');
  await repo.git('switch', '--quiet', '-c', 'feature');
  repo.write('a.ts', 'export function a(): number {\n  return 2;\n}\n');
  await repo.commit('change');
  const runner = heldRunner();
  const services = createServices({ impactRunner: runner });
  const created = okValueFrom(
    await services.sessions.createLocal({
      repoPath: repo.directory,
      baseRef: 'main',
      headRef: 'feature',
    }),
  );
  return { services, sessionId: created.id, runner };
}
