import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { describe } from 'vitest';
import type { ExpectStatic } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { z } from 'zod';

import { createClaudeCodeModel } from './create-claude-code-model.ts';
import type {
  ModelProgress,
  ModelRequest,
  TextModelRequest,
  TextStreamEvent,
} from './language-model.ts';
import { test } from './testing/test.ts';

interface Echo {
  readonly args: string[];
  readonly stdin: string;
  readonly cwd: string;
  readonly envKeys: string[];
}

function echoSchema(): z.ZodType<Echo> {
  return z.object({
    args: z.array(z.string()),
    stdin: z.string(),
    cwd: z.string(),
    envKeys: z.array(z.string()),
  });
}

/** The model over the fake `claude` in `mode`; `directory` is its HOME and holds its pid file. */
function model(
  script: string,
  directory: string,
  mode: string,
  pidFile = '-',
): ReturnType<typeof createClaudeCodeModel> {
  return createClaudeCodeModel({
    command: process.execPath,
    leadingArgs: [script, mode, pidFile],
    model: 'sonnet',
    inheritedEnv: { PATH: process.env['PATH'], HOME: directory, ANTHROPIC_API_KEY: 'sk-secret' },
    killGrace: Temporal.Duration.from({ milliseconds: 200 }),
  });
}

function request(
  directory: string,
  overrides: Partial<ModelRequest<Echo>> = {},
): ModelRequest<Echo> {
  return {
    system: 'Review carefully.',
    messages: [{ role: 'user', content: 'diff --git a/x b/x\n'.repeat(10_000) }],
    cwd: directory,
    outputSchema: echoSchema(),
    timeout: Temporal.Duration.from({ milliseconds: 10_000 }),
    ...overrides,
  };
}

describe('createClaudeCodeModel', () => {
  test('runs the CLI read-only in the worktree, with the prompt on stdin and a minimal env', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const progress: ModelProgress[] = [];
    const outcome = okValueFrom(
      await model(script, directory, 'echo').run(
        request(directory, {
          onProgress: (event) => {
            progress.push(event);
          },
          signal,
        }),
      ),
    );
    const { value } = outcome;
    expect(value.stdin).toBe(request(directory, { signal }).messages[0]?.content);
    expect(value.cwd).toBe(directory);
    expect(value.envKeys).toStrictEqual(['HOME', 'PATH']);
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
    expect(outcome).toMatchObject({
      model: 'fake-model-1',
      turns: 2,
      costUsd: 0.01,
      deniedToolUses: 1,
    });
    expect(progress).toStrictEqual([
      { kind: 'started', model: 'fake-model-1' },
      { kind: 'tool-start', id: 'tool-0', tool: 'Read', description: 'read' },
    ]);
  });

  test('falls back to parsing the result text when there is no structured output', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const outcome = await model(script, directory, 'text-result').run(
      request(directory, { messages: [{ role: 'user', content: 'small' }], signal }),
    );
    expect(outcome).toMatchObject({ ok: true, value: { value: { stdin: 'small' } } });
  });

  test('reports a stream without a result as invalid output', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    await expect(
      model(script, directory, 'garbage').run(request(directory, { signal })),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid-output',
        reason: 'the run ended without a result event (not JSON)',
      },
    });
  });

  test('validates the structured output against the schema', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const outcome = await model(script, directory, 'mismatch').run(request(directory, { signal }));
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'invalid-output' } });
  });

  test('reports a non-zero exit without a result as a process failure with stderr', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    await expect(
      model(script, directory, 'fail').run(request(directory, { signal })),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'process-failed',
        exitCode: 2,
        signal: undefined,
        stderr: 'fake claude crashed',
      },
    });
  });

  test('stops a run that is not on the Claude Code login, as --bare would make it', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const progress: ModelProgress[] = [];
    const outcome = await model(script, directory, 'api-key').run(
      request(directory, {
        onProgress: (event) => {
          progress.push(event);
        },
        signal,
      }),
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        kind: 'not-authenticated',
        message: expect.stringContaining('credential source: ANTHROPIC_API_KEY') as string,
      },
    });
    expect(progress).toStrictEqual([]);
  });

  test('recognizes a missing login, a rate limit and a spent budget', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    await expect(
      model(script, directory, 'not-logged-in').run(request(directory, { signal })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-authenticated', message: 'Not logged in · Please run /login' },
    });
    await expect(
      model(script, directory, 'rate-limited').run(request(directory, { signal })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'rate-limited', resetsAt: '2026-10-28T22:00:00.000Z' },
    });
    await expect(
      model(script, directory, 'budget').run(request(directory, { signal })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'model-failed', reason: 'error_max_budget_usd' },
    });
  });

  test('times out, killing the whole process group', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const pidFile = path.join(directory, 'timeout.json');
    const outcome = await model(script, directory, 'hang', pidFile).run(
      request(directory, { timeout: Temporal.Duration.from({ milliseconds: 500 }), signal }),
    );
    expect(outcome).toStrictEqual({
      ok: false,
      error: { kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 500 }) },
    });
    await expectReaped(expect, pidFile);
  });

  test('cancels on abort, escalating to SIGKILL when SIGTERM is ignored', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
  }) => {
    const pidFile = path.join(directory, 'cancel.json');
    const controller = new AbortController();
    const running = model(script, directory, 'stubborn', pidFile).run(
      request(directory, { signal: controller.signal }),
    );
    await waitFor(expect, () => existsSync(pidFile));
    controller.abort();
    await expect(running).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    await expectReaped(expect, pidFile);
  });

  test('reports a caller’s own timeout signal as a cancellation, reaping the group', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
  }) => {
    const pidFile = path.join(directory, 'caller-timeout.json');
    const signal = AbortSignal.timeout(300);
    const outcome = await model(script, directory, 'hang', pidFile).run(
      request(directory, { signal }),
    );
    expect(outcome).toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    await expectReaped(expect, pidFile);
  });

  test('does not start when already aborted', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
  }) => {
    const aborted = request(directory, { signal: AbortSignal.abort() });
    await expect(model(script, directory, 'echo').run(aborted)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });

  test('caps stdout', async ({ expect, fakeClaude: script, tempDir: directory, signal }) => {
    const capped = createClaudeCodeModel({
      command: process.execPath,
      leadingArgs: [script, 'flood', '-'],
      inheritedEnv: {},
      maxOutputBytes: 64 * 1024,
    });
    await expect(capped.run(request(directory, { signal }))).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'output-too-large', maxBytes: 64 * 1024 },
    });
  });

  test('reports a missing executable and a missing worktree', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const missing = createClaudeCodeModel({ command: path.join(directory, 'no-such-claude') });
    await expect(missing.run(request(directory, { signal }))).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not-installed', command: path.join(directory, 'no-such-claude') },
    });
    const gone = request(directory, { cwd: path.join(directory, 'gone'), signal });
    await expect(model(script, directory, 'echo').run(gone)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-request', reason: 'cwd is not a directory' },
    });
    await expect(
      model(script, directory, 'echo').run(request(directory, { cwd: 'relative', signal })),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-request', reason: 'cwd must be absolute' },
    });
  });
});

