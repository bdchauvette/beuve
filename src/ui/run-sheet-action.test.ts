import { describe } from 'vitest';

import type { BeuveApi } from '#contract/ipc-contract.ts';

import { createDiffFileView } from './testing/create-diff-file-view.ts';
import { test } from './testing/test.ts';

import { runSheetAction } from './run-sheet-action.ts';
import type { SheetActionContext } from './run-sheet-action.ts';

/** A bridge answering each channel from `answers`, recording every call. */
function fakeBridge(
  answers: Readonly<Record<string, unknown>>,
  calls: [string, unknown][],
): BeuveApi {
  return {
    invoke: async (channel: string, ...request: unknown[]): Promise<never> => {
      calls.push([channel, request[0]]);
      await Promise.resolve();
      return answers[channel] as never;
    },
    on: () => stayUnsubscribed,
  };
}

function stayUnsubscribed(): void {
  // The fake bridge has no events to stop.
}

function contextWith(
  answers: Readonly<Record<string, unknown>>,
  calls: [string, unknown][],
  mode: 'window' | 'inline' = 'window',
): SheetActionContext {
  return {
    bridge: fakeBridge(answers, calls),
    sessionId: 's1',
    headSha: 'h'.repeat(40),
    baseSha: 'b'.repeat(40),
    mode,
  };
}

function definitionAnswer(): unknown {
  return {
    ok: true,
    value: {
      sha: 'h'.repeat(40),
      targets: [
        {
          file: { kind: 'workspace', path: 'src/auth.ts' },
          startLine: 1,
          startCharacter: 16,
          endLine: 1,
          endCharacter: 24,
        },
      ],
    },
  };
}

describe('runSheetAction', () => {
  test('opens the definition of the target line in a new sheet window', async ({ expect }) => {
    const calls: [string, unknown][] = [];
    const file = createDiffFileView('src/handler.ts', [' a', '+b'], 3);
    const outcome = await runSheetAction(
      contextWith({ 'lsp:definition': definitionAnswer(), 'sheet:open': { ok: true } }, calls),
      { kind: 'definition', target: { kind: 'line', file, line: 4 } },
    );
    expect(calls).toStrictEqual([
      [
        'lsp:definition',
        {
          sessionId: 's1',
          sha: 'h'.repeat(40),
          path: 'src/handler.ts',
          line: 4,
          kind: 'definition',
        },
      ],
      [
        'sheet:open',
        {
          sessionId: 's1',
          sha: 'h'.repeat(40),
          path: 'src/auth.ts',
          range: { startLine: 1, startCharacter: 16, endLine: 1, endCharacter: 24 },
        },
      ],
    ]);
    expect(outcome).toMatchObject({ kind: 'notice', notice: { tone: 'info' } });
  });

  test('shows the definition inline when sheets open over the diff', async ({ expect }) => {
    const calls: [string, unknown][] = [];
    const file = createDiffFileView('src/handler.ts', [' a'], 1);
    const outcome = await runSheetAction(
      contextWith({ 'lsp:definition': definitionAnswer() }, calls, 'inline'),
      { kind: 'type-definition', target: { kind: 'line', file, line: 1 } },
    );
    expect(outcome).toStrictEqual({
      kind: 'inline',
      sha: 'h'.repeat(40),
      place: {
        path: 'src/auth.ts',
        range: { startLine: 1, startCharacter: 16, endLine: 1, endCharacter: 24 },
      },
    });
    expect(calls.map(([channel]) => channel)).toStrictEqual(['lsp:definition']);
  });

  test('copies a permalink for the target’s side, or says there is no remote', async ({
    expect,
  }) => {
    const calls: [string, unknown][] = [];
    const url = `https://github.com/o/r/blob/${'b'.repeat(40)}/src/a.ts#L2`;
    const file = createDiffFileView('src/a.ts', [' a', '-b', '+c'], 1);
    const copied = await runSheetAction(
      contextWith(
        {
          'remote:permalink': { ok: true, value: { kind: 'link', url, remote: 'origin' } },
          'clipboard:write-text': { ok: true, value: { length: url.length } },
        },
        calls,
      ),
      {
        kind: 'copy-link',
        target: { kind: 'selection', file, side: 'base', start: 2, end: 2, head: undefined },
      },
    );
    expect(calls).toStrictEqual([
      [
        'remote:permalink',
        { sessionId: 's1', sha: 'b'.repeat(40), path: 'src/a.ts', startLine: 2, endLine: 2 },
      ],
      ['clipboard:write-text', { text: url }],
    ]);
    expect(copied).toStrictEqual({
      kind: 'notice',
      notice: { tone: 'info', text: `Copied ${url}` },
    });
    const none = await runSheetAction(
      contextWith({ 'remote:open-permalink': { ok: true, value: { kind: 'no-remote' } } }, []),
      { kind: 'open-link', target: { kind: 'file', file, line: undefined } },
    );
    expect(none).toMatchObject({
      notice: { text: 'This repository has no GitHub remote to link to.' },
    });
  });

  test('asks for a line when the target is the whole change', async ({ expect }) => {
    const calls: [string, unknown][] = [];
    await expect(
      runSheetAction(contextWith({}, calls), { kind: 'definition', target: { kind: 'change' } }),
    ).resolves.toMatchObject({ kind: 'notice', notice: { tone: 'info' } });
    expect(calls).toStrictEqual([]);
  });
});
