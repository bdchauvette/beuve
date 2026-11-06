import type { DiagnosticItemView, DiagnosticSeverityView } from '#contract/ipc-contract.ts';

import type { FileDiagnostics } from './file-diagnostics.ts';

/** The quiet note on a file card's header about its diagnostics; absent when there is nothing to say. */
export interface DiagnosticsNote {
  readonly text: string;
  /** Longer than `text`: every count, and whether the answer may be incomplete. */
  readonly title: string;
  readonly tone: 'error' | 'warning' | 'quiet';
}

type Counts = Readonly<Record<DiagnosticSeverityView, number>>;

/**
 * What a card's header says about its file's diagnostics (ADR 0111): "checking…" while the servers
 * work, then errors and warnings counted over the whole file, including lines the diff doesn't
 * show. A clean file, a file no server handles and a failed question say nothing, as an editor's
 * problems badge does. A timed-out answer says it may be incomplete.
 */
export function describeDiagnostics(
  file: FileDiagnostics | undefined,
): DiagnosticsNote | undefined {
  if (file?.kind === 'checking') {
    return {
      text: 'checking…',
      title: 'The language server is checking this file',
      tone: 'quiet',
    };
  }
  if (file?.kind !== 'ready') {
    return undefined;
  }
  const { diagnostics, state, omitted } = file.view;
  if (state === 'not-head' || state === 'unavailable' || diagnostics.length === 0) {
    return undefined;
  }
  const counts = countBySeverity(diagnostics);
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(plural(counts.error, 'error'));
  }
  if (counts.warning > 0) {
    parts.push(plural(counts.warning, 'warning'));
  }
  const shown = parts.join(' · ');
  const other = counts.information + counts.hint;
  const detail = [plural(counts.error, 'error'), plural(counts.warning, 'warning')];
  if (other > 0) {
    detail.push(`${String(other)} other`);
  }
  if (omitted > 0) {
    detail.push(`${String(omitted)} more not shown`);
  }
  if (state === 'timed-out') {
    detail.push('the server was still working, so this may be incomplete');
  }
  let text = shown;
  if (text === '') {
    text = plural(other, 'note');
  }
  if (state === 'timed-out') {
    text += ' (incomplete)';
  }
  return { text, title: `Language server: ${detail.join(', ')}`, tone: toneOf(counts) };
}

function countBySeverity(items: readonly DiagnosticItemView[]): Counts {
  const counts = { error: 0, warning: 0, information: 0, hint: 0 };
  for (const item of items) {
    counts[item.severity] += 1;
  }
  return counts;
}

function toneOf(counts: Counts): DiagnosticsNote['tone'] {
  if (counts.error > 0) {
    return 'error';
  }
  if (counts.warning > 0) {
    return 'warning';
  }
  return 'quiet';
}

function plural(count: number, noun: string): string {
  if (count === 1) {
    return `1 ${noun}`;
  }
  return `${String(count)} ${noun}s`;
}
