import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVitestTraceRunner } from './create-vitest-trace-runner.ts';
import { ecmascriptTraceRules } from './ecmascript-trace-rules.ts';
import type { InstrumentationPlan } from './instrumentation-plan.ts';
import { planInstrumentation } from './plan-instrumentation.ts';
import { runTraceProbe } from './run-trace-probe.ts';
import { createVitestFixture } from './testing/create-vitest-fixture.ts';
import type { VitestFixture } from './testing/create-vitest-fixture.ts';
import { describeTimeline } from './testing/describe-timeline.ts';
import { parseTestSource } from './testing/parse-test-source.ts';
import type { TraceRunRequest } from './trace-runner.ts';

const math = `export function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}
`;

const mathTest = `import { describe, expect, it } from 'vitest';
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

const hangingTest = `import { it } from 'vitest';

it('hangs', async () => new Promise(() => {}), 60_000);
`;

// Slow: each run starts a real Vitest process (about 0.5 to 1.5 s).
describe('createVitestTraceRunner with Vitest', { timeout: 60_000 }, () => {
  let fixture: VitestFixture;
  let plan: InstrumentationPlan;

  beforeAll(async () => {
    fixture = createVitestFixture({
      'src/math.ts': math,
      'src/math.test.ts': mathTest,
      'src/hang.test.ts': hangingTest,
    });
    const planned = planInstrumentation(
      await parseTestSource(math),
      { path: 'src/math.ts', changedLines: new Set([5]) },
      ecmascriptTraceRules,
    );
    if (!planned.ok) {
      throw new Error('no plan');
    }
    plan = planned.value;
  });

  afterAll(() => {
    fixture.cleanup();
  });

  const request = (overrides: Partial<TraceRunRequest> = {}): Omit<TraceRunRequest, 'files'> => ({
    trusted: true,
    worktree: fixture.worktree,
    dependencyRoot: fixture.dependencyRoot,
    testFiles: ['src/math.test.ts'],
    timeout: Temporal.Duration.from({ milliseconds: 30_000 }),
    ...overrides,
  });
  const runner = (): ReturnType<typeof createVitestTraceRunner> =>
    createVitestTraceRunner({
      nodePath: process.execPath,
      inheritedEnvironment: process.env,
      temporaryDirectory: fixture.temporaryDirectory,
    });

  it('traces each test without writing into the worktree', async () => {
    const before = snapshot(fixture.worktree);
    const result = await runTraceProbe({ ...request(), plan, source: math }, runner());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { timelines } = result.value;
    expect(timelines.map((timeline) => [timeline.titles, timeline.status])).toEqual([
      [['clamp', 'caps high values'], 'passed'],
      [['clamp', 'keeps values in range'], 'passed'],
      [['clamp', 'never calls clamp'], 'passed'],
    ]);
    expect(timelines[0]?.file).toBe('src/math.test.ts');
    expect(timelines.map((timeline) => describeTimeline(timeline))).toEqual([
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
    expect(snapshot(fixture.worktree)).toEqual(before);
    expect(readdirSync(fixture.temporaryDirectory)).toEqual([]);
  });

  it('runs only the tests matching a name pattern', async () => {
    const result = await runTraceProbe(
      { ...request({ testNamePattern: 'in range' }), plan, source: math },
      runner(),
    );
    expect(result.ok && result.value.timelines.map((timeline) => timeline.titles)).toEqual([
      ['clamp', 'keeps values in range'],
    ]);
  });

  it('fails the test file instead of tracing a source that changed since planning', async () => {
    const result = await runTraceProbe(
      { ...request(), plan, source: math.replace('low', 'lowest') },
      runner(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.timelines).toMatchObject([
      { file: 'src/math.test.ts', titles: [], status: 'failed', entries: [] },
    ]);
    expect(result.value.timelines[0]?.failure).toContain('differs from the text');
  });

  it('kills a run that outlives its timeout', async () => {
    const result = await runTraceProbe(
      {
        ...request({
          testFiles: ['src/hang.test.ts'],
          timeout: Temporal.Duration.from({ milliseconds: 1500 }),
        }),
        plan,
        source: math,
      },
      runner(),
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 1500 }) },
    });
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const running = runTraceProbe(
      {
        ...request({ testFiles: ['src/hang.test.ts'], signal: controller.signal }),
        plan,
        source: math,
      },
      runner(),
    );
    setTimeout(() => {
      controller.abort();
    }, 200);
    await expect(running).resolves.toEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});

describe('createVitestTraceRunner cancelled during setup', { timeout: 60_000 }, () => {
  it('stops a run whose signal aborted after the first check but before the process started', async () => {
    const fixture = createVitestFixture({
      'src/hang.test.ts': hangingTest,
      'src/math.ts': math,
    });
    try {
      const controller = new AbortController();
      const running = createVitestTraceRunner({
        nodePath: process.execPath,
        inheritedEnvironment: process.env,
        temporaryDirectory: fixture.temporaryDirectory,
      }).run({
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
      await expect(running).resolves.toEqual({ ok: false, error: { kind: 'cancelled' } });
    } finally {
      fixture.cleanup();
    }
  });
});

describe('createVitestTraceRunner refusals', () => {
  let fixture: VitestFixture;

  beforeAll(() => {
    fixture = createVitestFixture({ 'src/a.test.ts': '' });
  });

  afterAll(() => {
    fixture.cleanup();
  });

  const run = async (
    overrides: Partial<TraceRunRequest>,
  ): ReturnType<ReturnType<typeof createVitestTraceRunner>['run']> =>
    createVitestTraceRunner({
      nodePath: process.execPath,
      inheritedEnvironment: {},
      temporaryDirectory: fixture.temporaryDirectory,
    }).run({
      trusted: true,
      worktree: fixture.worktree,
      dependencyRoot: fixture.dependencyRoot,
      testFiles: ['src/a.test.ts'],
      files: [],
      timeout: Temporal.Duration.from({ milliseconds: 1000 }),
      ...overrides,
    });

  it('refuses untrusted runs', async () => {
    await expect(run({ trusted: false as unknown as true })).resolves.toEqual({
      ok: false,
      error: { kind: 'untrusted' },
    });
  });

  it('refuses paths outside the worktree', async () => {
    await expect(run({ testFiles: ['../dependencies/x.test.ts'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-path', path: '../dependencies/x.test.ts' },
    });
    await expect(run({ testFiles: ['/etc/passwd'] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-path' },
    });
    await expect(run({ testFiles: [] })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'no-tests' },
    });
  });

  it('reports a dependency root without Vitest', async () => {
    await expect(run({ dependencyRoot: fixture.worktree })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'vitest-not-found',
        searched: path.join(fixture.worktree, 'node_modules', 'vitest'),
      },
    });
  });
});

/** Every path under `root` with its size and modification time. */
function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .toSorted((left, right) => left.localeCompare(right))
    .map((entry) => {
      const stats = statSync(path.join(root, entry));
      return `${entry} ${String(stats.size)} ${String(stats.mtimeMs)}`;
    });
}
