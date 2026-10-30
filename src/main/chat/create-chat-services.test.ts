import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import type { ChatMessageView, IpcResult } from '#contract/ipc-contract.ts';
import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import type { ChatMessageId, CommitSha, SessionId } from '#internal/chat/chat-message.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';

import { createSessionWorktrees } from '../worktrees/create-session-worktrees.ts';
import { waitUntil } from '../testing/wait-until.ts';
import { createChatServices } from './create-chat-services.ts';
import { test } from './testing/test.ts';
import { waitForSettled } from './testing/wait-for-settled.ts';

/** The chat through `createMainServices`, a temporary repository and the fake `claude` (ADR 0031). */
describe(
  'createChatServices (integration: SQLite + git + fake claude, no Electron)',
  { timeout: 30_000 },
  () => {
    test('answers in the background: deltas, then a stored answer with validated citations', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: answerChunks(), delayMs: 20 });
      const { chat, sessionId, deltas, updates, settled } = await startChat(claude.settings);

      const asked = okValueFrom(
        await chat.ask({
          sessionId,
          question: ' What does it add? ',
          focus: { path: 'feature.rs' },
        }),
      );
      expect(asked.question).toMatchObject({
        role: 'user',
        content: 'What does it add?',
        status: 'complete',
      });
      expect(asked.answer).toMatchObject({ role: 'assistant', status: 'streaming', content: '' });
      expect(updates).toStrictEqual([]);

      const done = await settled(asked.answer.id);
      expect(done).toMatchObject({
        status: 'complete',
        content: answerText(),
        citations: [{ path: 'feature.rs', startLine: 1, endLine: 2 }],
      });
      expect(deltas.map(({ kind, text }) => [kind, text])).toStrictEqual([
        ['append', 'Looking.'],
        ['reset', ''],
        ['append', 'It adds '],
        ['append', '[[feature.rs:1-2]] and '],
        ['append', 'ignores [[ghost.rs:4]].'],
      ]);
      expect(deltas.every(({ messageId }) => messageId === asked.answer.id)).toBe(true);

      const listed = okValueFrom(chat.list({ sessionId }));
      expect(listed.messages.map(({ id, role, status }) => [id, role, status])).toStrictEqual([
        [asked.question.id, 'user', 'complete'],
        [asked.answer.id, 'assistant', 'complete'],
      ]);
      expect(listed.messages[1]).toStrictEqual(done);

      const [call] = claude.calls();
      expect(call?.cwd).toContain('worktrees');
      expect(call?.args).toContain('--include-partial-messages');
      expect(call?.stdin).toContain('What does it add?');
      expect(call?.stdin).toContain('feature.rs');
    });

    test('puts the earlier turns into the next prompt', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['First answer about the feature.'] });
      const { chat, sessionId, settled } = await startChat(claude.settings);
      const first = okValueFrom(await chat.ask({ sessionId, question: 'First question?' }));
      await settled(first.answer.id);
      const second = okValueFrom(await chat.ask({ sessionId, question: 'Second question?' }));
      await settled(second.answer.id);
      const [firstCall, secondCall] = claude.calls();
      expect(firstCall?.stdin).not.toContain('First answer about the feature.');
      expect(secondCall?.stdin).toContain('First question?');
      expect(secondCall?.stdin).toContain('First answer about the feature.');
      expect(secondCall?.stdin.indexOf('Second question?')).toBeGreaterThan(
        secondCall?.stdin.indexOf('First answer about the feature.') ?? Infinity,
      );
    });

    test('queues questions asked while one streams, runs them in order and cancels one at a time', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['a', 'b', 'c'], delayMs: 120 });
      const { chat, sessionId, deltas, updates, settled } = await startChat(claude.settings);
      const first = okValueFrom(await chat.ask({ sessionId, question: 'First?' }));
      const second = okValueFrom(await chat.ask({ sessionId, question: 'Second?' }));
      const third = okValueFrom(await chat.ask({ sessionId, question: 'Third?' }));
      const fourth = okValueFrom(await chat.ask({ sessionId, question: 'Fourth?' }));
      expect(first.answer.status).toBe('streaming');
      expect([second, third, fourth].map(({ answer }) => answer.status)).toStrictEqual([
        'queued',
        'queued',
        'queued',
      ]);
      expect(
        okValueFrom(chat.list({ sessionId })).messages.map(({ status }) => status),
      ).toStrictEqual([
        'complete',
        'streaming',
        'complete',
        'queued',
        'complete',
        'queued',
        'complete',
        'queued',
      ]);

      await waitUntil(
        () => deltas.some(({ messageId, text }) => messageId === first.answer.id && text === 'a'),
        'the first answer to stream',
      );
      expect(okValueFrom(chat.cancel({ messageId: first.answer.id }))).toStrictEqual({
        cancelled: true,
      });
      expect(okValueFrom(chat.cancel({ messageId: third.answer.id }))).toStrictEqual({
        cancelled: true,
      });
      await expect(settled(first.answer.id)).resolves.toMatchObject({
        status: 'cancelled',
        content: 'a',
      });
      await expect(settled(third.answer.id)).resolves.toMatchObject({
        status: 'cancelled',
        content: '',
      });
      await expect(settled(fourth.answer.id)).resolves.toMatchObject({
        status: 'complete',
        content: 'abc',
      });
      const order = updates
        .filter(({ status }) => status === 'streaming' || status === 'complete')
        .map(({ id, status }) => [id, status]);
      expect(order).toStrictEqual([
        [second.answer.id, 'streaming'],
        [second.answer.id, 'complete'],
        [fourth.answer.id, 'streaming'],
        [fourth.answer.id, 'complete'],
      ]);
      const asked = claude
        .calls()
        .map(({ stdin }) =>
          ['First?', 'Second?', 'Third?', 'Fourth?'].findLast((question) =>
            stdin.includes(question),
          ),
        );
      expect(asked).toStrictEqual(['First?', 'Second?', 'Fourth?']);
      expect(claude.calls()[2]?.stdin).toContain('abc');
    });

    test('cancels the running answer and the queued requests when the session head moves', async ({
      expect,
      fakeClaude,
      startChat,
      repo,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['a', 'b', 'c'], delayMs: 1500 });
      const { services, chat, sessionId, deltas, updates, settled } = await startChat(
        claude.settings,
      );
      const running = okValueFrom(await chat.ask({ sessionId, question: 'Running?' }));
      const waiting = okValueFrom(await chat.ask({ sessionId, question: 'Waiting?' }));
      const compaction = okValueFrom(
        await chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
      );
      expect([running, waiting, compaction].map(({ answer }) => answer.status)).toStrictEqual([
        'streaming',
        'queued',
        'queued',
      ]);
      await waitUntil(
        () => deltas.some(({ messageId, text }) => messageId === running.answer.id && text === 'a'),
        'the running answer to stream',
      );

      await repo.git('switch', '--quiet', 'feature');
      repo.write('more.rs', 'pub fn more() {}\n');
      await repo.commit('push');
      await repo.git('switch', '--quiet', 'main');
      okValueFrom(await services.sessions.getReview({ sessionId }));

      // The queue drop is synchronous with the head refresh. A queued request that was merely left to
      // start would still be queued here, and cancelled only once `prepare` saw the moved head.
      const statuses = new Map(
        okValueFrom(chat.list({ sessionId })).messages.map(({ id, status }) => [id, status]),
      );
      expect(statuses.get(waiting.answer.id)).toBe('cancelled');
      expect(statuses.get(compaction.answer.id)).toBe('cancelled');
      expect(updates.map(({ id }) => id)).toContain(waiting.answer.id);
      expect(updates.map(({ id }) => id)).toContain(compaction.answer.id);

      await expect(settled(running.answer.id)).resolves.toMatchObject({ status: 'cancelled' });
      await expect(settled(waiting.answer.id)).resolves.toMatchObject({
        status: 'cancelled',
        content: '',
      });
      await expect(settled(compaction.answer.id)).resolves.toMatchObject({
        status: 'cancelled',
        content: '',
      });
      claude.rescript(['a', 'b', 'c'], 0);
      const after = okValueFrom(await chat.ask({ sessionId, question: 'After the push?' }));
      await expect(settled(after.answer.id)).resolves.toMatchObject({
        status: 'complete',
        content: 'abc',
      });
      expect(claude.calls()).toHaveLength(2);
    });

    test('queues requests made at the same moment in the order they were made', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['x'], delayMs: 200 });
      const { services, chat, sessionId } = await startChat(claude.settings);
      const review = okValueFrom(await services.sessions.getReview({ sessionId }));
      const mention = { path: 'feature.rs', side: 'head', sha: review.headSha } as const;
      const asked = await Promise.all([
        chat.ask({ sessionId, question: 'One?' }),
        chat.ask({ sessionId, question: 'Two [[@1]]?', mentions: [mention] }),
        chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
        chat.ask({ sessionId, question: 'Four?' }),
      ]);
      const questions = okValueFrom(chat.list({ sessionId }))
        .messages.filter(({ role }) => role === 'user')
        .map(({ content }) => content);
      expect(questions).toStrictEqual(['One?', 'Two [[@1]]?', '/summarize', 'Four?']);
      expect(asked.map((result) => okValueFrom(result).answer.status)).toStrictEqual([
        'streaming',
        'queued',
        'queued',
        'queued',
      ]);
      okValueFrom(chat.clear({ sessionId }));
    });

    test('bounds the queue, and /clear stops the running answer and empties the queue', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['a', 'b', 'c'], delayMs: 300 });
      const { chat, sessionId, updates } = await startChat(claude.settings);
      const running = okValueFrom(await chat.ask({ sessionId, question: 'Running?' }));
      const queued = [];
      for (let index = 0; index < 10; index += 1) {
        const asked = await chat.ask({ sessionId, question: `Queued ${String(index)}?` });
        queued.push(okValueFrom(asked));
      }
      await expect(chat.ask({ sessionId, question: 'One too many?' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'refused', message: expect.stringContaining('already waiting') as string },
      });
      expect(okValueFrom(chat.clear({ sessionId, queuedOnly: true }))).toStrictEqual({
        removed: 20,
      });
      expect(okValueFrom(chat.list({ sessionId })).messages.map(({ id }) => id)).toStrictEqual([
        running.question.id,
        running.answer.id,
      ]);
      const later = okValueFrom(await chat.ask({ sessionId, question: 'Later?' }));
      expect(later.answer.status).toBe('queued');

      expect(okValueFrom(chat.clear({ sessionId }))).toStrictEqual({ removed: 4 });
      await delay(400);
      expect(claude.calls().length).toBeLessThanOrEqual(1);
      expect(updates.filter(({ id }) => id === later.answer.id)).toStrictEqual([]);
      expect(okValueFrom(chat.list({ sessionId })).messages).toStrictEqual([]);
      expect(queued).toHaveLength(10);
    });

    test('answers /review with verified, structured findings, stages one, and reuses the answer', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted(
        {
          chunks: ['Follow-up answer.'],
          structured: {
            findings: [
              modelFinding('feature.rs', 2, 'warning', 'The constant hides a missing computation'),
              modelFinding('feature.rs', 3, 'risk', 'The closing brace swallows a return'),
              modelFinding('feature.rs', 40, 'info', 'Outside the diff'),
              modelFinding('missing.rs', 1, 'info', 'Not in the diff'),
            ],
            verdicts: [
              { finding: 1, verdict: 'confirmed', reason: 'Line 2 returns a constant.' },
              { finding: 2, verdict: 'refuted', reason: 'Line 3 is only a brace.' },
            ],
          },
        },
        'review',
      );
      const { services, chat, sessionId, deltas, settled } = await startChat(claude.settings);
      const asked = okValueFrom(
        await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
      );
      expect(asked.answer).toMatchObject({ answerKind: 'review', status: 'streaming' });
      const reviewed = await settled(asked.answer.id);
      expect(reviewed).toMatchObject({
        status: 'complete',
        answerKind: 'review',
        citations: [{ path: 'feature.rs', startLine: 2, endLine: 2 }],
        review: {
          findings: [
            {
              path: 'feature.rs',
              startLine: 2,
              endLine: 2,
              severity: 'warning',
              category: 'edge-case',
              title: 'The constant hides a missing computation',
              confidence: 0.8,
              check: 'confirmed',
            },
          ],
          dropped: { unknownFile: 1, outsideDiff: 1, unconfirmed: 1 },
          pathScope: [],
          fileCount: 1,
          verification: 'verified',
        },
      });
      expect(reviewed.content).toContain('1 dropped as unconfirmed');
      expect(reviewed.content).toContain('[[feature.rs:2-2]]');
      expect(deltas.filter(({ kind }) => kind === 'progress').map(({ text }) => text)).toContain(
        'Checking 2 findings against the code',
      );

      const [find, verify] = claude.calls();
      expect(find?.args.some((arg) => arg.startsWith('--json-schema='))).toBe(true);
      expect(find?.stdin).toContain('## Task');
      expect(find?.stdin).toContain('Review the whole change');
      expect(find?.stdin).toContain('## Diff');
      expect(verify?.args).toContain('--effort=low');
      expect(verify?.stdin).toContain('# Findings to check');
      expect(verify?.stdin).toContain('## Finding 2: feature.rs:3-3 (risk, edge-case)');
      expect(verify?.stdin).not.toContain('## Diff');

      const staged = okValueFrom(
        await services.ura.stageReviewFinding({ messageId: asked.answer.id, finding: 0 }),
      );
      expect(staged).toMatchObject({
        created: true,
        item: {
          severity: 'issue',
          origin: { kind: 'chat-answer', messageId: asked.answer.id, finding: 0 },
          anchor: { kind: 'lines', path: 'feature.rs', startLine: 2, endLine: 2 },
          title: 'The constant hides a missing computation',
        },
      });

      const again = okValueFrom(
        await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
      );
      await expect(settled(again.answer.id)).resolves.toMatchObject({
        status: 'complete',
        review: { reusedFrom: asked.answer.id, findings: [{ check: 'confirmed' }] },
      });
      expect(claude.calls()).toHaveLength(2);

      const fresh = okValueFrom(
        await chat.ask({
          sessionId,
          question: '/review --fresh --no-verify feature.rs',
          command: { kind: 'review', fresh: true, verify: false, pathPrefixes: ['feature.rs'] },
        }),
      );
      await expect(settled(fresh.answer.id)).resolves.toMatchObject({
        status: 'complete',
        review: {
          pathScope: ['feature.rs'],
          verification: 'skipped',
          findings: [{ check: 'unchecked' }, { check: 'unchecked' }],
        },
      });
      expect(claude.calls()).toHaveLength(3);
      expect(claude.calls()[2]?.stdin).toContain('only the files at or under feature.rs');

      const nothing = okValueFrom(
        await chat.ask({
          sessionId,
          question: '/review docs',
          command: { kind: 'review', pathPrefixes: ['docs'] },
        }),
      );
      await expect(settled(nothing.answer.id)).resolves.toMatchObject({
        status: 'failed',
        errorCode: 'nothing-to-review',
      });

      const followUp = okValueFrom(await chat.ask({ sessionId, question: 'Is finding 1 real?' }));
      await settled(followUp.answer.id);
      expect(claude.calls().at(-1)?.stdin).toContain('The constant hides a missing computation');
    });

    test('explains a missing Claude Code and a logged-out one', async ({
      expect,
      startChat,
      fakeClaude,
      tempDir,
    }) => {
      const missingClaude = await startChat({
        env: { BEUVE_CLAUDE_PATH: path.join(tempDir, 'no-claude'), PATH: '' },
        homeDirectory: tempDir,
      });
      const { chat, sessionId, settled } = missingClaude;
      const missing = okValueFrom(await chat.ask({ sessionId, question: 'Anyone there?' }));
      await expect(settled(missing.answer.id)).resolves.toMatchObject({
        status: 'failed',
        errorCode: 'not-installed',
        errorMessage: expect.stringContaining('BEUVE_CLAUDE_PATH') as string,
      });
      expect(okValueFrom(chat.list({ sessionId })).messages[1]).toMatchObject({
        status: 'failed',
        errorCode: 'not-installed',
      });
      await missingClaude.services.dispose();

      const loggedOut = await startChat({
        command: process.execPath,
        leadingArgs: [fakeClaude.script, 'not-logged-in'],
      });
      const second = okValueFrom(
        await loggedOut.chat.ask({ sessionId: loggedOut.sessionId, question: 'Hello?' }),
      );
      await expect(loggedOut.settled(second.answer.id)).resolves.toMatchObject({
        status: 'failed',
        errorCode: 'not-authenticated',
      });
    });

    test('clears the transcript, including an answer still streaming', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const quick = fakeClaude.scripted({ chunks: ['done'] }, 'quick');
      const first = await startChat(quick.settings);
      const { sessionId } = first;
      const asked = okValueFrom(await first.chat.ask({ sessionId, question: 'Quick?' }));
      await first.settled(asked.answer.id);
      expect(okValueFrom(first.chat.clear({ sessionId }))).toStrictEqual({ removed: 2 });
      expect(okValueFrom(first.chat.list({ sessionId })).messages).toStrictEqual([]);

      const slow = fakeClaude.scripted({ chunks: ['a', 'b', 'c'], delayMs: 500 }, 'slow');
      await first.services.dispose();
      const { chat, updates, settled } = await startChat(slow.settings);
      const streaming = okValueFrom(await chat.ask({ sessionId, question: 'Slow?' }));
      updates.length = 0;
      expect(okValueFrom(chat.clear({ sessionId }))).toStrictEqual({ removed: 2 });
      const again = okValueFrom(await chat.ask({ sessionId, question: 'Again?' }));
      expect(again.answer.id).not.toBe(streaming.answer.id);
      okValueFrom(chat.cancel({ messageId: again.answer.id }));
      await settled(again.answer.id);
      expect(updates.map(({ id }) => id)).toStrictEqual([again.answer.id]);
      expect(okValueFrom(chat.list({ sessionId })).messages).toHaveLength(2);
    });

    test('aborts an answer when the app quits, keeping what streamed', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['a', 'b'], delayMs: 2000 });
      const { services, chat, sessionId, deltas, settled } = await startChat(claude.settings);
      const asked = okValueFrom(await chat.ask({ sessionId, question: 'Slow?' }));
      await waitUntil(() => deltas.length > 0, 'the answer to start streaming');
      await services.dispose();
      await expect(settled(asked.answer.id)).resolves.toMatchObject({ status: 'cancelled' });
      await expect(chat.ask({ sessionId, question: 'Too late?' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'not-wired' },
      });
    });

    test('reads two mentions at their commits into the prompt, stores them and lists them', async ({
      expect,
      fakeClaude,
      startChat,
      repo,
    }) => {
      await repo.git('switch', '--quiet', 'feature');
      repo.write('app.rs', 'fn main() {\n  run();\n  stop();\n}\n');
      await repo.commit('stop too');
      await repo.git('switch', '--quiet', 'main');
      const claude = fakeClaude.scripted({ chunks: ['It returns [[feature.rs:2]].'] });
      const { services, chat, sessionId, settled } = await startChat(claude.settings);
      const review = okValueFrom(await services.sessions.getReview({ sessionId }));
      const mentions = [
        { path: 'feature.rs', side: 'head', startLine: 1, endLine: 2, sha: review.headSha },
        { path: 'app.rs', side: 'base', startLine: 2, endLine: 3, sha: review.baseSha },
      ] as const;
      const asked = okValueFrom(
        await chat.ask({ sessionId, question: 'Why [[@1]] and not [[@2]]?', mentions }),
      );
      expect(asked.question).toMatchObject({ content: 'Why [[@1]] and not [[@2]]?', mentions });
      await settled(asked.answer.id);

      const [call] = claude.calls();
      const stdin = call?.stdin ?? '';
      const selected = stdin.indexOf('## Selected by the reviewer');
      expect(selected).toBeGreaterThan(-1);
      expect(selected).toBeLessThan(stdin.indexOf('## Diff'));
      expect(stdin).toContain(
        `### Selection 1: feature.rs:1-2 (head ${review.headSha.slice(0, 12)})`,
      );
      expect(stdin).toContain('1  pub fn feature() -> u8 {\n2    1\n```');
      expect(stdin).toContain(
        `### Selection 2: base:app.rs:2-3 (base ${review.baseSha.slice(0, 12)})`,
      );
      expect(stdin).toContain('2    run();\n3  }\n```');
      expect(stdin).toContain(
        'Why «selection 1: feature.rs:1-2» and not «selection 2: base:app.rs:2-3»?',
      );

      const listed = okValueFrom(chat.list({ sessionId })).messages;
      expect(listed[0]).toMatchObject({ role: 'user', mentions });
      expect(listed[1]?.mentions).toStrictEqual([]);

      const followUp = okValueFrom(await chat.ask({ sessionId, question: 'And then?' }));
      await settled(followUp.answer.id);
      const second = claude.calls()[1]?.stdin ?? '';
      expect(second).not.toContain('## Selected by the reviewer');
      expect(second).toContain('[beuve: selection 1 was feature.rs:1-2]');
    });

    test('refuses mentions at another commit, of unknown files or past the end', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['x'] });
      const { services, chat, sessionId, settled } = await startChat(claude.settings);
      const review = okValueFrom(await services.sessions.getReview({ sessionId }));
      const refused = async (mention: {
        path: string;
        side: 'head' | 'base';
        startLine?: number;
        endLine?: number;
        sha: string;
      }): Promise<string> => {
        const result = await chat.ask({ sessionId, question: 'Why?', mentions: [mention] });
        expect(result).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
        return result.ok ? '' : result.error.message;
      };
      await expect(
        refused({
          path: 'feature.rs',
          side: 'head',
          startLine: 1,
          endLine: 1,
          sha: review.baseSha,
        }),
      ).resolves.toContain('Add it again');
      await expect(
        refused({ path: 'ghost.rs', side: 'head', sha: review.headSha }),
      ).resolves.toContain('neither in the review nor tracked');
      await expect(
        refused({ path: 'feature.rs', side: 'base', sha: review.baseSha }),
      ).resolves.toContain('neither in the review nor tracked');
      await expect(
        refused({
          path: 'feature.rs',
          side: 'head',
          startLine: 9,
          endLine: 9,
          sha: review.headSha,
        }),
      ).resolves.toContain('past the end');
      expect(okValueFrom(chat.list({ sessionId })).messages).toStrictEqual([]);

      const whole = okValueFrom(
        await chat.ask({
          sessionId,
          question: 'Explain [[@1]]',
          mentions: [{ path: 'app.rs', side: 'head', sha: review.headSha }],
        }),
      );
      await settled(whole.answer.id);
      expect(claude.calls()[0]?.stdin).toContain(
        `### Selection 1: app.rs (head ${review.headSha.slice(0, 12)}, whole file of 3 lines)`,
      );
    });

    test('compacts the conversation into a summary that later prompts send instead of its turns', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted(
        { chunks: ['The first answer about feature.'] },
        'compact',
      );
      const { chat, sessionId, settled } = await startChat(claude.settings);
      await expect(chat.compact({ sessionId })).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'refused',
          message: expect.stringContaining('Nothing to compact') as string,
        },
      });
      const first = okValueFrom(
        await chat.ask({ sessionId, question: 'What is the first question?' }),
      );
      await settled(first.answer.id);

      claude.rescript(
        ['**Asked**\n- what feature adds\n\n**Places**\n- [[feature.rs:1-3]] [[ghost.rs:1]]'],
        0,
      );
      const compacted = okValueFrom(await chat.compact({ sessionId }));
      expect(compacted).toMatchObject({
        outcome: 'compacted',
        summary: {
          role: 'summary',
          status: 'complete',
          content:
            '**Asked**\n- what feature adds\n\n**Places**\n- [[feature.rs:1-3]] `ghost.rs:1-1`',
          citations: [{ path: 'feature.rs', startLine: 1, endLine: 3 }],
        },
      });
      const compactCall = claude.calls()[1];
      expect(compactCall?.stdin).toContain('# Conversation to compact');
      expect(compactCall?.stdin).toContain('What is the first question?');
      expect(compactCall?.stdin).toContain('The first answer about feature.');
      expect(okValueFrom(chat.list({ sessionId })).messages.map(({ role }) => role)).toStrictEqual([
        'user',
        'assistant',
        'summary',
      ]);
      await expect(chat.compact({ sessionId })).resolves.toMatchObject({
        ok: false,
        error: { code: 'refused' },
      });

      claude.rescript(['A later answer.'], 0);
      const later = okValueFrom(
        await chat.ask({ sessionId, question: 'A question after the summary?' }),
      );
      await settled(later.answer.id);
      const laterCall = claude.calls()[2]?.stdin ?? '';
      expect(laterCall).toContain('## Summary of the conversation so far');
      expect(laterCall).toContain('- what feature adds');
      expect(laterCall).not.toContain('What is the first question?');
      expect(laterCall).not.toContain('The first answer about feature.');

      expect(okValueFrom(chat.clear({ sessionId }))).toStrictEqual({ removed: 5 });
      expect(okValueFrom(chat.list({ sessionId })).messages).toStrictEqual([]);
    });

    test('queues a question behind a running compaction, and cancels the compaction alone', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['Answer.'] }, 'slow-compact');
      const { chat, sessionId, settled } = await startChat(claude.settings);
      const first = okValueFrom(await chat.ask({ sessionId, question: 'Something?' }));
      await settled(first.answer.id);
      claude.rescript(['a', 'b', 'c'], 1000);
      const running = chat.compact({ sessionId });
      await waitUntil(() => claude.calls().length >= 2, 'the compaction to start');
      const next = okValueFrom(await chat.ask({ sessionId, question: 'Now?' }));
      expect(next.answer.status).toBe('queued');
      expect(okValueFrom(chat.cancel({ sessionId }))).toStrictEqual({ cancelled: true });
      expect(okValueFrom(await running)).toStrictEqual({ outcome: 'cancelled' });
      claude.rescript(['Later.'], 0);
      await expect(settled(next.answer.id)).resolves.toMatchObject({
        status: 'complete',
        content: 'Later.',
      });
      expect(okValueFrom(chat.list({ sessionId })).messages.map(({ role }) => role)).toStrictEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
    });

    test('rejects unknown sessions and shows an orphaned streaming answer as cancelled', async ({
      expect,
      fakeClaude,
      startChat,
      db,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['x'] });
      const { services, chat, sessionId } = await startChat(claude.settings);
      expect(chat.list({ sessionId: 'nope' })).toMatchObject({ ok: false });
      await expect(chat.ask({ sessionId: 'nope', question: 'Hi?' })).resolves.toMatchObject({
        ok: false,
      });
      expect(chat.clear({ sessionId: 'nope' })).toMatchObject({ ok: false });

      const head = okValueFrom(await services.sessions.getReview({ sessionId })).headSha;
      appendChatMessage(db, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ChatMessageId,
        sessionId: sessionId as SessionId,
        headSha: head as CommitSha,
        role: 'assistant',
        kind: 'answer',
        status: 'streaming',
        content: 'half an ans',
        citations: [],
        mentions: [],
        createdAt: '2026-10-28T11:00:00.000Z',
      });
      expect(okValueFrom(chat.list({ sessionId })).messages).toMatchObject([
        { status: 'cancelled', content: 'half an ans' },
      ]);
    });
  },
);

