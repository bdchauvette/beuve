import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IpcResult, TraceStatusView } from '#contract/ipc-contract.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { createLogger } from '#x/log/create-logger.ts';

import { createMainServices } from '../create-main-services.ts';
import { openAppDatabase } from '../database/open-app-database.ts';
import type { MainServices } from '../main-services.ts';

import { createTraceTestProject } from './testing/create-trace-test-project.ts';

const baseMath = `export function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  return value;
}
`;

const headMath = `export function clamp(value: number, low: number, high: number): number {
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
});
`;

const failingMath = headMath.replace('return high;', 'return high + 1;');

function hang(value: number): string {
  return `export function hang(): number {\n  return ${String(value)};\n}\n`;
}

const hangTest = `import { it } from 'vitest';
import { hang } from './hang.ts';

it('hangs', async () => {
  hang();
  await new Promise(() => {});
}, 120_000);
`;

const untrustedMessage = /^untrusted: .*human must approve it in beuve/su;
const timeoutMessage = /^timeout: /u;

// Slow: every probe starts a real Vitest process (about 0.7 s), the hanging ones are killed.
describe(
  'createMainServices trace probes (integration: git, SQLite, real Vitest)',
  {
    timeout: 60_000,
  },
  () => {
    let repo: TestRepository;
    let db: DatabaseSync;
    let services: MainServices;
    let temporary: string;
    let sessionId: string;
    const events: TraceStatusView[] = [];

    beforeEach(async () => {
      events.length = 0;
      repo = createTestRepository();
      createTraceTestProject(repo);
      repo.write('src/math.ts', baseMath);
      repo.write('src/math.test.ts', mathTest);
      repo.write('src/hang.ts', hang(0));
      repo.write('src/hang.test.ts', hangTest);
      repo.write('src/orphan.ts', 'export function orphan(): number {\n  return 1;\n}\n');
      repo.commit('base');
      repo.git('switch', '--quiet', '-c', 'feature');
      repo.write('src/math.ts', headMath);
      repo.write('src/hang.ts', hang(1));
      repo.write('src/orphan.ts', 'export function orphan(): number {\n  return 2;\n}\n');
      repo.write('notes.md', 'notes\n');
      repo.commit('feature');
      const scratch = repo.scratch();
      temporary = path.join(scratch, 'trace');
      db = openAppDatabase(':memory:');
      services = createMainServices({
        db,
        logger: createLogger('test', { sink: (): void => undefined }),
        worktreeRoot: path.join(scratch, 'worktrees'),
        trace: { temporaryDirectory: temporary, timeoutMs: 30_000 },
      });
      services.trace.onStatus((event) => {
        events.push(event);
      });
      const created = await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      });
      sessionId = value(created).id;
    });

    afterEach(async () => {
      await services.dispose();
      db.close();
      repo.cleanup();
    });

    it('runs nothing until the repository is trusted, then traces the hunk', async () => {
      const request = { sessionId, path: 'src/math.ts', line: 5 };
      expect(value(await services.trace.getTrust({ sessionId }))).toMatchObject({
        trusted: false,
        repositoryPath: repo.directory,
      });

      value(await services.trace.run(request));
      const untrusted = await settled();
      expect(untrusted).toMatchObject({
        state: 'failed',
        failure: 'untrusted',
        repositoryPath: repo.directory,
      });
      expect(existsSync(temporary)).toBe(false);

      expect(value(await services.trace.setTrust({ sessionId, trusted: true })).trusted).toBe(true);
      events.length = 0;
      value(await services.trace.run(request));
      const done = await settled();

      expect(events[0]).toMatchObject({ state: 'running', testFiles: ['src/math.test.ts'] });
      expect(done).toMatchObject({ state: 'completed', path: 'src/math.ts', line: 5 });
      if (done.state !== 'completed') {
        return;
      }
      const { result } = done;
      expect(result.testFiles).toEqual(['src/math.test.ts']);
      expect(result.functions).toEqual([{ index: 0, name: 'clamp', startLine: 1, endLine: 9 }]);
      expect(result.timelines.map((timeline) => [timeline.titles, timeline.status])).toEqual([
        [['clamp', 'caps high values'], 'passed'],
        [['clamp', 'keeps values in range'], 'passed'],
      ]);
      const capped = result.timelines[0]?.entries.map((entry) => [
        entry.kind,
        entry.line,
        entry.inHunk,
      ]);
      expect(capped).toEqual([
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
      expect(repo.git('status', '--porcelain')).toBe('');
      expect(existsSync(temporary) ? await isDirectoryEmpty(temporary) : true).toBe(true);
    });

    it('reports failing tests together with their trace', async () => {
      value(await services.trace.setTrust({ sessionId, trusted: true }));
      repo.write('src/math.ts', failingMath);
      repo.commit('break');
      value(await services.trace.run({ sessionId, path: 'src/math.ts', line: 5 }));
      const done = await settled();
      expect(done).toMatchObject({ state: 'failed', failure: 'test-failed-with-trace' });
      if (done.state !== 'failed') {
        return;
      }

      expect(done.result?.timelines[0]).toMatchObject({ status: 'failed' });
      expect(done.result?.timelines[0]?.entries.length).toBeGreaterThan(0);
    });

    it('explains untraceable requests with typed failures', async () => {
      value(await services.trace.setTrust({ sessionId, trusted: true }));
      const failures: [string, number, string][] = [
        ['notes.md', 1, 'unsupported-language'],
        ['src/orphan.ts', 2, 'no-tests-found'],
        ['src/nope.ts', 1, 'file-unavailable'],
      ];
      for (const [file, line, failure] of failures) {
        events.length = 0;
        value(await services.trace.run({ sessionId, path: file, line }));
        expect(await settled()).toMatchObject({ state: 'failed', failure });
      }
      events.length = 0;
      value(await services.trace.run({ sessionId, path: 'src/math.ts', line: 99 }));
      expect(await settled()).toMatchObject({ state: 'failed', failure: 'no-function-at-line' });
    });

    it('allows one probe per session and cancels the one in flight', async () => {
      value(await services.trace.setTrust({ sessionId, trusted: true }));
      const request = { sessionId, path: 'src/hang.ts', line: 2 };
      value(await services.trace.run(request));
      expect(await services.trace.run(request)).toMatchObject({
        ok: false,
        error: { code: 'refused' },
      });
      await until(() => events.some((event) => event.state === 'running'));
      expect(value(services.trace.cancel({ sessionId }))).toEqual({ cancelled: true });
      expect(await settled()).toMatchObject({ state: 'failed', failure: 'cancelled' });
      expect(value(services.trace.cancel({ sessionId }))).toEqual({ cancelled: false });
    });

    it('stops the probe when the head moves', async () => {
      value(await services.trace.setTrust({ sessionId, trusted: true }));
      value(await services.trace.run({ sessionId, path: 'src/hang.ts', line: 2 }));
      await until(() => events.some((event) => event.state === 'running'));
      repo.write('src/extra.ts', 'export const extra = 1;\n');
      repo.commit('push');
      value(await services.sessions.getReview({ sessionId }));
      const stopped = await settled();
      expect(stopped).toMatchObject({ state: 'failed', failure: 'cancelled' });
      expect(stopped.state === 'failed' && stopped.message).toContain('head moved');
    });

    it('times out a probe that runs too long', async () => {
      const quick = createMainServices({
        db,
        logger: createLogger('test', { sink: (): void => undefined }),
        worktreeRoot: path.join(repo.scratch(), 'worktrees'),
        trace: { temporaryDirectory: temporary, timeoutMs: 1500 },
      });
      try {
        value(await quick.trace.setTrust({ sessionId, trusted: true }));
        const outcome = await quick.mcpTools.runTraceProbe({
          sessionId,
          path: 'src/hang.ts',
          line: 2,
        });
        expect(outcome).toMatchObject({ ok: false });
        expect(!outcome.ok && outcome.error).toMatch(timeoutMessage);
      } finally {
        await quick.dispose();
      }
    });

    it('serves the MCP tool: untrusted until a human approves, then 1-based lines', async () => {
      const input = { sessionId, path: 'src/math.ts', line: 5, testNamePattern: 'caps high' };
      const refused = await services.mcpTools.runTraceProbe(input);
      expect(refused).toMatchObject({ ok: false });
      expect(!refused.ok && refused.error).toMatch(untrustedMessage);
      expect(existsSync(temporary)).toBe(false);

      value(await services.trace.setTrust({ sessionId, trusted: true }));
      const outcome = await services.mcpTools.runTraceProbe(input);
      expect(outcome.ok).toBe(true);
      const traced = outcome.ok ? (outcome.value as Record<string, unknown>) : {};
      expect(traced).toMatchObject({
        sessionId,
        path: 'src/math.ts',
        testFiles: ['src/math.test.ts'],
        testsFailed: false,
      });
      expect(traced['headSha']).toBe(repo.git('rev-parse', 'feature'));
      const timelines = traced['timelines'] as { titles: string[]; entries: { line: number }[] }[];
      expect(timelines.map((timeline) => timeline.titles)).toEqual([['clamp', 'caps high values']]);
      expect(timelines[0]?.entries.map((entry) => entry.line)).toEqual([1, 2, 5, 6]);
      expect(events).toEqual([]);

      const untrusted = value(await services.trace.setTrust({ sessionId, trusted: false }));
      expect(untrusted.trusted).toBe(false);
      expect(await services.mcpTools.runTraceProbe(input)).toMatchObject({ ok: false });
    });

    const settled = async (): Promise<TraceStatusView> => {
      await until(() => events.some((event) => event.state !== 'running'));
      const last = events.findLast((event) => event.state !== 'running');
      if (last === undefined) {
        throw new Error('no final status');
      }
      return last;
    };
  },
);

async function until(isDone: () => boolean): Promise<void> {
  const started = Date.now();
  while (!isDone()) {
    if (Date.now() - started > 45_000) {
      throw new Error('timed out waiting');
    }
    await delay(25);
  }
}

async function isDirectoryEmpty(directory: string): Promise<boolean> {
  const entries = await readdir(directory);
  return entries.length === 0;
}

function value<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}
