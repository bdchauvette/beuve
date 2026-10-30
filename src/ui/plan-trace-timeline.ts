import type { TraceEntryView, TraceResultView, TraceTimelineView } from '#contract/ipc-contract.ts';

import { formatIsoDuration } from './format-iso-duration.ts';

/** How a row reads at a glance: what happened and how it went. */
export type TraceRowTone = 'neutral' | 'taken' | 'skipped' | 'danger';

/** One step of a test's execution, ready to show. */
export interface TraceRow {
  readonly seq: number;
  /** Call depth among traced functions; the portal indents by it. */
  readonly depth: number;
  /** The head line the step belongs to, the jump target. */
  readonly line: number;
  /** The step's own lines are in the hunk under review: shown with the accent. */
  readonly inHunk: boolean;
  readonly tag: string;
  readonly text: string;
  /** What came of it: the side taken, iterations, the value. */
  readonly result: string;
  readonly tone: TraceRowTone;
}

/** One test case of the probe: its outcome and the steps it ran through the traced code. */
export interface TraceCase {
  readonly key: string;
  readonly title: string;
  readonly status: TraceTimelineView['status'];
  readonly duration: string;
  readonly failure: string;
  readonly rows: readonly TraceRow[];
  /** Rows in the hunk, which the portal ties to the diff. */
  readonly hunkRows: number;
  /** Events the recorder dropped at its limits. */
  readonly dropped: number;
}

const maxArgsChars = 140;

/** Groups a probe's timelines per test case and renders each step as a row. Pure. */
export function planTraceTimeline(
  result: TraceResultView,
  locale?: Intl.LocalesArgument,
): TraceCase[] {
  return result.timelines.map((timeline, index) => {
    const rows = timeline.entries.map((entry) => rowFrom(entry, result));
    return {
      key: `${String(index)}:${timeline.file}:${timeline.titles.join('\0')}`,
      title: timeline.titles.length === 0 ? 'Outside any test' : timeline.titles.join(' › '),
      status: timeline.status,
      duration: formatIsoDuration(timeline.duration, locale),
      failure: firstLine(timeline.failure ?? ''),
      rows,
      hunkRows: rows.filter((row) => row.inHunk).length,
      dropped: timeline.dropped,
    };
  });
}

function rowFrom(entry: TraceEntryView, result: TraceResultView): TraceRow {
  const base = { seq: entry.seq, depth: entry.depth, line: entry.line, inHunk: entry.inHunk };
  switch (entry.kind) {
    case 'enter': {
      const name = result.functions[entry.fn]?.name ?? entry.label;
      return {
        ...base,
        tag: 'call',
        text: `${name}(${truncate(entry.args.map((arg) => `${arg.name}=${arg.value.preview}`).join(', '), maxArgsChars)})`,
        result: '',
        tone: 'neutral',
      };
    }
    case 'branch': {
      return { ...base, ...branchFrom(entry) };
    }
    case 'loop': {
      const times = `${String(entry.iterations)} ${entry.iterations === 1 ? 'iteration' : 'iterations'}`;
      return { ...base, tag: 'loop', text: entry.label, result: times, tone: 'neutral' };
    }
    case 'return': {
      return {
        ...base,
        tag: 'return',
        text: entry.value.preview,
        result: entry.implicit ? 'implicit' : '',
        tone: 'neutral',
      };
    }
    case 'throw': {
      return {
        ...base,
        tag: 'throw',
        text: entry.value.preview,
        result: entry.propagated ? 'passes through' : '',
        tone: 'danger',
      };
    }
  }
}

function branchFrom(
  entry: Extract<TraceEntryView, { kind: 'branch' }>,
): Pick<TraceRow, 'tag' | 'text' | 'result' | 'tone'> {
  switch (entry.construct) {
    case 'if':
    case 'ternary': {
      return {
        tag: entry.construct === 'if' ? 'if' : '?:',
        text: entry.label,
        result: entry.taken ? 'true · then' : 'false · else',
        tone: entry.taken ? 'taken' : 'skipped',
      };
    }
    case 'switch':
    case 'catch': {
      return {
        tag: entry.construct,
        text: entry.label,
        result: `= ${entry.value.preview}`,
        tone: 'neutral',
      };
    }
    case 'case':
    case 'default': {
      return { tag: entry.construct, text: entry.label, result: 'entered', tone: 'taken' };
    }
  }
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? '';
  return truncate(line.trim(), 300);
}