/**
 * `/summarize` straight through `createChatServices`, so the test can give the session a stated
 * intent (a pull request body) the way the GitHub services would.
 */
describe(
  'createChatServices /summarize (integration: fake claude, a stated intent)',
  { timeout: 30_000 },
  () => {
    test('summarizes from the diff alone, never sending the stated intent it gives questions', async ({
      expect,
      fakeClaude,
      createServices,
      repo,
      db,
      deps,
      logger,
      tempDir,
    }) => {
      const claude = fakeClaude.scripted(
        {
          chunks: [
            '**What changed** It adds `feature` [[feature.rs:1-3]].\n\n',
            '**Why** Inferred: a placeholder.',
          ],
        },
        'summary',
      );
      const main = createServices({ claude: claude.settings });
      const chat = createChatServices({
        context: { db, logger: logger.logger, deps, git: { logger: logger.logger } },
        impact: { getImpact: noImpact },
        worktrees: createSessionWorktrees({
          root: path.join(tempDir, 'chat-worktrees'),
          logger: logger.logger,
          git: { logger: logger.logger },
        }),
        claude: claude.settings,
        intentFor: () => 'AUTHOR-CLAIM: this change makes everything faster.',
      });
      const updates: ChatMessageView[] = [];
      chat.onMessageUpdated(({ message }) => {
        updates.push(message);
      });
      try {
        const { id: sessionId } = okValueFrom(
          await main.sessions.createLocal({
            repoPath: repo.directory,
            baseRef: 'main',
            headRef: 'feature',
          }),
        );
        const finished = async (id: string): Promise<ChatMessageView> =>
          waitForSettled(updates, id);
        const summary = okValueFrom(
          await chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
        );
        const question = okValueFrom(await chat.ask({ sessionId, question: 'What is it for?' }));
        expect(summary.answer).toMatchObject({ answerKind: 'abstract', status: 'streaming' });
        expect(question.answer.status).toBe('queued');
        await expect(finished(summary.answer.id)).resolves.toMatchObject({
          status: 'complete',
          answerKind: 'abstract',
          citations: [{ path: 'feature.rs', startLine: 1, endLine: 3 }],
        });
        await finished(question.answer.id);
        const [summarized, asked] = claude.calls();
        expect(summarized?.args.some((arg) => arg.startsWith('--json-schema='))).toBe(false);
        expect(summarized?.stdin).toContain('## Task');
        expect(summarized?.stdin).toContain('feature.rs');
        expect(summarized?.stdin).not.toContain('AUTHOR-CLAIM');
        expect(summarized?.stdin).not.toContain('stated intent');
        expect(summarized?.args.join('\n')).toContain('**Why**');
        expect(asked?.stdin).toContain('AUTHOR-CLAIM');
      } finally {
        await chat.dispose();
      }
    });
  },
);

async function noImpact(): Promise<IpcResult<never>> {
  await Promise.resolve();
  return err({ code: 'not-wired', message: 'no impact here' });
}

function answerChunks(): string[] {
  return ['It adds ', '[[feature.rs:1-2]] and ', 'ignores [[ghost.rs:4]].'];
}

function answerText(): string {
  return 'It adds [[feature.rs:1-2]] and ignores `ghost.rs:4-4`.';
}

function modelFinding(path: string, line: number, severity: string, title: string): object {
  return {
    path,
    startLine: line,
    endLine: line,
    severity,
    category: 'edge-case',
    title,
    body: `**${title}**: check \`${path}\` line ${String(line)}.`,
    confidence: severity === 'risk' ? 0.9 : 0.8,
  };
}
