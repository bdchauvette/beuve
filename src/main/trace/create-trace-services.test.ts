import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import type { TraceStatusView } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { waitUntil } from '../testing/wait-until.ts';
import { test } from './testing/test.ts';

// Slow: every probe starts a real Vitest process (about 0.7 s), the hanging ones are killed.
describe(
  'createMainServices trace probes (integration: git, SQLite, real Vitest)',
  { timeout: 60_000 },
  () => {
    test('runs nothing until the repository is trusted, then traces the hunk', async ({
      expect,
      services,
      sessionId,
      repo,
      traceEvents,
      traceDirectory,
      settledTrace,
    }) => {
      const request = { sessionId, path: 'src/math.ts', line: 5 };
      expect(okValueFrom(await services.trace.getTrust({ sessionId }))).toMatchObject({
        trusted: false,
        repositoryPath: repo.directory,
      });

      okValueFrom(await services.trace.run(request));
      const untrusted = await settledTrace();
      expect(untrusted).toMatchObject({
        state: 'failed',
        failure: 'untrusted',
        repositoryPath: repo.directory,
      });
      expect(existsSync(traceDirectory)).toBe(false);

      expect(okValueFrom(await services.trace.setTrust({ sessionId, trusted: true })).trusted).toBe(
        true,
      );
      traceEvents.length = 0;
      okValueFrom(await services.trace.run(request));
      const done = await settledTrace();

      expect(traceEvents[0]).toMatchObject({ state: 'running', testFiles: ['src/math.test.ts'] });
      expect(done).toMatchObject({ state: 'completed', path: 'src/math.ts', line: 5 });
      const { result } = completedTrace(done);
      expect(result.testFiles).toStrictEqual(['src/math.test.ts']);
      expect(result.functions).toStrictEqual([
        { index: 0, name: 'clamp', startLine: 1, endLine: 9 },
      ]);
      expect(result.timelines.map((timeline) => [timeline.titles, timeline.status])).toStrictEqual([
        [['clamp', 'caps high values'], 'passed'],
        [['clamp', 'keeps values in range'], 'passed'],
      ]);
      const capped = result.timelines[0]?.entries.map((entry) => [
        entry.kind,
        entry.line,
        entry.inHunk,
      ]);
      expect(capped).toStrictEqual([
        ['enter', 1, false],
        ['branch', 2, false],
        ['branch', 5, true],
        ['return', 6, true],
      ]);
      expect(result.timelines[0]?.entries[2]).toMatchObject({
        kind: 'branch',
        construct: 'if',
        label: 'value > high',
        taken: true,
      });
      expect(result.timelines[1]?.entries[2]).toMatchObject({ kind: 'branch', taken: false });
      await expect(repo.git('status', '--porcelain')).resolves.toBe('');
      expect(existsSync(traceDirectory) ? await isDirectoryEmpty(traceDirectory) : true).toBe(true);
    });

    test('reports failing tests together with their trace', async ({
      expect,
      services,
      sessionId,
      repo,
      settledTrace,
    }) => {
      okValueFrom(await services.trace.setTrust({ sessionId, trusted: true }));
      repo.write(
        'src/math.ts',
        readFileSync(path.join(repo.directory, 'src/math.ts'), 'utf8').replace(
          'return high;',
          'return high + 1;',
        ),
      );
      await repo.commit('break');
      okValueFrom(await services.trace.run({ sessionId, path: 'src/math.ts', line: 5 }));
      const done = await settledTrace();
      expect(done).toMatchObject({ state: 'failed', failure: 'test-failed-with-trace' });
      const failed = failedTrace(done);
      expect(failed.result?.timelines[0]).toMatchObject({ status: 'failed' });
      expect(failed.result?.timelines[0]?.entries.length).toBeGreaterThan(0);
    });

    test('explains untraceable requests with typed failures', async ({
      expect,
      services,
      sessionId,
      traceEvents,
      settledTrace,
    }) => {
      okValueFrom(await services.trace.setTrust({ sessionId, trusted: true }));
      const failures: [string, number, string][] = [
        ['notes.md', 1, 'unsupported-language'],
        ['src/orphan.ts', 2, 'no-tests-found'],
        ['src/nope.ts', 1, 'file-unavailable'],
      ];
      for (const [file, line, failure] of failures) {
        traceEvents.length = 0;
        okValueFrom(await services.trace.run({ sessionId, path: file, line }));
        await expect(settledTrace()).resolves.toMatchObject({ state: 'failed', failure });
      }
      traceEvents.length = 0;
      okValueFrom(await services.trace.run({ sessionId, path: 'src/math.ts', line: 99 }));
      await expect(settledTrace()).resolves.toMatchObject({
        state: 'failed',
        failure: 'no-function-at-line',
      });
    });

    test('allows one probe per session and cancels the one in flight', async ({
      expect,
      services,
      sessionId,
      traceEvents,
      settledTrace,
    }) => {
      okValueFrom(await services.trace.setTrust({ sessionId, trusted: true }));
      const request = { sessionId, path: 'src/hang.ts', line: 2 };
      okValueFrom(await services.trace.run(request));
      await expect(services.trace.run(request)).resolves.toMatchObject({
        ok: false,
        error: { code: 'refused' },
      });
      await waitUntil(
        () => traceEvents.some((event) => event.state === 'running'),
        'the probe to start',
      );
      expect(okValueFrom(services.trace.cancel({ sessionId }))).toStrictEqual({ cancelled: true });
      await expect(settledTrace()).resolves.toMatchObject({
        state: 'failed',
        failure: 'cancelled',
      });
      expect(okValueFrom(services.trace.cancel({ sessionId }))).toStrictEqual({ cancelled: false });
    });

    test('stops the probe when the head moves', async ({
      expect,
      services,
      sessionId,
      repo,
      traceEvents,
      settledTrace,
    }) => {
      okValueFrom(await services.trace.setTrust({ sessionId, trusted: true }));
      okValueFrom(await services.trace.run({ sessionId, path: 'src/hang.ts', line: 2 }));
      await waitUntil(
        () => traceEvents.some((event) => event.state === 'running'),
        'the probe to start',
      );
      repo.write('src/extra.ts', 'export const extra = 1;\n');
      await repo.commit('push');
      okValueFrom(await services.sessions.getReview({ sessionId }));
      const stopped = await settledTrace();
      expect(stopped).toMatchObject({ state: 'failed', failure: 'cancelled' });
      expect(stopped.state === 'failed' && stopped.message).toContain('head moved');
    });

    test('times out a probe that runs too long', async ({
      expect,
      createServices,
      sessionId,
      traceDirectory,
    }) => {
      const quick = createServices({
        trace: {
          temporaryDirectory: traceDirectory,
          timeout: Temporal.Duration.from({ milliseconds: 1500 }),
        },
      });
      okValueFrom(await quick.trace.setTrust({ sessionId, trusted: true }));
      const outcome = await quick.mcpTools.runTraceProbe({
        sessionId,
        path: 'src/hang.ts',
        line: 2,
      });
      expect(outcome).toMatchObject({ ok: false });
      expect(!outcome.ok && outcome.error).toMatch(/^timeout: /u);
    });

    test('serves the MCP tool: untrusted until a human approves, then 1-based lines', async ({
      expect,
      services,
      sessionId,
      repo,
      traceEvents,
      traceDirectory,
    }) => {
      const input = { sessionId, path: 'src/math.ts', line: 5, testNamePattern: 'caps high' };
      const refused = await services.mcpTools.runTraceProbe(input);
      expect(refused).toMatchObject({ ok: false });
      expect(!refused.ok && refused.error).toMatch(
        /^untrusted: .*human must approve it in beuve/su,
      );
      expect(existsSync(traceDirectory)).toBe(false);

      okValueFrom(await services.trace.setTrust({ sessionId, trusted: true }));
      const outcome = await services.mcpTools.runTraceProbe(input);
      expect(outcome.ok).toBe(true);
      const traced = outcome.ok ? (outcome.value as Record<string, unknown>) : {};
      expect(traced).toMatchObject({
        sessionId,
        path: 'src/math.ts',
        testFiles: ['src/math.test.ts'],
        testsFailed: false,
      });
      expect(traced['headSha']).toBe(await repo.git('rev-parse', 'feature'));
      const timelines = traced['timelines'] as { titles: string[]; entries: { line: number }[] }[];
      expect(timelines.map((timeline) => timeline.titles)).toStrictEqual([
        ['clamp', 'caps high values'],
      ]);
      expect(timelines[0]?.entries.map((entry) => entry.line)).toStrictEqual([1, 2, 5, 6]);
      expect(traceEvents).toStrictEqual([]);

      const untrusted = okValueFrom(await services.trace.setTrust({ sessionId, trusted: false }));
      expect(untrusted.trusted).toBe(false);
      await expect(services.mcpTools.runTraceProbe(input)).resolves.toMatchObject({ ok: false });
    });
  },
);

function completedTrace(status: TraceStatusView): Extract<TraceStatusView, { state: 'completed' }> {
  if (status.state !== 'completed') {
    throw new Error(`expected a completed trace, got ${status.state}`);
  }
  return status;
}

function failedTrace(status: TraceStatusView): Extract<TraceStatusView, { state: 'failed' }> {
  if (status.state !== 'failed') {
    throw new Error(`expected a failed trace, got ${status.state}`);
  }
  return status;
}

async function isDirectoryEmpty(directory: string): Promise<boolean> {
  const entries = await readdir(directory);
  return entries.length === 0;
}
