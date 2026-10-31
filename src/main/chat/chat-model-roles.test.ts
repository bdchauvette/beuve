import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

/**
 * Roles from the model registry (ADR 0070) through the real chat queue: `/review` runs its first
 * pass on the `review` model and its verification on the `verify` model, here an
 * OpenAI-compatible server without tools (ADR 0071), and Settings' Test goes through the same
 * resolution.
 */
describe('chat: model roles (integration: SQLite + git + fake claude + fake OpenAI server)', () => {
  test('verifies /review findings on the verify role’s OpenAI-compatible model', async ({
    expect,
    fakeClaude,
    openAiApi,
    startChat,
  }) => {
    const claude = fakeClaude.scripted(
      {
        chunks: [],
        structured: {
          findings: [finding('The constant hides a missing computation')],
          verdicts: [{ finding: 1, verdict: 'refuted', reason: 'The CLI would refute it.' }],
        },
      },
      'roles',
    );
    const api = await openAiApi();
    api.reply({
      kind: 'stream',
      content: [
        '{"verdicts":[{"finding":1,"verdict":"confirmed",',
        '"reason":"Line 2 is a constant."}]}',
      ],
    });
    const { services, chat, sessionId, settled } = await startChat(claude.settings);
    const saved = okValueFrom(
      await services.models.save({
        label: 'Local verifier',
        kind: 'openai-compatible',
        model: 'qwen3:8b',
        baseUrl: api.baseUrl,
        tools: false,
        contextWindowTokens: 16_384,
      }),
    );
    const id = saved.entries.at(-1)?.id ?? '';
    expect(id).toMatch(/^openai-/u);
    const roles = okValueFrom(await services.models.setRole('verify', id)).roles;
    expect(roles).toMatchObject({ review: 'claude-code', verify: id });

    const asked = okValueFrom(
      await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
    );
    const answer = await settled(asked.answer.id);
    expect(answer.status).toBe('done');
    expect(answer.review?.findings).toMatchObject([{ startLine: 2, check: 'confirmed' }]);
    expect(answer.review?.verification).toBe('verified');
    expect(
      claude.calls().filter((call) => {
        return call.args.some((arg) => arg.includes('"verdicts"'));
      }),
    ).toStrictEqual([]);

    const [request] = api.requests;
    const messages = request?.body?.['messages'] as { role: string; content: string }[];
    expect(request?.body).toMatchObject({
      model: 'qwen3:8b',
      response_format: { type: 'json_schema' },
    });
    expect(request?.body).not.toHaveProperty('tools');
    expect(request?.body).not.toHaveProperty('reasoning_effort');
    expect(messages[0]?.content).toContain('You cannot read files');
    expect(messages[1]?.content).toContain('The diff at these lines:');
  });

  test('an OpenAI-compatible /review reads git objects with its tools and leases no checkout', async ({
    expect,
    fakeClaude,
    openAiApi,
    startChat,
    worktreeRoot,
  }) => {
    const claude = fakeClaude.scripted({ chunks: [] }, 'unused');
    const api = await openAiApi();
    api.reply(
      {
        kind: 'stream',
        toolCalls: [
          { id: 'g', name: 'glob', arguments: '{"pattern":"*.rs"}' },
          { id: 'r', name: 'read_file', arguments: '{"path":"feature.rs"}' },
          { id: 'e', name: 'read_file', arguments: '{"path":"../outside"}' },
        ],
      },
      {
        kind: 'stream',
        content: [JSON.stringify({ findings: [finding('The constant hides a computation')] })],
      },
      {
        kind: 'stream',
        content: ['{"verdicts":[{"finding":1,"verdict":"confirmed","reason":"Line 2."}]}'],
      },
    );
    const { services, chat, sessionId, settled } = await startChat(claude.settings);
    const saved = okValueFrom(
      await services.models.save({
        label: 'Local reviewer',
        kind: 'openai-compatible',
        model: 'qwen3:8b',
        baseUrl: api.baseUrl,
        tools: true,
        contextWindowTokens: 32_768,
      }),
    );
    const id = saved.entries.at(-1)?.id ?? '';
    okValueFrom(await services.models.setRole('review', id));
    okValueFrom(await services.models.setRole('verify', id));

    const asked = okValueFrom(
      await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
    );
    const answer = await settled(asked.answer.id);
    expect(answer.status).toBe('done');
    expect(answer.review?.findings).toMatchObject([{ startLine: 2, check: 'confirmed' }]);
    const second = api.requests[1]?.body?.['messages'] as { role: string; content: string }[];
    const tools = second.filter((message) => message.role === 'tool');
    expect(tools.map((message) => message.content)).toStrictEqual([
      'app.rs\nfeature.rs',
      expect.stringContaining('1\t') as string,
      'refused: ../outside is outside the working directory',
    ]);
    expect(claude.calls()).toStrictEqual([]);
    expect(existsSync(worktreeRoot)).toBe(false);
  });

  test('tests a registry entry through the chat queue, timed, with typed failures', async ({
    expect,
    openAiApi,
    fakeClaude,
    startChat,
  }) => {
    const claude = fakeClaude.scripted({ chunks: ['ok'] }, 'probe');
    const api = await openAiApi();
    api.reply({ kind: 'stream', content: ['ok'], model: 'qwen3:8b-q4' });
    api.reply({ kind: 'error', status: 401, body: '{"error":{"message":"invalid api key"}}' });
    const { services } = await startChat(claude.settings);
    const saved = okValueFrom(
      await services.models.save({
        label: 'Local',
        kind: 'openai-compatible',
        model: 'qwen3:8b',
        baseUrl: api.baseUrl,
        tools: false,
      }),
    );
    const id = saved.entries.at(-1)?.id ?? '';
    expect(okValueFrom(await services.models.test(id))).toMatchObject({
      outcome: 'ok',
      model: 'qwen3:8b-q4',
      elapsedMs: expect.any(Number) as number,
    });
    expect(okValueFrom(await services.models.test(id))).toMatchObject({
      outcome: 'failed',
      errorKind: 'not-authenticated',
      message: 'Not signed in: invalid api key',
    });
    expect(okValueFrom(await services.models.test('claude-code'))).toMatchObject({
      outcome: 'ok',
      model: 'fake-model-1',
    });
    const probe = claude.calls().at(-1)?.cwd ?? '';
    expect(path.basename(probe)).toMatch(/^beuve-model-test-/u);
    expect(existsSync(probe)).toBe(false);
  });
});

/** A finding on line 2 of `feature.rs`, the line the feature changed. */
function finding(title: string): object {
  const line = 2;
  return {
    path: 'feature.rs',
    startLine: line,
    endLine: line,
    severity: 'warning',
    category: 'edge-case',
    title,
    body: `**${title}**: check line ${String(line)}.`,
    confidence: 0.8,
  };
}