describe('createClaudeCodeModel runText', () => {
  test('returns the final text, streaming its deltas and resetting after a tool call', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const events: TextStreamEvent[] = [];
    const outcome = await chat(script, directory, 'stream', {
      preamble: 'Let me look.',
      chunks: ['It splits ', 'on commas [[src/a.ts:10-12]].'],
    }).runText(
      textRequest(directory, {
        onText: (event) => {
          events.push(event);
        },
        signal,
      }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: { value: 'It splits on commas [[src/a.ts:10-12]].', model: 'fake-model-1', turns: 2 },
    });
    expect(events).toStrictEqual<TextStreamEvent[]>([
      { kind: 'append', text: 'Let me look.' },
      { kind: 'reset' },
      { kind: 'append', text: 'It splits ' },
      { kind: 'append', text: 'on commas [[src/a.ts:10-12]].' },
    ]);
    const [call] = calls(directory, 'stream');
    expect(call?.args).toContain('--include-partial-messages');
    expect(call?.args.some((arg) => arg.startsWith('--json-schema'))).toBe(false);
    expect(call?.args).toContain('--tools=Read,Grep,Glob');
  });

  test('does not ask for partial messages without onText', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    const outcome = await chat(script, directory, 'quiet', { chunks: ['Plain.'] }).runText(
      textRequest(directory, { signal }),
    );
    expect(outcome).toMatchObject({ ok: true, value: { value: 'Plain.' } });
    expect(calls(directory, 'quiet')[0]?.args).not.toContain('--include-partial-messages');
  });

  test('maps failures and cancellation like structured runs', async ({
    expect,
    fakeClaude: script,
    tempDir: directory,
    signal,
  }) => {
    await expect(
      model(script, directory, 'not-logged-in').runText(textRequest(directory, { signal })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-authenticated' },
    });
    await expect(
      model(script, directory, 'fail').runText(textRequest(directory, { signal })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'process-failed', exitCode: 2 },
    });
    const pidFile = path.join(directory, 'text-cancel.json');
    const controller = new AbortController();
    const running = model(script, directory, 'hang', pidFile).runText(
      textRequest(directory, { signal: controller.signal }),
    );
    await waitFor(expect, () => existsSync(pidFile));
    controller.abort();
    await expect(running).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
    await expectReaped(expect, pidFile);
  });
});

function textRequest(
  directory: string,
  overrides: Partial<TextModelRequest> = {},
): TextModelRequest {
  return {
    system: 'Answer questions.',
    messages: [{ role: 'user', content: 'What does parse do?' }],
    cwd: directory,
    timeout: Temporal.Duration.from({ milliseconds: 10_000 }),
    ...overrides,
  };
}

function chat(
  script: string,
  directory: string,
  name: string,
  chatScript: object,
): ReturnType<typeof createClaudeCodeModel> {
  const file = path.join(directory, `${name}.json`);
  writeFileSync(file, JSON.stringify(chatScript));
  return model(script, directory, 'chat', file);
}

function calls(directory: string, name: string): { args: string[] }[] {
  return readFileSync(path.join(directory, `${name}.json.calls`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { args: string[] });
}

async function waitFor(expect: ExpectStatic, isDone: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !isDone(); attempt += 1) {
    await delay(25);
  }
  expect(isDone()).toBe(true);
}

async function expectReaped(expect: ExpectStatic, pidFile: string): Promise<void> {
  const pids = z
    .object({ self: z.number(), child: z.number() })
    .parse(JSON.parse(readFileSync(pidFile, 'utf8')));
  await waitFor(expect, () => !isAlive(pids.self) && !isAlive(pids.child));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
