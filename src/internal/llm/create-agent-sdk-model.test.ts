import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { z } from 'zod';

import { createAgentSdkModel } from './create-agent-sdk-model.ts';
import type { AgentSdkModelOptions } from './create-agent-sdk-model.ts';
import type { ModelProgress, TextModelRequest, TextStreamEvent } from './language-model.ts';
import type { FakeMessagesApi, RecordedRequest } from './testing/start-fake-messages-api.ts';
import { test } from './testing/test.ts';

/** The adapter over the real bundled Claude Code, pointed at the fake API. */
function model(
  api: FakeMessagesApi,
  directory: string,
  overrides: Partial<AgentSdkModelOptions> = {},
): ReturnType<typeof createAgentSdkModel> {
  return createAgentSdkModel({
    apiKey: 'sk-ant-test-key',
    baseUrl: api.baseUrl,
    maxRetries: 0,
    inheritedEnv: { PATH: process.env['PATH'], HOME: directory },
    ...overrides,
  });
}

/** A worktree with one file, beside a secret outside it. */
function worktree(directory: string): { readonly cwd: string; readonly secret: string } {
  const cwd = path.join(directory, 'worktree');
  mkdirSync(path.join(cwd, 'src'), { recursive: true });
  writeFileSync(path.join(cwd, 'src', 'greet.ts'), 'export const greeting = "hello world";\n');
  const secret = path.join(directory, 'secret.txt');
  writeFileSync(secret, 'TOP-SECRET-VALUE\n');
  return { cwd, secret };
}

function textRequest(cwd: string, overrides: Partial<TextModelRequest> = {}): TextModelRequest {
  return {
    system: 'Answer briefly.',
    messages: [{ role: 'user', content: 'What does src/greet.ts export?' }],
    cwd,
    timeout: Temporal.Duration.from({ seconds: 30 }),
    ...overrides,
  };
}

/** The main-loop requests to the Messages API (Claude Code may make others). */
function messageRequests(api: FakeMessagesApi): RecordedRequest[] {
  return api.requests.filter((request) => request.url.startsWith('/v1/messages?'));
}

/** The tool results Claude Code sent back in its last user message. */
function lastToolResults(api: FakeMessagesApi): unknown[] {
  const messages = (messageRequests(api).at(-1)?.body?.['messages'] ?? []) as {
    role: string;
    content: unknown;
  }[];
  const user = messages.findLast((message) => message.role === 'user');
  return Array.isArray(user?.content)
    ? user.content.filter(
        (block: { type?: string }) => typeof block === 'object' && block.type === 'tool_result',
      )
    : [];
}

