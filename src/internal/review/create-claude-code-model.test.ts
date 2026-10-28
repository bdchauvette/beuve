import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createClaudeCodeModel } from './create-claude-code-model.ts';
import type { ModelProgress, ModelRequest } from './review-model.ts';
import { writeFakeClaude } from './testing/write-fake-claude.ts';

const temporary = mkdtempSync(path.join(tmpdir(), 'beuve-fake-claude-'));
const directory = realpathSync(temporary);
const script = writeFakeClaude(directory);

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const echoSchema = z.object({
  args: z.array(z.string()),
  stdin: z.string(),
  cwd: z.string(),
  envKeys: z.array(z.string()),
});

function model(mode: string, pidFile = '-'): ReturnType<typeof createClaudeCodeModel> {
  return createClaudeCodeModel({
    command: process.execPath,
    leadingArgs: [script, mode, pidFile],
    model: 'sonnet',
    inheritedEnv: { PATH: process.env['PATH'], HOME: directory, ANTHROPIC_API_KEY: 'sk-secret' },
    killGraceMs: 200,
  });
}

function request(
  overrides: Partial<ModelRequest<z.infer<typeof echoSchema>>> = {},
): ModelRequest<z.infer<typeof echoSchema>> {
  return {
    system: 'Review carefully.',
    prompt: 'diff --git a/x b/x\n'.repeat(10_000),
    cwd: directory,
    outputSchema: echoSchema,
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe('createClaudeCodeModel', () => {
  it('runs the CLI read-only in the worktree, with the prompt on stdin and a minimal env', async () => {
    const progress: ModelProgress[] = [];
    const outcome = await model('echo').run(
      request({
        onProgress: (event) => {
          progress.push(event);
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const { value } = outcome.value;
    expect(value.stdin).toBe(request().prompt);
    expect(value.cwd).toBe(directory);
    expect(value.envKeys).toEqual(['HOME', 'PATH']);
    expect(value.args).toContain('--print');
    expect(value.args).toContain('--tools=Read,Grep,Glob');
    expect(value.args).toContain('--append-system-prompt=Review carefully.');
    expect(value.args).toContain('--model=sonnet');
    const schemaArg = value.args.find((arg) => arg.startsWith('--json-schema='));
    expect(JSON.parse(schemaArg?.slice('--json-schema='.length) ?? '')).toMatchObject({
      type: 'object',
      required: ['args', 'stdin', 'cwd', 'envKeys'],
    });
    expect(schemaArg).not.toContain('$schema');
    expect(outcome.value).toMatchObject({
      model: 'fake-model-1',
      turns: 2,
      costUsd: 0.01,
      deniedToolUses: 1,
    });
    expect(progress).toEqual([
      { kind: 'started', model: 'fake-model-1' },
      { kind: 'tool-use', tool: 'Read' },
    ]);
  });

  it('falls back to parsing the result text when there is no structured output', async () => {
    const outcome = await model('text-result').run(request({ prompt: 'small' }));
    expect(outcome).toMatchObject({ ok: true, value: { value: { stdin: 'small' } } });
  });

  it('reports a stream without a result as invalid output', async () => {
    expect(await model('garbage').run(request())).toEqual({
      ok: false,
      error: {
        kind: 'invalid-output',
        reason: 'the run ended without a result event (not JSON)',
      },
    });
  });

  it('validates the structured output against the schema', async () => {
    const outcome = await model('mismatch').run(request());
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'invalid-output' } });
  });

  it('reports a non-zero exit without a result as a process failure with stderr', async () => {
    expect(await model('fail').run(request())).toEqual({
      ok: false,
      error: {
        kind: 'process-failed',
        exitCode: 2,
        signal: undefined,
        stderr: 'fake claude crashed',
      },
    });
  });

  it('recognizes a missing login, a rate limit and a spent budget', async () => {
    expect(await model('not-logged-in').run(request())).toMatchObject({
      ok: false,
      error: { kind: 'not-authenticated', message: 'Not logged in · Please run /login' },
    });
    expect(await model('rate-limited').run(request())).toMatchObject({
      ok: false,
      error: { kind: 'rate-limited', resetsAt: '2026-10-28T22:00:00.000Z' },
    });
    expect(await model('budget').run(request())).toMatchObject({
      ok: false,
      error: { kind: 'model-failed', reason: 'error_max_budget_usd' },
    });
  });

  it('times out, killing the whole process group', async () => {
    const pidFile = path.join(directory, 'timeout.json');
    const outcome = await model('hang', pidFile).run(request({ timeoutMs: 500 }));
    expect(outcome).toEqual({ ok: false, error: { kind: 'timeout', timeoutMs: 500 } });
    await expectReaped(pidFile);
  });

  it('cancels on abort, escalating to SIGKILL when SIGTERM is ignored', async () => {
    const pidFile = path.join(directory, 'cancel.json');
    const controller = new AbortController();
    const running = model('stubborn', pidFile).run(request({ signal: controller.signal }));
    await waitFor(() => existsSync(pidFile));
    controller.abort();
    expect(await running).toEqual({ ok: false, error: { kind: 'cancelled' } });
    await expectReaped(pidFile);
  });

  it('does not start when already aborted', async () => {
    const aborted = request({ signal: AbortSignal.abort() });
    expect(await model('echo').run(aborted)).toEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });

  it('caps stdout', async () => {
    const capped = createClaudeCodeModel({
      command: process.execPath,
      leadingArgs: [script, 'flood', '-'],
      inheritedEnv: {},
      maxOutputBytes: 64 * 1024,
    });
    expect(await capped.run(request())).toEqual({
      ok: false,
      error: { kind: 'output-too-large', maxBytes: 64 * 1024 },
    });
  });

  it('reports a missing executable and a missing worktree', async () => {
    const missing = createClaudeCodeModel({ command: path.join(directory, 'no-such-claude') });
    expect(await missing.run(request())).toEqual({
      ok: false,
      error: { kind: 'not-installed', command: path.join(directory, 'no-such-claude') },
    });
    const gone = request({ cwd: path.join(directory, 'gone') });
    expect(await model('echo').run(gone)).toEqual({
      ok: false,
      error: { kind: 'invalid-request', reason: 'cwd is not a directory' },
    });
    expect(await model('echo').run(request({ cwd: 'relative' }))).toEqual({
      ok: false,
      error: { kind: 'invalid-request', reason: 'cwd must be absolute' },
    });
  });
});

async function waitFor(isDone: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !isDone(); attempt += 1) {
    await delay(25);
  }
  expect(isDone()).toBe(true);
}

async function expectReaped(pidFile: string): Promise<void> {
  const pids = z
    .object({ self: z.number(), child: z.number() })
    .parse(JSON.parse(readFileSync(pidFile, 'utf8')));
  await waitFor(() => !isAlive(pids.self) && !isAlive(pids.child));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
