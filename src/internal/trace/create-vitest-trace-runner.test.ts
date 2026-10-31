import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { chmodTree } from '#x/fs/chmod-tree.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { createVitestTraceRunner } from './create-vitest-trace-runner.ts';
import { ecmascriptTraceRules } from './ecmascript-trace-rules.ts';
import type { InstrumentationPlan } from './instrumentation-plan.ts';
import { planInstrumentation } from './plan-instrumentation.ts';
import { runTraceProbe } from './run-trace-probe.ts';
import type { VitestFixture } from './testing/create-vitest-fixture.ts';
import { describeTimeline } from './testing/describe-timeline.ts';
import { parseTestSource } from './testing/parse-test-source.ts';
import { test } from './testing/test.ts';
import type { VitestFixtures } from './testing/test.ts';
import type { TraceRunner, TraceRunRequest } from './trace-runner.ts';

function math(): string {
  return `export function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}
`;
}

function mathTest(): string {
  return `import { describe, expect, it } from 'vitest';
import { clamp } from './math.ts';

describe('clamp', () => {
  it('caps high values', () => {
    expect(clamp(12, 0, 10)).toBe(10);
  });
  it('keeps values in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('never calls clamp', () => {
    expect(1).toBe(1);
  });
});
`;
}

function hangingTest(): string {
  return `import { it } from 'vitest';

it('hangs', async () => new Promise(() => {}), 60_000);
`;
}

/** The fixture project of the tracing tests, and the plan for `math.ts` line 5. */
/** A fixture project and the plan for one of its files. */
interface PlannedProject {
  readonly fixture: VitestFixture;
  readonly plan: InstrumentationPlan;
}

async function mathProject(fixtures: VitestFixtures): Promise<PlannedProject> {
  const fixture = fixtures.create({
    'src/math.ts': math(),
    'src/math.test.ts': mathTest(),
    'src/hang.test.ts': hangingTest(),
  });
  const root = await parseTestSource(math());
  const planned = planInstrumentation(
    root,
    { path: 'src/math.ts', changedLines: new Set([5]) },
    ecmascriptTraceRules,
  );
  return { fixture, plan: okValueFrom(planned) };
}

function request(
  fixture: VitestFixture,
  overrides: Partial<TraceRunRequest> = {},
): Omit<TraceRunRequest, 'files'> {
  return {
    trusted: true,
    worktree: fixture.worktree,
    dependencyRoot: fixture.dependencyRoot,
    testFiles: ['src/math.test.ts'],
    timeout: Temporal.Duration.from({ milliseconds: 30_000 }),
    ...overrides,
  };
}

