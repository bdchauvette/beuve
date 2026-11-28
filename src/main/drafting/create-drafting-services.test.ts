import { realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { describe } from 'vitest';

import type { UraAnchorView } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../chat/testing/test.ts';
import type { MainServices } from '../main-services.ts';

function chatRows(db: DatabaseSync): unknown {
  return db.prepare('SELECT count(*) AS n FROM chat_messages').get();
}

async function headOf(services: MainServices, sessionId: string): Promise<string> {
  return okValueFrom(await services.sessions.getReview({ sessionId })).headSha;
}

function featureLine(): UraAnchorView {
  return { kind: 'lines', path: 'feature.rs', startLine: 2, endLine: 2 };
}

/** ✨ Autoedit through `createMainServices`, a temporary repository and the fake `claude`. */
describe(
  'createDraftingServices (integration: SQLite + git + fake claude, no Electron)',
  { timeout: 30_000 },
  () => {
    test('one request with only the draft and its hunk, outside the chat and its table', async ({
      expect,
      db,
      fakeClaude,
      startChat,
      signal,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['CHAT-ANSWER-MARKER'] });
      const { services, chat, sessionId, settled } = await startChat(claude.settings);
      const asked = okValueFrom(await chat.ask({ sessionId, question: 'CHAT-QUESTION-MARKER?' }));
      await settled(asked.answer.id);
      const rows = chatRows(db);

      claude.rescript([
        JSON.stringify({
          body: 'Why does `feature` return 1? Name the constant.',
          suggestions: [],
        }),
      ]);
      const expanded = await services.drafting.autoeditNote(
        {
          sessionId,
          headSha: await headOf(services, sessionId),
          anchor: featureLine(),
          severity: 'question',
          title: 'why 1',
          body: 'magic number?',
        },
        { signal },
      );
      expect(expanded).toStrictEqual({
        ok: true,
        value: {
          outcome: 'autoedited',
          body: 'Why does `feature` return 1? Name the constant.',
          suggestions: [],
          droppedSuggestions: 0,
          model: expect.anything() as unknown,
        },
      });

      const calls = claude.calls();
      expect(calls).toHaveLength(2);
      const draft = calls[1];
      expect(draft?.stdin).toContain('Label: question');
      expect(draft?.stdin).toContain('line 2 of feature.rs');
      expect(draft?.stdin).toContain('```text\nwhy 1\n```');
      expect(draft?.stdin).toContain('```markdown\nmagic number?\n```');
      expect(draft?.stdin).toContain('### added feature.rs');
      expect(draft?.stdin).toContain('+  1');
      expect(draft?.stdin).toContain('Suggestions: (none)');
      expect(draft?.stdin).not.toContain('CHAT-QUESTION-MARKER');
      expect(draft?.stdin).not.toContain('CHAT-ANSWER-MARKER');
      expect(draft?.args.join('\n')).toContain("in the reviewer's voice");
      expect(draft?.args).toContain('--effort=low');
      const scratch = draft?.cwd ?? '';
      expect(path.basename(scratch)).toMatch(/^beuve-note-draft-/u);
      expect(path.dirname(scratch)).toBe(realpathSync(os.tmpdir()));
      await expect(stat(scratch)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(chatRows(db)).toStrictEqual(rows);
      expect(okValueFrom(chat.list({ sessionId })).messages).toHaveLength(2);
    });

    test('sends the suggestions with their head lines, and keeps only the valid ones', async ({
      expect,
      fakeClaude,
      startChat,
      signal,
    }) => {
      const claude = fakeClaude.scripted({
        chunks: [
          JSON.stringify({
            body: 'Name the constant `DEFAULT`.',
            suggestions: [
              { id: 's1', path: 'feature.rs', startLine: 2, endLine: 2, replacement: '  DEFAULT' },
              {
                path: 'feature.rs',
                startLine: 1,
                endLine: 0,
                replacement: 'const DEFAULT: u8 = 1;',
              },
              { path: 'app.rs', startLine: 1, endLine: 1, replacement: 'outside the prompt' },
              { id: 's7', path: 'feature.rs', startLine: 3, endLine: 3, replacement: '}' },
            ],
          }),
        ],
      });
      const { services, sessionId } = await startChat(claude.settings);
      const answer = await services.drafting.autoeditNote(
        {
          sessionId,
          headSha: await headOf(services, sessionId),
          anchor: featureLine(),
          severity: 'nitpick',
          title: '',
          body: 'name the 1',
          suggestions: [
            { key: 'field-a', path: 'feature.rs', startLine: 2, endLine: 2, replacement: '  ONE' },
          ],
        },
        { signal },
      );
      expect(answer).toStrictEqual({
        ok: true,
        value: {
          outcome: 'autoedited',
          body: 'Name the constant `DEFAULT`.',
          suggestions: [
            {
              key: 'field-a',
              path: 'feature.rs',
              startLine: 2,
              endLine: 2,
              replacement: '  DEFAULT',
            },
            {
              path: 'feature.rs',
              startLine: 1,
              endLine: 0,
              replacement: 'const DEFAULT: u8 = 1;',
            },
          ],
          droppedSuggestions: 2,
          model: expect.anything() as unknown,
        },
      });
      const stdin = claude.calls()[0]?.stdin ?? '';
      expect(stdin).toContain(
        '### s1: feature.rs, line 2\n\nReplaces these lines at the head:\n\n```text\n  1\n```',
      );
      expect(stdin).toContain('With:\n\n```text\n  ONE\n```');
    });

    test('fails readably on an answer that is not the JSON asked for', async ({
      expect,
      fakeClaude,
      startChat,
      signal,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['Sure! Here is the note.'] });
      const { services, sessionId } = await startChat(claude.settings);
      const answer = await services.drafting.autoeditNote(
        {
          sessionId,
          headSha: await headOf(services, sessionId),
          anchor: featureLine(),
          severity: 'nitpick',
          title: '',
          body: 'name the 1',
        },
        { signal },
      );
      expect(answer).toMatchObject({
        ok: true,
        value: { outcome: 'failed', errorKind: 'invalid-output' },
      });
    });

    test('answers cancelled when its signal aborts, and refuses without a model call', async ({
      expect,
      fakeClaude,
      startChat,
      signal,
    }) => {
      const claude = fakeClaude.scripted({ chunks: ['never'], delayMs: 20_000 });
      const { services, sessionId } = await startChat(claude.settings);
      const headSha = await headOf(services, sessionId);
      const draft = {
        sessionId,
        headSha,
        anchor: featureLine(),
        severity: 'nitpick',
        title: '',
        body: 'rename',
      } as const;

      await expect(
        services.drafting.autoeditNote({ ...draft, body: ' ' }, { signal }),
      ).resolves.toStrictEqual({
        ok: true,
        value: {
          outcome: 'failed',
          errorKind: 'refused',
          message: 'Write a title or a body first.',
        },
      });
      await expect(
        services.drafting.autoeditNote({ ...draft, sessionId: 'missing' }, { signal }),
      ).resolves.toMatchObject({ ok: false });
      await expect(
        services.drafting.autoeditNote({ ...draft, headSha: 'f'.repeat(40) }, { signal }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } });
      expect(claude.calls()).toStrictEqual([]);

      const controller = new AbortController();
      const pending = services.drafting.autoeditNote(draft, { signal: controller.signal });
      await expect.poll(() => claude.calls()).toHaveLength(1);
      controller.abort();
      await expect(pending).resolves.toStrictEqual({
        ok: false,
        error: { code: 'cancelled', message: 'cancelled' },
      });
    });
  },
);
