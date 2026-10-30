import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import type { ChatMessageView, IpcResult } from '#contract/ipc-contract.ts';
import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import type { ChatMessageId, CommitSha, SessionId } from '#internal/chat/chat-message.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';
import { err } from '#x/result/err.ts';

import { loadSession } from '../sessions/load-session.ts';
import { createSessionWorktrees } from '../worktrees/create-session-worktrees.ts';
import { waitUntil } from '../testing/wait-until.ts';
import { createModelRegistryStore } from '../models/create-model-registry-store.ts';
import { createSecretStore } from '../models/create-secret-store.ts';
import { createChatServices } from './create-chat-services.ts';
import { test } from './testing/test.ts';
import { textOf } from './testing/text-of.ts';
import { waitForSettled } from './testing/wait-for-settled.ts';

/** The chat through `createMainServices`, a temporary repository and the fake `claude` (ADR 0031). */
describe(
  'createChatServices (integration: SQLite + git + fake claude, no Electron)',
  { timeout: 30_000 },
  () => {
    test('answers in the background: part events, then a stored answer with validated citations', async ({
      expect,
      fakeClaude,
      startChat,
    }) => {
      const claude = fakeClaude.scripted({ chunks: answerChunks(), delayMs: 20 });
      const { chat, sessionId, events, updates, settled } = await startChat(claude.settings);

      const asked = okValueFrom(
        await chat.ask({
          sessionId,
          question: ' What does it add? ',
          focus: { path: 'feature.rs' },
        }),
      );
      expect(asked.question).toMatchObject({
        role: 'user',
        parts: [{ kind: 'text', id: 'p1', text: 'What does it add?' }],
        status: 'done',
      });
      expect(asked.answer).toMatchObject({ role: 'assistant', status: 'submitted', parts: [] });
      expect(updates).toStrictEqual([]);

      const done = await settled(asked.answer.id);
      const grep = { kind: 'tool-call', id: 'p2', tool: 'Grep', description: 'grep feature' };
      expect(done).toMatchObject({
        status: 'done',
        parts: [
          { ...grep, state: 'done' },
          { kind: 'text', id: 'p3', text: answerText() },
        ],
        citations: [{ path: 'feature.rs', startLine: 1, endLine: 2 }],
      });
      expect(
        events.flatMap((event) =>
          event.type === 'status' ? [[event.status, event.activity]] : [],
        ),
      ).toStrictEqual([
        ['submitted', 'Asking Claude Code'],
        ['streaming', undefined],
        ['streaming', 'Claude Code is writing'],
        ['streaming', 'Claude Code: grep feature'],
        ['streaming', 'Claude Code is thinking'],
        ['streaming', 'Claude Code is writing'],
      ]);
      expect(
        events.flatMap((event) =>
          event.type === 'status'
            ? []
            : [
                'text' in event
                  ? [event.type, event.text]
                  : [event.type, 'part' in event ? event.part.id : ''],
              ],
        ),
      ).toStrictEqual([
        ['part-start', 'p1'],
        ['text-delta', 'Looking.'],
        ['part-start', 'p2'],
        ['part-end', 'p2'],
        ['part-discard', ''],
        ['part-start', 'p3'],
        ['text-delta', 'It adds '],
        ['text-delta', '[[feature.rs:1-2]] and '],
        ['text-delta', 'ignores [[ghost.rs:4]].'],
      ]);
      expect(events.every(({ messageId }) => messageId === asked.answer.id)).toBe(true);

      const listed = okValueFrom(chat.list({ sessionId }));
      expect(listed.messages.map(({ id, role, status }) => [id, role, status])).toStrictEqual([
        [asked.question.id, 'user', 'done'],
        [asked.answer.id, 'assistant', 'done'],
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
      // The first answer streams its preamble at once and holds its chunks far longer than the test,
      // so it is provably running until cancelled; later runs read the rescripted, instant answer.
      const claude = fakeClaude.scripted({
        preamble: 'Looking.',
        chunks: ['a', 'b', 'c'],
        delayMs: 600_000,
      });
      const { chat, sessionId, events, updates, settled } = await startChat(claude.settings);
      const first = okValueFrom(await chat.ask({ sessionId, question: 'First?' }));
      const second = okValueFrom(await chat.ask({ sessionId, question: 'Second?' }));
      const third = okValueFrom(await chat.ask({ sessionId, question: 'Third?' }));
      const fourth = okValueFrom(await chat.ask({ sessionId, question: 'Fourth?' }));
      expect(first.answer.status).toBe('submitted');
      expect([second, third, fourth].map(({ answer }) => answer.status)).toStrictEqual([
        'queued',
        'queued',
        'queued',
      ]);
      expect(
        okValueFrom(chat.list({ sessionId })).messages.map(({ status }) => status),
      ).toStrictEqual([
        'done',
        expect.stringMatching(/^(?:submitted|streaming)$/u),
        'done',
        'queued',
        'done',
        'queued',
        'done',
        'queued',
      ]);

      await waitUntil(
        () =>
          events.some(
            (event) =>
              event.messageId === first.answer.id &&
              event.type === 'part-end' &&
              event.part.kind === 'tool-call',
          ),
        'the first answer to read',
      );
      claude.rescript(['a', 'b', 'c'], 0);
      expect(okValueFrom(chat.cancel({ messageId: first.answer.id }))).toStrictEqual({
        cancelled: true,
      });
      expect(okValueFrom(chat.cancel({ messageId: third.answer.id }))).toStrictEqual({
        cancelled: true,
      });
      await expect(settled(first.answer.id)).resolves.toMatchObject({
        status: 'cancelled',
        parts: [{ kind: 'tool-call', tool: 'Grep', state: 'done' }],
      });
      await expect(settled(third.answer.id)).resolves.toMatchObject({
        status: 'cancelled',
        parts: [],
      });
      expect(textOf(await settled(fourth.answer.id))).toBe('abc');
      const started = events.flatMap((event) =>
        event.type === 'status' && event.status === 'submitted' && event.activity === undefined
          ? event.messageId
          : [],
      );
      const finished = updates.flatMap(({ id, status }) => (status === 'done' ? id : []));
      expect([started, finished]).toStrictEqual([
        [second.answer.id, fourth.answer.id],
        [second.answer.id, fourth.answer.id],
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
      signal,
    }) => {
      // The preamble streams at once and the chunks only after `delayMs`, far longer than the test:
      // the running answer is provably streaming, and provably unfinished until it is cancelled.
      const claude = fakeClaude.scripted({
        preamble: 'Looking.',
        chunks: ['a', 'b', 'c'],
        delayMs: 600_000,
      });
      const { services, chat, sessionId, events, updates, settled } = await startChat(
        claude.settings,
      );
      const running = okValueFrom(await chat.ask({ sessionId, question: 'Running?' }));
      const waiting = okValueFrom(await chat.ask({ sessionId, question: 'Waiting?' }));
      const compaction = okValueFrom(
        await chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
      );
      expect([running, waiting, compaction].map(({ answer }) => answer.status)).toStrictEqual([
        'submitted',
        'queued',
        'queued',
      ]);
      await waitUntil(
        () =>
          events.some(
            (event) => event.messageId === running.answer.id && event.type === 'text-delta',
          ),
        'the running answer to stream',
      );

      await repo.git('switch', '--quiet', 'feature');
      repo.write('more.rs', 'pub fn more() {}\n');
      await repo.commit('push');
      await repo.git('switch', '--quiet', 'main');
      okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));

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
        parts: [],
      });
      await expect(settled(compaction.answer.id)).resolves.toMatchObject({
        status: 'cancelled',
        parts: [],
      });
      claude.rescript(['a', 'b', 'c'], 0);
      const after = okValueFrom(await chat.ask({ sessionId, question: 'After the push?' }));
      const answered = await settled(after.answer.id);
      expect([answered.status, textOf(answered)]).toStrictEqual(['done', 'abc']);
      expect(claude.calls()).toHaveLength(2);
    });

    test('queues requests made at the same moment in the order they were made', async ({
      expect,
      fakeClaude,
      startChat,
      signal,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['x'], delayMs: 600_000 });
      const { services, chat, sessionId } = await startChat(claude.settings);
      const review = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
      const mention = { path: 'feature.rs', side: 'head', sha: review.headSha } as const;
      const asked = await Promise.all([
        chat.ask({ sessionId, question: 'One?' }),
        chat.ask({ sessionId, question: 'Two [[@1]]?', mentions: [mention] }),
        chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
        chat.ask({ sessionId, question: 'Four?' }),
      ]);
      const questions = okValueFrom(chat.list({ sessionId }))
        .messages.filter(({ role }) => role === 'user')
        .map((message) => textOf(message));
      expect(questions).toStrictEqual(['One?', 'Two [[@1]]?', '/summarize', 'Four?']);
      expect(asked.map((result) => okValueFrom(result).answer.status)).toStrictEqual([
        'submitted',
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
      // The running answer holds its chunks until /clear stops it, however slow the runner.
      const claude = fakeClaude.scripted({ chunks: ['a', 'b', 'c'], delayMs: 600_000 });
      const { chat, sessionId, updates, settled } = await startChat(claude.settings);
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
      // The queue is FIFO: had 'Later?' survived /clear, it would run before this sentinel.
      claude.rescript(['ok'], 0);
      const sentinel = okValueFrom(await chat.ask({ sessionId, question: 'Sentinel?' }));
      await settled(sentinel.answer.id);
      expect(claude.calls().some(({ stdin }) => stdin.includes('Later?'))).toBe(false);
      expect(updates.filter(({ id }) => id === later.answer.id)).toStrictEqual([]);
      expect(okValueFrom(chat.list({ sessionId })).messages.map(({ id }) => id)).toStrictEqual([
        sentinel.question.id,
        sentinel.answer.id,
      ]);
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
      const { services, chat, sessionId, events, settled } = await startChat(claude.settings);
      const asked = okValueFrom(
        await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
      );
      expect(asked.answer).toMatchObject({ answerKind: 'review', status: 'submitted' });
      const reviewed = await settled(asked.answer.id);
      expect(reviewed).toMatchObject({
        status: 'done',
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
      expect(
        reviewed.parts.map((part) => [part.kind, 'description' in part ? part.description : '']),
      ).toStrictEqual([
        ['tool-call', 'grep feature'],
        ['tool-call', 'read feature.rs:1-3'],
        ['tool-call', 'grep feature'],
        ['tool-call', 'read feature.rs:1-3'],
        ['finding', ''],
      ]);
      expect(reviewed.parts.at(-1)).toStrictEqual({ kind: 'finding', id: 'p5', finding: 0 });
      expect(
        events.flatMap((event) => (event.type === 'status' ? (event.activity ?? []) : [])),
      ).toStrictEqual(
        expect.arrayContaining([
          'Checking 2 findings against the code',
          'Checking 2 findings against the code: grep feature',
          'Checking 2 findings against the code: read feature.rs:1-3',
        ]),
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
        status: 'done',
        parts: [{ kind: 'finding', id: 'p1', finding: 0 }],
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
        status: 'done',
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
        status: 'error',
        parts: [{ kind: 'error', code: 'nothing-to-review' }],
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
        status: 'error',
        parts: [
          {
            kind: 'error',
            code: 'not-installed',
            message: expect.stringContaining('BEUVE_CLAUDE_PATH') as string,
          },
        ],
      });
      expect(okValueFrom(chat.list({ sessionId })).messages[1]).toMatchObject({
        status: 'error',
        parts: [{ kind: 'error', code: 'not-installed' }],
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
        status: 'error',
        parts: [{ kind: 'error', code: 'not-authenticated' }],
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

      const slow = fakeClaude.scripted({ chunks: ['a', 'b', 'c'], delayMs: 600_000 }, 'slow');
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
      const claude = fakeClaude.scripted({ chunks: ['a', 'b'], delayMs: 600_000 });
      const { services, chat, sessionId, events, settled } = await startChat(claude.settings);
      const asked = okValueFrom(await chat.ask({ sessionId, question: 'Slow?' }));
      await waitUntil(() => events.length > 0, 'the answer to start streaming');
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
      signal,
    }) => {
      await repo.git('switch', '--quiet', 'feature');
      repo.write('app.rs', 'fn main() {\n  run();\n  stop();\n}\n');
      await repo.commit('stop too');
      await repo.git('switch', '--quiet', 'main');
      const claude = fakeClaude.scripted({ chunks: ['It returns [[feature.rs:2]].'] });
      const { services, chat, sessionId, settled } = await startChat(claude.settings);
      const review = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
      const mentions = [
        { path: 'feature.rs', side: 'head', startLine: 1, endLine: 2, sha: review.headSha },
        { path: 'app.rs', side: 'base', startLine: 2, endLine: 3, sha: review.baseSha },
      ] as const;
      const asked = okValueFrom(
        await chat.ask({ sessionId, question: 'Why [[@1]] and not [[@2]]?', mentions }),
      );
      expect(textOf(asked.question)).toBe('Why [[@1]] and not [[@2]]?');
      expect(
        asked.question.parts.flatMap((part) => (part.kind === 'mention' ? [part.mention] : [])),
      ).toStrictEqual(mentions);
      await settled(asked.answer.id);

      const [call] = claude.calls();
      const stdin = call?.stdin ?? '';
      const selected = stdin.indexOf('## Selected by the reviewer');
      expect(selected).toBeGreaterThan(-1);
      expect(selected).toBeGreaterThan(stdin.indexOf('## Diff'));
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
      expect(listed[0]).toStrictEqual(asked.question);
      expect(listed[1]?.parts.some((part) => part.kind === 'mention')).toBe(false);

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
      signal,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['x'] });
      const { services, chat, sessionId, settled } = await startChat(claude.settings);
      const review = okValueFrom(await services.sessions.getReview({ sessionId }, { signal }));
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
          status: 'done',
          parts: [
            {
              kind: 'text',
              id: 'p1',
              text: '**Asked**\n- what feature adds\n\n**Places**\n- [[feature.rs:1-3]] `ghost.rs:1-1`',
            },
          ],
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
      claude.rescript(['a', 'b', 'c'], 600_000);
      const running = chat.compact({ sessionId });
      await waitUntil(() => claude.calls().length >= 2, 'the compaction to start');
      const next = okValueFrom(await chat.ask({ sessionId, question: 'Now?' }));
      expect(next.answer.status).toBe('queued');
      claude.rescript(['Later.'], 0);
      expect(okValueFrom(chat.cancel({ sessionId }))).toStrictEqual({ cancelled: true });
      expect(okValueFrom(await running)).toStrictEqual({ outcome: 'cancelled' });
      const later = await settled(next.answer.id);
      expect([later.status, textOf(later)]).toStrictEqual(['done', 'Later.']);
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
      signal,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['x'] });
      const { services, chat, sessionId } = await startChat(claude.settings);
      expect(chat.list({ sessionId: 'nope' })).toMatchObject({ ok: false });
      await expect(chat.ask({ sessionId: 'nope', question: 'Hi?' })).resolves.toMatchObject({
        ok: false,
      });
      expect(chat.clear({ sessionId: 'nope' })).toMatchObject({ ok: false });

      const head = okValueFrom(
        await services.sessions.getReview({ sessionId }, { signal }),
      ).headSha;
      appendChatMessage(db, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ChatMessageId,
        sessionId: sessionId as SessionId,
        headSha: head as CommitSha,
        role: 'assistant',
        kind: 'answer',
        status: 'streaming',
        parts: [
          { kind: 'tool-call', id: 'p1', tool: 'Grep', description: 'grep x', state: 'running' },
          { kind: 'text', id: 'p2', text: 'half an ans' },
        ],
        citations: [],
        createdAt: '2026-10-28T11:00:00.000Z',
      });
      const orphan = [
        {
          status: 'cancelled',
          parts: [
            { kind: 'tool-call', id: 'p1', tool: 'Grep', description: 'grep x', state: 'stopped' },
            { kind: 'text', id: 'p2', text: 'half an ans' },
          ],
        },
      ];
      expect(okValueFrom(chat.list({ sessionId })).messages).toMatchObject(orphan);
      expect(okValueFrom(chat.list({ sessionId })).messages).toMatchObject(orphan);
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
      closing,
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
      const context = { db, logger: logger.logger, deps, git: { logger: logger.logger } };
      const chat = createChatServices({
        context,
        impact: { getImpact: noImpact },
        worktrees: createSessionWorktrees({
          root: path.join(tempDir, 'chat-worktrees'),
          logger: logger.logger,
          git: { logger: logger.logger },
          storedHead: (id) => okValueFrom(loadSession(context, id)).headSha,
        }),
        claude: claude.settings,
        models: {
          registry: createModelRegistryStore(),
          secrets: createSecretStore({}),
          claude: claude.settings,
          logger: logger.logger,
        },
        intentFor: () => 'AUTHOR-CLAIM: this change makes everything faster.',
      });
      const updates: ChatMessageView[] = [];
      chat.onStream((event) => {
        updates.push(...(event.type === 'message' ? [event.message] : []));
      });
      closing(chat);
      const { id: sessionId } = okValueFrom(
        await main.sessions.createLocal({
          repoPath: repo.directory,
          baseRef: 'main',
          headRef: 'feature',
        }),
      );
      const finished = async (id: string): Promise<ChatMessageView> => waitForSettled(updates, id);
      const summary = okValueFrom(
        await chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
      );
      const question = okValueFrom(await chat.ask({ sessionId, question: 'What is it for?' }));
      expect(summary.answer).toMatchObject({ answerKind: 'abstract', status: 'submitted' });
      expect(question.answer.status).toBe('queued');
      await expect(finished(summary.answer.id)).resolves.toMatchObject({
        status: 'done',
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
