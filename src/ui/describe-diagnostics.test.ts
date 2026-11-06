import { describe } from 'vitest';

import type { DiagnosticItemView, DiagnosticsView } from '#contract/ipc-contract.ts';

import { describeDiagnostics } from './describe-diagnostics.ts';
import type { FileDiagnostics } from './file-diagnostics.ts';
import { test } from './testing/test.ts';

function problem(severity: DiagnosticItemView['severity']): DiagnosticItemView {
  return {
    startLine: 1,
    startCharacter: 0,
    endLine: 1,
    endCharacter: 1,
    severity,
    message: 'm',
    serverId: 'typescript',
  };
}

type ReadyView = Partial<DiagnosticsView> & Pick<DiagnosticsView, 'diagnostics'>;

function ready(view: ReadyView): FileDiagnostics {
  return { kind: 'ready', view: { sha: 'a'.repeat(40), state: 'settled', omitted: 0, ...view } };
}

describe('describeDiagnostics', () => {
  test('says "checking…" while the question is in flight', ({ expect }) => {
    expect(describeDiagnostics({ kind: 'checking' })).toMatchObject({
      text: 'checking…',
      tone: 'quiet',
    });
  });

  test('says nothing when there is nothing to say', ({ expect }) => {
    const clean = ready({ diagnostics: [] });
    const unavailable = ready({ state: 'unavailable', diagnostics: [problem('error')] });
    const notHead = ready({ state: 'not-head', diagnostics: [] });
    expect(describeDiagnostics(undefined)).toBeUndefined();
    expect(describeDiagnostics({ kind: 'failed' })).toBeUndefined();
    expect(describeDiagnostics(clean)).toBeUndefined();
    expect(describeDiagnostics(unavailable)).toBeUndefined();
    expect(describeDiagnostics(notHead)).toBeUndefined();
  });

  test('counts errors and warnings, errors first, and takes the worse tone', ({ expect }) => {
    const both = ready({ diagnostics: [problem('warning'), problem('error'), problem('error')] });
    const warning = ready({ diagnostics: [problem('warning')] });
    expect(describeDiagnostics(both)).toMatchObject({
      text: '2 errors · 1 warning',
      tone: 'error',
    });
    expect(describeDiagnostics(warning)).toMatchObject({ text: '1 warning', tone: 'warning' });
  });

  test('mentions notes and hints only in the title, or alone when they are all there is', ({
    expect,
  }) => {
    const mixed = ready({
      diagnostics: [problem('error'), problem('hint'), problem('information')],
    });
    const hints = ready({ diagnostics: [problem('hint'), problem('hint')] });
    const note = describeDiagnostics(mixed);
    expect(note?.text).toBe('1 error');
    expect(note?.title).toContain('2 other');
    expect(describeDiagnostics(hints)).toMatchObject({ text: '2 notes', tone: 'quiet' });
  });

  test('says when beuve did not start the server, and why', ({ expect }) => {
    const refused = ready({
      state: 'untrusted',
      diagnostics: [],
      notice: 'The go language server from this project was not started: it is not trusted.',
    });
    expect(describeDiagnostics(refused)).toMatchObject({
      text: 'server not started',
      title: expect.stringContaining('not trusted') as string,
      tone: 'quiet',
    });
  });

  test('passes on a note about the environment, beside the counts or alone on a clean file', ({
    expect,
  }) => {
    const notice = 'The shell environment of this checkout could not be read.';
    const broken = ready({ diagnostics: [problem('error')], notice });
    const clean = ready({ diagnostics: [], notice });
    expect(describeDiagnostics(broken)?.title).toContain(notice);
    expect(describeDiagnostics(clean)).toStrictEqual({ text: 'ⓘ', title: notice, tone: 'quiet' });
  });

  test('says when the answer may be incomplete or was cut', ({ expect }) => {
    const cut = ready({ state: 'timed-out', omitted: 3, diagnostics: [problem('error')] });
    const note = describeDiagnostics(cut);
    expect(note?.text).toBe('1 error (incomplete)');
    expect(note?.title).toContain('3 more not shown');
    expect(note?.title).toContain('may be incomplete');
  });
});
