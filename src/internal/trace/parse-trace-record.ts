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
  let test: ReturnType<typeof testFrom> | undefined;
  if (parsed.test !== undefined && parsed.test !== null) {
    test = testFrom(parsed.test);
  }
  if (test === 'invalid') {
    return undefined;
  }
  const events = parsed.events.slice(0, maxEvents).flatMap((event: unknown) => {
    const read = eventFrom(event);
    if (read === undefined) {
      return [];
    }
    return [read];
  });
  const dropped = countOf(parsed.dropped) ?? 0;
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
  const probe = countOf(value.probe);
  switch (value.kind) {
    case 'enter': {
      const parent = countOf(value.parent);
      if (probe === undefined || !Array.isArray(value.args)) {
        return undefined;
      }
      const args = value.args.slice(0, 64).map((arg: unknown) => summaryFrom(arg));
      return { kind: 'enter', seq, frame, parent, probe, args };
    }
    case 'branch': {
      if (probe === undefined || typeof value.taken !== 'boolean') {
        return undefined;
      }
      return { kind: 'branch', seq, frame, probe, taken: value.taken };
    }
    case 'value':
    case 'caught': {
      if (probe === undefined) {
        return undefined;
      }
      return { kind: value.kind, seq, frame, probe, value: summaryFrom(value.value) };
    }
    case 'mark': {
      if (probe === undefined) {
        return undefined;
      }
      return { kind: 'mark', seq, frame, probe };
    }
    case 'loop': {
      if (probe === undefined || !isCount(value.iterations)) {
        return undefined;
      }
      return { kind: 'loop', seq, frame, probe, iterations: value.iterations };
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
    let type: ValueType = 'unavailable';
    if (valueTypes.has(value.type)) {
      type = value.type as ValueType;
    }
    let { preview } = value;
    if (preview.length > maxPreview) {
      preview = `${preview.slice(0, maxPreview)}…`;
    }
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

function countOf(value: unknown): number | undefined {
  if (isCount(value)) {
    return value;
  }
  return undefined;
}