function runnerFor(
  fixture: VitestFixture,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof createVitestTraceRunner> {
  return createVitestTraceRunner({
    nodePath: process.execPath,
    inheritedEnvironment,
    temporaryDirectory: fixture.temporaryDirectory,
  });
}

// Slow: each run starts a real Vitest process (about 0.5 to 1.5 s).
describe('createVitestTraceRunner with Vitest', { timeout: 60_000 }, () => {
  test('traces each test without writing into the worktree', async ({
    expect,
    vitestFixtures,
    signal,
  }) => {
    const { fixture, plan } = await mathProject(vitestFixtures);
    const before = snapshot(fixture.worktree);
    const result = await runTraceProbe(
      { ...request(fixture, { signal }), plan, source: math() },
      runnerFor(fixture),
    );

    const { timelines } = okValueFrom(result);
    expect(
      timelines.map((timeline) => {
        return [timeline.titles, timeline.status];
      }),
    ).toStrictEqual([
      [['clamp', 'caps high values'], 'passed'],
      [['clamp', 'keeps values in range'], 'passed'],
      [['clamp', 'never calls clamp'], 'passed'],
    ]);
    expect(timelines[0]?.file).toBe('src/math.test.ts');
    expect(timelines.map((timeline) => describeTimeline(timeline))).toStrictEqual([
      [
        '1: enter clamp(value=12, low=0, high=10)',
        '2: if value < low → false',
        '5: if value > high → true',
        '6: return 10',
      ],
      [
        '1: enter clamp(value=5, low=0, high=10)',
        '2: if value < low → false',
        '5: if value > high → false',
        '8: return 5',
      ],
      [],
    ]);
    expect(snapshot(fixture.worktree)).toStrictEqual(before);
    expect(readdirSync(fixture.temporaryDirectory)).toStrictEqual([]);
  });

  test('traces a read-only worktree, as beuve checks them out (ADR 0033 amendment)', async ({
    expect,
    vitestFixtures,
    signal,
  }) => {
    const { fixture, plan } = await mathProject(vitestFixtures);
    await chmodTree(fixture.worktree, { file: withoutWrite, directory: withoutWrite });
    const result = await runTraceProbe(
      { ...request(fixture, { signal }), plan, source: math() },
      runnerFor(fixture),
    );
    expect(
      okValueFrom(result).timelines.map((timeline) => {
        return [timeline.titles, timeline.status];
      }),
    ).toStrictEqual([
      [['clamp', 'caps high values'], 'passed'],
      [['clamp', 'keeps values in range'], 'passed'],
      [['clamp', 'never calls clamp'], 'passed'],
    ]);
  });

  test('runs only the tests matching a name pattern', async ({
    expect,
    vitestFixtures,
    signal,
  }) => {
    const { fixture, plan } = await mathProject(vitestFixtures);
    const result = await runTraceProbe(
      { ...request(fixture, { testNamePattern: 'in range', signal }), plan, source: math() },
      runnerFor(fixture),
    );
    expect(okValueFrom(result).timelines.map((timeline) => timeline.titles)).toStrictEqual([
      ['clamp', 'keeps values in range'],
    ]);
  });

  test('fails the test file instead of tracing a source that changed since planning', async ({
    expect,
    vitestFixtures,
    signal,
  }) => {
    const { fixture, plan } = await mathProject(vitestFixtures);
    const result = await runTraceProbe(
      { ...request(fixture, { signal }), plan, source: math().replace('low', 'lowest') },
      runnerFor(fixture),
    );
    const { timelines } = okValueFrom(result);
    expect(timelines).toMatchObject([
      { file: 'src/math.test.ts', titles: [], status: 'failed', entries: [] },
    ]);
    expect(timelines[0]?.failure).toContain('differs from the text');
  });

  test('kills a run that outlives its timeout', async ({ expect, vitestFixtures, signal }) => {
    const { fixture, plan } = await mathProject(vitestFixtures);
    const result = await runTraceProbe(
      {
        ...request(fixture, {
          testFiles: ['src/hang.test.ts'],
          timeout: Temporal.Duration.from({ milliseconds: 1500 }),
          signal,
        }),
        plan,
        source: math(),
      },
      runnerFor(fixture),
    );
    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 1500 }) },
    });
  });

  test('stops when cancelled', async ({ expect, vitestFixtures }) => {
    const { fixture, plan } = await mathProject(vitestFixtures);
    const controller = new AbortController();
    const running = runTraceProbe(
      {
        ...request(fixture, { testFiles: ['src/hang.test.ts'], signal: controller.signal }),
        plan,
        source: math(),
      },
      runnerFor(fixture),
    );
    setTimeout(() => {
      controller.abort();
    }, 200);
    await expect(running).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});

