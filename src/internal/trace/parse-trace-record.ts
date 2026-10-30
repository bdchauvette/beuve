import type { RawTraceEvent, TraceRecord, TraceTestId } from './trace-record.ts';
import type { ValueSummary, ValueType } from './value-summary.ts';

const valueTypes = new Set<string>([
  'undefined',
  'null',
  'boolean',
  'number',
  'bigint',
  'string',
  'symbol',
  'function',
  'array',
  'object',
  'map',
  'set',
  'date',
  'regexp',
  'error',
  'promise',
  'binary',
  'proxy',
  'unavailable',
]);
const maxPreview = 1000;
const maxText = 1000;
const maxTitles = 32;
const maxEvents = 10_000;

/**
 * Reads one line the recorder wrote. The line comes from a process running the repository's
 * code, so every field is checked and bounded; a malformed line yields `undefined`, a malformed
 * event is skipped.
 */
export function parseTraceRecord(line: string): TraceRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || !Array.isArray(parsed.events)) {
    return undefined;
  }
  const test =
    parsed.test === undefined || parsed.test === null ? undefined : testFrom(parsed.test);
  if (test === 'invalid') {
    return undefined;
  }
  const events = parsed.events.slice(0, maxEvents).flatMap((event: unknown) => {
    const read = eventFrom(event);
    return read === undefined ? [] : [read];
  });
  const dropped = isCount(parsed.dropped) ? parsed.dropped : 0;
  return { test, events, dropped: dropped + Math.max(0, parsed.events.length - maxEvents) };
}

function testFrom(value: unknown): TraceTestId | 'invalid' {
  if (!isObject(value) || typeof value.file !== 'string' || !Array.isArray(value.titles)) {
    return 'invalid';
  }
  const titles = value.titles.slice(0, maxTitles);
  if (!titles.every((title): title is string => typeof title === 'string')) {
    return 'invalid';
  }
  return {
    file: value.file.slice(0, maxText),
    titles: titles.map((title) => title.slice(0, maxText)),
  };
}

function eventFrom(value: unknown): RawTraceEvent | undefined {
  if (!isObject(value) || !isCount(value.seq) || !isCount(value.frame)) {
    return undefined;
  }
  const { seq, frame } = value;
  const probe = isCount(value.probe) ? value.probe : undefined;
  switch (value.kind) {
    case 'enter': {
      const parent = isCount(value.parent) ? value.parent : undefined;
      if (probe === undefined || !Array.isArray(value.args)) {
        return undefined;
      }
      const args = value.args.slice(0, 64).map((arg: unknown) => summaryFrom(arg));
      return { kind: 'enter', seq, frame, parent, probe, args };
    }
    case 'branch': {
      return probe === undefined || typeof value.taken !== 'boolean'
        ? undefined
        : { kind: 'branch', seq, frame, probe, taken: value.taken };
    }
    case 'value':
    case 'caught': {
      return probe === undefined
        ? undefined
        : { kind: value.kind, seq, frame, probe, value: summaryFrom(value.value) };
    }
    case 'mark': {
      return probe === undefined ? undefined : { kind: 'mark', seq, frame, probe };
    }
    case 'loop': {
      return probe === undefined || !isCount(value.iterations)
        ? undefined
        : { kind: 'loop', seq, frame, probe, iterations: value.iterations };
    }
    case 'return':
    case 'throw': {
      return { kind: value.kind, seq, frame, probe, value: summaryFrom(value.value) };
    }
    default: {
      return undefined;
    }
  }
}

function summaryFrom(value: unknown): ValueSummary {
  if (isObject(value) && typeof value.type === 'string' && typeof value.preview === 'string') {
    const type = valueTypes.has(value.type) ? (value.type as ValueType) : 'unavailable';
    const preview =
      value.preview.length <= maxPreview ? value.preview : `${value.preview.slice(0, maxPreview)}…`;
    return { type, preview };
  }
  return { type: 'unavailable', preview: '<unavailable>' };
}

type Field =
  | 'test'
  | 'events'
  | 'dropped'
  | 'file'
  | 'titles'
  | 'kind'
  | 'seq'
  | 'frame'
  | 'probe'
  | 'parent'
  | 'args'
  | 'taken'
  | 'value'
  | 'iterations'
  | 'type'
  | 'preview';

function isObject(value: unknown): value is Partial<Record<Field, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