// Each test starts a real Claude Code process: one at a time, so they don't starve each other of CPU.
describe('createAgentSdkModel', { concurrent: false, timeout: 30_000 }, () => {
  test('streams a text answer from Claude Code authenticated with the API key only', async ({
    expect,
    messagesApi: api,
    tempDir,
    logger,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    api.reply({
      kind: 'message',
      content: [{ type: 'text', text: 'It exports greeting.' }],
      stopReason: 'end_turn',
    });
    const streamed: TextStreamEvent[] = [];
    const progress: ModelProgress[] = [];
    const output = okValueFrom(
      await model(api, tempDir, { logger: logger.logger, effort: 'low' }).runText(
        textRequest(cwd, {
          onText: (event) => {
            streamed.push(event);
          },
          onProgress: (event) => {
            progress.push(event);
          },
          signal,
        }),
      ),
    );
    expect(output).toMatchObject({
      value: 'It exports greeting.',
      model: 'claude-opus-5-5',
      turns: 1,
      deniedToolUses: 0,
    });
    expect(output.costUsd).toBeGreaterThan(0);
    expect(output.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(streamed).toStrictEqual([{ kind: 'append', text: 'It exports greeting.' }]);
    expect(progress).toStrictEqual([
      { kind: 'started', model: 'claude-opus-5-5' },
      { kind: 'text-start' },
      { kind: 'text-end' },
    ]);

    const [sent] = messageRequests(api);
    expect(sent?.headers['x-api-key']).toBe('sk-ant-test-key');
    expect(sent?.headers.authorization).toBeUndefined();
    expect(sent?.body).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'low' },
      thinking: { type: 'adaptive' },
      stream: true,
    });
    const tools = (sent?.body?.['tools'] as { name: string }[])
      .map((tool) => tool.name)
      .filter((name) => name !== 'DeferredToolPlaceholder')
      .toSorted((a, b) => a.localeCompare(b));
    expect(tools).toStrictEqual(['Glob', 'Grep', 'Read']);
    expect(JSON.stringify(logger.lines)).not.toContain('sk-ant-test-key');
  });

  test('runs Read and Grep in the worktree, resetting the preview at each new message', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    api.reply(
      {
        kind: 'message',
        content: [
          { type: 'text', text: 'Let me look.' },
          {
            type: 'tool_use',
            id: 'toolu_read',
            name: 'Read',
            input: { file_path: path.join(cwd, 'src/greet.ts') },
          },
          {
            type: 'tool_use',
            id: 'toolu_grep',
            name: 'Grep',
            input: { pattern: 'hello', output_mode: 'content' },
          },
        ],
        stopReason: 'tool_use',
      },
      {
        kind: 'message',
        content: [{ type: 'text', text: 'It says hello world.' }],
        stopReason: 'end_turn',
      },
    );
    const streamed: TextStreamEvent[] = [];
    const tools: string[] = [];
    const output = okValueFrom(
      await model(api, tempDir).runText(
        textRequest(cwd, {
          onText: (event) => {
            streamed.push(event);
          },
          onProgress: (event) => {
            tools.push(
              event.kind === 'tool-start'
                ? event.description
                : event.kind === 'tool-end'
                  ? `${event.tool} ${event.ok ? 'ok' : 'failed'}`
                  : event.kind,
            );
          },
          signal,
        }),
      ),
    );
    expect(output).toMatchObject({ value: 'It says hello world.', deniedToolUses: 0 });
    expect(streamed).toStrictEqual([
      { kind: 'append', text: 'Let me look.' },
      { kind: 'reset' },
      { kind: 'append', text: 'It says hello world.' },
    ]);
    const steps = tools.filter((entry) => !entry.startsWith('text-'));
    expect(steps.slice(0, 3)).toStrictEqual(['started', 'read src/greet.ts', 'grep hello']);
    // Claude Code runs both reads at once, so they may finish in either order.
    expect(steps.slice(3).toSorted((left, right) => left.localeCompare(right))).toStrictEqual([
      'Grep ok',
      'Read ok',
    ]);
    const results = JSON.stringify(lastToolResults(api));
    expect(results).toContain('hello world');
    expect(results).toContain('greet.ts');
  });

  test('refuses reads outside the worktree, directly and through a symlink', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd, secret } = worktree(tempDir);
    symlinkSync(secret, path.join(cwd, 'link.txt'));
    api.reply(
      {
        kind: 'message',
        content: [
          { type: 'tool_use', id: 'toolu_out', name: 'Read', input: { file_path: secret } },
          {
            type: 'tool_use',
            id: 'toolu_up',
            name: 'Read',
            input: { file_path: path.join(cwd, '../secret.txt') },
          },
          {
            type: 'tool_use',
            id: 'toolu_link',
            name: 'Read',
            input: { file_path: path.join(cwd, 'link.txt') },
          },
          {
            type: 'tool_use',
            id: 'toolu_grep',
            name: 'Grep',
            input: { pattern: 'TOP-SECRET', path: tempDir },
          },
        ],
        stopReason: 'tool_use',
      },
      {
        kind: 'message',
        content: [{ type: 'text', text: 'Could not read it.' }],
        stopReason: 'end_turn',
      },
    );
    const output = okValueFrom(await model(api, tempDir).runText(textRequest(cwd, { signal })));
    expect(output.deniedToolUses).toBe(4);
    expect(JSON.stringify(lastToolResults(api))).not.toContain('TOP-SECRET-VALUE');
  });

  test('has no tool that writes or runs commands', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    const target = path.join(cwd, 'written.txt');
    api.reply(
      {
        kind: 'message',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_write',
            name: 'Write',
            input: { file_path: target, content: 'x' },
          },
          {
            type: 'tool_use',
            id: 'toolu_bash',
            name: 'Bash',
            input: { command: `touch ${target}` },
          },
        ],
        stopReason: 'tool_use',
      },
      { kind: 'message', content: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' },
    );
    okValueFrom(await model(api, tempDir).runText(textRequest(cwd, { signal })));
    expect(existsSync(target)).toBe(false);
    expect(JSON.stringify(lastToolResults(api))).toContain('is_error');
  });

  test('returns structured output that matches the schema', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    api.reply(
      {
        kind: 'message',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_out',
            name: 'StructuredOutput',
            input: { exports: ['greeting'] },
          },
        ],
        stopReason: 'tool_use',
      },
      { kind: 'message', content: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' },
    );
    const outputSchema = z.object({ exports: z.array(z.string()) });
    const output = okValueFrom(
      await model(api, tempDir).run({ ...textRequest(cwd, { signal }), outputSchema }),
    );
    expect(output.value).toStrictEqual({ exports: ['greeting'] });
    const [sent] = messageRequests(api);
    const tools = (sent?.body?.['tools'] as { name: string }[]).map((tool) => tool.name);
    expect(tools).toContain('StructuredOutput');
  });

  test('reports output that fails the schema as invalid-output', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    api.reply(
      {
        kind: 'message',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_out',
            name: 'StructuredOutput',
            input: { exports: ['Greeting'] },
          },
        ],
        stopReason: 'tool_use',
      },
      { kind: 'message', content: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' },
    );
    const lowercase = z.array(
      z.string().refine((name) => name === name.toLowerCase(), 'lowercase'),
    );
    await expect(
      model(api, tempDir).run({
        ...textRequest(cwd, { signal }),
        outputSchema: z.object({ exports: lowercase }),
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-output' } });
  });

  test('retries a refusal on Claude Code’s fallback model', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    api.reply(
      { kind: 'message', content: [{ type: 'text', text: 'I can' }], stopReason: 'refusal' },
      { kind: 'message', content: [{ type: 'text', text: 'I can' }], stopReason: 'refusal' },
      {
        kind: 'message',
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: 'It exports greeting.' }],
        stopReason: 'end_turn',
      },
    );
    const streamed: TextStreamEvent[] = [];
    const output = okValueFrom(
      await model(api, tempDir).runText(
        textRequest(cwd, {
          onText: (event) => {
            streamed.push(event);
          },
          signal,
        }),
      ),
    );
    expect(output).toMatchObject({ value: 'It exports greeting.', model: 'claude-opus-4-8' });
    expect(messageRequests(api).map((request) => request.body?.['model'])).toStrictEqual([
      'claude-opus-5-5',
      'claude-opus-5-5',
      'claude-opus-4-8',
    ]);
    expect(streamed.at(-2)).toStrictEqual({ kind: 'reset' });
    expect(streamed.at(-1)).toStrictEqual({ kind: 'append', text: 'It exports greeting.' });
  });

  test('fails when the fallback model refuses too', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    const refusal = {
      kind: 'message',
      content: [{ type: 'text', text: 'No' }],
      stopReason: 'refusal',
    } as const;
    api.reply(refusal, refusal, { ...refusal, model: 'claude-opus-4-8' }, refusal, refusal);
    await expect(model(api, tempDir).runText(textRequest(cwd, { signal }))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'model-failed' },
    });
  });

  test('maps a 401 to not-authenticated', async ({ expect, messagesApi: api, tempDir, signal }) => {
    const { cwd } = worktree(tempDir);
    api.reply({
      kind: 'error',
      status: 401,
      type: 'authentication_error',
      message: 'invalid x-api-key',
    });
    await expect(model(api, tempDir).runText(textRequest(cwd, { signal }))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-authenticated' },
    });
  });

  test('maps a 429 to rate-limited', async ({ expect, messagesApi: api, tempDir, signal }) => {
    const { cwd } = worktree(tempDir);
    api.reply({
      kind: 'error',
      status: 429,
      type: 'rate_limit_error',
      message: 'Number of request tokens has exceeded your rate limit',
      headers: { 'retry-after': '30' },
    });
    await expect(model(api, tempDir).runText(textRequest(cwd, { signal }))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'rate-limited' },
    });
  });

  test('requires an API key', async ({ expect, messagesApi: api, tempDir, signal }) => {
    const { cwd } = worktree(tempDir);
    await expect(
      model(api, tempDir, { apiKey: ' ' }).runText(textRequest(cwd, { signal })),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not-authenticated', message: 'No Anthropic API key is set.' },
    });
    expect(api.requests).toStrictEqual([]);
  });

  test(
    'stops at the timeout',
    { timeout: 20_000 },
    async ({ expect, messagesApi: api, tempDir, signal }) => {
      const { cwd } = worktree(tempDir);
      api.reply({ kind: 'hang', text: 'Thinking about' });
      const timeout = Temporal.Duration.from({ seconds: 2 });
      await expect(
        model(api, tempDir).runText(textRequest(cwd, { timeout, signal })),
      ).resolves.toStrictEqual({ ok: false, error: { kind: 'timeout', timeout } });
    },
  );

  test('stops when the signal aborts', async ({ expect, messagesApi: api, tempDir }) => {
    const { cwd } = worktree(tempDir);
    api.reply({ kind: 'hang', text: 'Thinking about' });
    const controller = new AbortController();
    await expect(
      model(api, tempDir).runText(
        textRequest(cwd, {
          signal: controller.signal,
          onText: () => {
            controller.abort();
          },
        }),
      ),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  test('reports a missing Claude Code binary as not-installed', async ({
    expect,
    messagesApi: api,
    tempDir,
    signal,
  }) => {
    const { cwd } = worktree(tempDir);
    const missing = path.join(tempDir, 'no-such-claude');
    await expect(
      model(api, tempDir, { pathToClaudeCodeExecutable: missing }).runText(
        textRequest(cwd, { signal }),
      ),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'not-installed', command: missing } });
  });
});
