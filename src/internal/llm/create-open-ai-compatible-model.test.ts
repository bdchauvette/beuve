import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';
import { z } from 'zod';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { createOpenAiCompatibleModel } from './create-open-ai-compatible-model.ts';
import type { OpenAiCompatibleModelOptions } from './create-open-ai-compatible-model.ts';
import type { ModelProgress, TextModelRequest, TextStreamEvent } from './language-model.ts';
import { test } from './testing/test.ts';

function textRequest(cwd: string, overrides: Partial<TextModelRequest> = {}): TextModelRequest {
  return {
    system: 'Be brief.',
    messages: [
      { role: 'user', content: '# Change\n\ndiff', cache: true },
      { role: 'user', content: 'What changed?' },
    ],
    cwd,
    timeout: Temporal.Duration.from({ seconds: 10 }),
    ...overrides,
  };
}

function model(
  baseUrl: string,
  overrides: Partial<OpenAiCompatibleModelOptions> = {},
): ReturnType<typeof createOpenAiCompatibleModel> {
  return createOpenAiCompatibleModel({ baseUrl, model: 'qwen-test', ...overrides });
}

function findingsSchema(): z.ZodType<{ findings: string[] }> {
  return z.object({ findings: z.array(z.string()) });
}

describe('createOpenAiCompatibleModel', () => {
  test('streams a text answer from /chat/completions, with progress and usage', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    const api = await openAiApi();
    api.reply({ kind: 'stream', reasoning: 'hmm', content: ['It ', 'adds a ', 'parser.'] });
    const text: TextStreamEvent[] = [];
    const progress: ModelProgress[] = [];
    const output = okValueFrom(
      await model(api.baseUrl, { apiKey: 'sk-local', effort: 'xhigh' }).runText(
        textRequest(tempDir, {
          onText: (event) => {
            text.push(event);
          },
          onProgress: (event) => {
            progress.push(event);
          },
          signal,
        }),
      ),
    );
    expect(output).toMatchObject({
      value: 'It adds a parser.',
      model: 'qwen-test',
      turns: 1,
      deniedToolUses: 0,
      usage: { inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 2 },
    });
    expect(text.map((event) => (event.kind === 'append' ? event.text : '|'))).toStrictEqual([
      'It ',
      'adds a ',
      'parser.',
    ]);
    expect(progress).toStrictEqual([
      { kind: 'started', model: 'qwen-test' },
      { kind: 'thinking' },
      { kind: 'text-start' },
      { kind: 'text-end' },
    ]);
    const [sent] = api.requests;
    expect(sent?.authorization).toBe('Bearer sk-local');
    expect(sent?.body).toMatchObject({
      model: 'qwen-test',
      stream: true,
      reasoning_effort: 'high',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: '# Change\n\ndiff' },
        { role: 'user', content: 'What changed?' },
      ],
    });
    expect(sent?.body).not.toHaveProperty('tools');
    expect(sent?.body).not.toHaveProperty('response_format');
  });

  test('reports its capabilities and sends a request override of model and effort', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    const api = await openAiApi();
    api.reply({ kind: 'stream', content: ['ok'] });
    const configured = model(api.baseUrl, {
      contextWindowTokens: 32_768,
      tools: true,
      effort: 'medium',
    });
    expect(configured.capabilities).toStrictEqual({
      tools: true,
      structuredOutput: 'native',
      contextWindowTokens: 32_768,
      streaming: true,
    });
    await configured.runText(textRequest(tempDir, { model: 'other', effort: 'low', signal }));
    expect(api.requests[0]?.body).toMatchObject({ model: 'other', reasoning_effort: 'low' });
    api.reply({ kind: 'stream', content: ['ok'] });
    await model(api.baseUrl).runText(textRequest(tempDir, { effort: 'low', signal }));
    expect(api.requests[1]?.body).not.toHaveProperty('reasoning_effort');
  });

  test('asks for JSON Schema output natively and validates it', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    const api = await openAiApi();
    api.reply({ kind: 'stream', content: ['{"findings":', '["a"]}'] });
    const output = await model(api.baseUrl).run({
      ...textRequest(tempDir, { signal }),
      outputSchema: findingsSchema(),
    });
    expect(okValueFrom(output).value).toStrictEqual({ findings: ['a'] });
    expect(api.requests[0]?.body).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { name: 'answer' } },
    });
  });

  test('falls back to the schema in the prompt when the server refuses json_schema', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    const api = await openAiApi({ rejectsResponseFormat: true });
    api.reply({ kind: 'stream', content: ['Here:\n```json\n{"findings":[]}\n```'] });
    const output = await model(api.baseUrl).run({
      ...textRequest(tempDir, { signal }),
      outputSchema: findingsSchema(),
    });
    expect(okValueFrom(output).value).toStrictEqual({ findings: [] });
    expect(api.requests).toHaveLength(2);
    expect(api.requests[1]?.body).not.toHaveProperty('response_format');
    expect(JSON.stringify(api.requests[1]?.body)).toContain('It must match this');
  });

  test('prompts for the schema when configured, and rejects an answer that misses it', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    const api = await openAiApi();
    api.reply({ kind: 'stream', content: ['{"wrong":1}'] }, { kind: 'stream', content: ['no'] });
    const prompted = model(api.baseUrl, { structuredOutput: 'prompted' });
    expect(prompted.capabilities.structuredOutput).toBe('prompted');
    const request = { ...textRequest(tempDir, { signal }), outputSchema: findingsSchema() };
    await expect(prompted.run(request)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-output' },
    });
    await expect(prompted.run(request)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-output', reason: 'the answer is not JSON' },
    });
    expect(api.requests[0]?.body).not.toHaveProperty('response_format');
  });

  test('reads a plain JSON completion from a server that does not stream', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    const api = await openAiApi();
    api.reply({ kind: 'json', content: 'Whole answer.' });
    const output = await model(api.baseUrl).runText(textRequest(tempDir, { signal }));
    expect(okValueFrom(output).value).toBe('Whole answer.');
  });

  test('with tools, reads the worktree through the sandbox and answers', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    mkdirSync(path.join(tempDir, 'src'));
    writeFileSync(path.join(tempDir, 'src', 'auth.ts'), 'export function validate() {}\n');
    const api = await openAiApi();
    api.reply(
      {
        kind: 'stream',
        content: ['Let me look.'],
        toolCalls: [
          { id: 'c1', name: 'grep', arguments: '{"pattern":"validate("}' },
          {
            id: 'c2',
            name: 'read_file',
            arguments: '{"path":"src/auth.ts","start_line":1,"end_line":1}',
          },
          { id: 'c3', name: 'read_file', arguments: '{"path":"../outside.txt"}' },
        ],
      },
      { kind: 'stream', content: ['validate is new.'] },
    );
    const text: TextStreamEvent[] = [];
    const progress: ModelProgress[] = [];
    const output = okValueFrom(
      await model(api.baseUrl, { tools: true }).runText(
        textRequest(tempDir, {
          onText: (event) => {
            text.push(event);
          },
          onProgress: (event) => {
            progress.push(event);
          },
          signal,
        }),
      ),
    );
    expect(output).toMatchObject({ value: 'validate is new.', turns: 2, deniedToolUses: 1 });
    expect(text).toStrictEqual([
      { kind: 'append', text: 'Let me look.' },
      { kind: 'reset' },
      { kind: 'append', text: 'validate is new.' },
    ]);
    expect(progress.filter((event) => event.kind === 'tool-start')).toStrictEqual([
      { kind: 'tool-start', id: 'c1', tool: 'grep', description: 'grep validate(' },
      { kind: 'tool-start', id: 'c2', tool: 'read_file', description: 'read src/auth.ts:1-1' },
      { kind: 'tool-start', id: 'c3', tool: 'read_file', description: 'read ../outside.txt' },
    ]);
    expect(
      progress.filter((event) => event.kind === 'tool-end').map((event) => event.ok),
    ).toStrictEqual([true, true, false]);
    expect(api.requests[0]?.body).toMatchObject({
      tools: [
        { function: { name: 'read_file' } },
        { function: { name: 'grep' } },
        { function: { name: 'glob' } },
      ],
    });
    const second = api.requests[1]?.body?.['messages'] as { role: string; content: string }[];
    expect(
      second.filter((message) => message.role === 'tool').map((message) => message.content),
    ).toStrictEqual([
      'src/auth.ts:1: export function validate() {}',
      '1\texport function validate() {}',
      'refused: ../outside.txt is outside the working directory',
    ]);
  });

  test('stops a model that keeps calling tools', async ({ expect, openAiApi, tempDir, signal }) => {
    const api = await openAiApi();
    const call = {
      kind: 'stream',
      toolCalls: [{ id: 'g', name: 'glob', arguments: '{"pattern":"*"}' }],
    } as const;
    api.reply(call, call);
    await expect(
      model(api.baseUrl, { tools: true, maxTurns: 2 }).runText(textRequest(tempDir, { signal })),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'model-failed', reason: 'max-turns' } });
  });

  test.for([
    [401, {}, { kind: 'not-authenticated', message: 'bad key' }],
    [403, {}, { kind: 'not-authenticated', message: 'bad key' }],
    [404, {}, { kind: 'model-failed', reason: 'http-404', message: 'bad key', status: 404 }],
    [500, {}, { kind: 'model-failed', reason: 'http-500', message: 'bad key', status: 500 }],
  ] as const)(
    'maps HTTP %i to a model error',
    async ([status, headers, expected], { expect, openAiApi, tempDir, signal }) => {
      const api = await openAiApi();
      api.reply({ kind: 'error', status, body: '{"error":{"message":"bad key"}}', headers });
      await expect(
        model(api.baseUrl).runText(textRequest(tempDir, { signal })),
      ).resolves.toStrictEqual({
        ok: false,
        error: expected,
      });
    },
  );

  test('maps 429 to rate-limited with the retry time', async ({
    expect,
    openAiApi,
    tempDir,
    signal,
  }) => {
    const api = await openAiApi();
    api.reply({
      kind: 'error',
      status: 429,
      body: '{"error":"slow down"}',
      headers: { 'retry-after': '30' },
    });
    const output = await model(api.baseUrl).runText(textRequest(tempDir, { signal }));
    expect(output).toMatchObject({
      ok: false,
      error: {
        kind: 'rate-limited',
        message: 'slow down',
        resetsAt: expect.any(String) as string,
      },
    });
  });

  test('says when the server cannot be reached', async ({ expect, openAiApi, tempDir, signal }) => {
    const api = await openAiApi();
    api.close();
    await expect(
      model(api.baseUrl).runText(textRequest(tempDir, { signal })),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'model-failed', reason: 'unreachable' },
    });
  });

  test('times out, and cancels on the signal', async ({ expect, openAiApi, tempDir, signal }) => {
    const api = await openAiApi();
    api.reply({ kind: 'hang' }, { kind: 'hang' });
    const timeout = Temporal.Duration.from({ milliseconds: 200 });
    await expect(
      model(api.baseUrl).runText(textRequest(tempDir, { timeout, signal })),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'timeout', timeout } });
    const controller = new AbortController();
    const running = model(api.baseUrl).runText(textRequest(tempDir, { signal: controller.signal }));
    controller.abort();
    await expect(running).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  test('reports a caller’s own timeout signal as a cancellation', async ({
    expect,
    openAiApi,
    tempDir,
  }) => {
    const api = await openAiApi();
    api.reply({ kind: 'hang' });
    const signal = AbortSignal.timeout(100);
    await expect(
      model(api.baseUrl).runText(textRequest(tempDir, { signal })),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  test('refuses a request that does not end with the user', async ({ expect, tempDir, signal }) => {
    await expect(
      model('http://127.0.0.1:9/v1').runText(
        textRequest(tempDir, { messages: [{ role: 'assistant', content: 'hi' }], signal }),
      ),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-request', reason: 'the last message must be the user turn' },
    });
  });

  test('fails an answer larger than the limit', async ({ expect, openAiApi, tempDir, signal }) => {
    const api = await openAiApi();
    api.reply({ kind: 'stream', content: ['x'.repeat(5000)] });
    await expect(
      model(api.baseUrl, { maxResponseBytes: 1000 }).runText(textRequest(tempDir, { signal })),
    ).resolves.toStrictEqual({ ok: false, error: { kind: 'output-too-large', maxBytes: 1000 } });
  });
});