describe('createVitestTraceRunner cancelled during setup', { timeout: 60_000 }, () => {
  test('stops a run whose signal aborted after the first check but before the process started', async ({
    expect,
    vitestFixtures,
  }) => {
    const fixture = vitestFixtures.create({
      'src/hang.test.ts': hangingTest(),
      'src/math.ts': math(),
    });
    const controller = new AbortController();
    const running = runnerFor(fixture).run({
      trusted: true,
      worktree: fixture.worktree,
      dependencyRoot: fixture.dependencyRoot,
      testFiles: ['src/hang.test.ts'],
      files: [],
      timeout: Temporal.Duration.from({ milliseconds: 30_000 }),
      signal: controller.signal,
    });
    queueMicrotask(() => {
      controller.abort();
    });
    await expect(running).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});

describe('createVitestTraceRunner refusals', () => {
  test('refuses untrusted runs', async ({ expect, vitestFixtures, signal }) => {
    const { run } = refusalRunner(vitestFixtures);
    await expect(run({ trusted: false as unknown as true, signal })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'untrusted' },
    });
  });

  test('refuses paths outside the worktree', async ({ expect, vitestFixtures, signal }) => {
    const { run } = refusalRunner(vitestFixtures);
    await expect(run({ testFiles: ['../dependencies/x.test.ts'], signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-path', path: '../dependencies/x.test.ts' },
    });
    await expect(run({ testFiles: ['/etc/passwd'], signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-path' },
    });
    await expect(run({ testFiles: [], signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'no-tests' },
    });
  });

  test('reports a dependency root without Vitest', async ({ expect, vitestFixtures, signal }) => {
    const { fixture, run } = refusalRunner(vitestFixtures);
    const worktree = fixture.worktree;
    await expect(run({ dependencyRoot: worktree, signal })).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'vitest-not-found',
        searched: path.join(worktree, 'node_modules', 'vitest'),
      },
    });
  });
});

describe('createVitestTraceRunner output', { timeout: 30_000 }, () => {
  test('keeps a multi-byte character that arrives split across chunks', async ({
    expect,
    vitestFixtures,
    signal,
  }) => {
    const { fixture, run } = refusalRunner(vitestFixtures);
    installChattyVitest(fixture.dependencyRoot);

    const result = await run({
      signal,
      timeout: Temporal.Duration.from({ milliseconds: 20_000 }),
    });

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: 'run-failed', exitCode: 1, signal: undefined, output: 'before 🙂 after' },
    });
  });
});

/**
 * Replaces the fixture's Vitest with a script that prints "before 🙂 after" to stdout, with the
 * four bytes of the emoji split over two writes 100 ms apart, then fails without a report.
 */
function installChattyVitest(dependencyRoot: string): void {
  const directory = path.join(dependencyRoot, 'node_modules', 'vitest');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: 'vitest', version: '0.0.0', bin: 'cli.mjs' }),
  );
  writeFileSync(
    path.join(directory, 'cli.mjs'),
    `import { setTimeout } from 'node:timers/promises';
process.stdout.write(Buffer.from([...Buffer.from('before '), 0xf0, 0x9f]));
await setTimeout(100);
process.stdout.write(Buffer.from([0x99, 0x82, ...Buffer.from(' after')]));
process.exitCode = 1;
`,
  );
}

/** Runs the runner with an empty environment against a fresh fixture holding one empty test. */
/** A fixture, and a runner over it that should refuse. */
interface RefusalFixture {
  readonly fixture: VitestFixture;
  readonly run: RefusalRun;
}

function refusalRunner(fixtures: VitestFixtures): RefusalFixture {
  const fixture = fixtures.create({ 'src/a.test.ts': '' });
  const run: RefusalRun = async (overrides) => {
    return runnerFor(fixture, {}).run({
      trusted: true,
      worktree: fixture.worktree,
      dependencyRoot: fixture.dependencyRoot,
      testFiles: ['src/a.test.ts'],
      files: [],
      timeout: Temporal.Duration.from({ milliseconds: 1000 }),
      ...overrides,
    });
  };
  return { fixture, run };
}

type RefusalRun = (overrides: Partial<TraceRunRequest>) => ReturnType<TraceRunner['run']>;

function withoutWrite(mode: number): number {
  return mode & ~0o222;
}

/** Every path under `root` with its size and modification time. */
function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .toSorted((left, right) => left.localeCompare(right))
    .map((entry) => {
      const stats = statSync(path.join(root, entry));
      return `${entry} ${String(stats.size)} ${String(stats.mtimeMs)}`;
    });
}
