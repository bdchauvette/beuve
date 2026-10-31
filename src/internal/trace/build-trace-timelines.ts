import type { InstrumentationPlan, Probe } from './instrumentation-plan.ts';
import type { RawTraceEvent, TraceRecord } from './trace-record.ts';
import type { TestOutcome } from './trace-runner.ts';
import type { TraceEntry, TraceTimeline } from './trace-timeline.ts';

interface Frame {
  readonly fn: number;
  readonly depth: number;
}

interface Group {
  file: string;
  titles: readonly string[];
  events: RawTraceEvent[];
  dropped: number;
}

/**
 * Reduces the recorder's raw events to one timeline per test (ADR 0036): events are joined with
 * the plan's probes, ordered by sequence, and given a call depth from their frames. Every test
 * that ran gets a timeline, empty when it never reached a traced function; skipped tests that
 * recorded nothing are left out. Events that name unknown probes are ignored.
 */
export function buildTraceTimelines(
  plan: InstrumentationPlan,
  records: readonly TraceRecord[],
  outcomes: readonly TestOutcome[],
): TraceTimeline[] {
  const groups = new Map<string, Group>();
  for (const record of records) {
    const file = record.test?.file ?? '';
    const titles = record.test?.titles ?? [];
    const key = keyOf(file, titles);
    const group = groups.getOrInsertComputed(key, () => {
      return { file, titles, events: [], dropped: 0 };
    });
    group.events.push(...record.events);
    group.dropped += record.dropped;
  }
  const timelines: TraceTimeline[] = [];
  for (const outcome of outcomes) {
    const key = keyOf(outcome.file, outcome.titles);
    const group = groups.get(key);
    groups.delete(key);
    if (group === undefined && outcome.status === 'skipped') {
      continue;
    }
    timelines.push({
      file: outcome.file,
      titles: outcome.titles,
      status: outcome.status,
      failure: outcome.failure,
      duration: outcome.duration,
      entries: group === undefined ? [] : entriesFrom(plan, group.events),
      dropped: group?.dropped ?? 0,
    });
  }
  for (const group of groups.values()) {
    timelines.push({
      file: group.file,
      titles: group.titles,
      status: 'unknown',
      failure: undefined,
      duration: undefined,
      entries: entriesFrom(plan, group.events),
      dropped: group.dropped,
    });
  }
  return timelines;
}

function keyOf(file: string, titles: readonly string[]): string {
  return JSON.stringify([file, ...titles]);
}

function entriesFrom(plan: InstrumentationPlan, events: readonly RawTraceEvent[]): TraceEntry[] {
  const frames = new Map<number, Frame>();
  const entries: TraceEntry[] = [];
  const probeOf = (id: number | undefined): Probe | undefined => {
    return id === undefined ? undefined : plan.probes[id];
  };
  const ordered = events.toSorted((left, right) => left.seq - right.seq);
  for (const event of ordered) {
    if (event.kind === 'enter') {
      const probe = probeOf(event.probe);
      if (probe?.kind !== 'enter') {
        continue;
      }
      const parent = event.parent === undefined ? undefined : frames.get(event.parent);
      const frame = { fn: probe.fn, depth: parent === undefined ? 0 : parent.depth + 1 };
      frames.set(event.frame, frame);
      const names = probe.parameters ?? [];
      const args = event.args.map((value, index) => {
        return { name: names[index] ?? '?', value };
      });
      entries.push({ ...base(event.seq, probe, frame), kind: 'enter', args });
      continue;
    }
    const entry = entryFrom(plan, event, probeOf(event.probe), frames.get(event.frame));
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return entries;
}

function entryFrom(
  plan: InstrumentationPlan,
  event: Exclude<RawTraceEvent, { kind: 'enter' }>,
  probe: Probe | undefined,
  frame: Frame | undefined,
): TraceEntry | undefined {
  if (event.kind === 'return' || event.kind === 'throw') {
    const fn = frame?.fn ?? probe?.fn;
    const traced = fn === undefined ? undefined : plan.functions[fn];
    if (fn === undefined || traced === undefined) {
      return undefined;
    }
    const common = {
      seq: event.seq,
      fn,
      depth: frame?.depth ?? 0,
      line: probe?.line ?? (event.kind === 'return' ? traced.endLine : traced.startLine),
      inHunk: probe?.inHunk ?? false,
      label: probe?.label ?? traced.name,
    };
    return event.kind === 'return'
      ? { ...common, kind: 'return', value: event.value, implicit: probe === undefined }
      : { ...common, kind: 'throw', value: event.value, propagated: probe === undefined };
  }
  if (probe === undefined) {
    return undefined;
  }
  const common = base(event.seq, probe, frame ?? { fn: probe.fn, depth: 0 });
  switch (event.kind) {
    case 'branch': {
      return probe.kind === 'if' || probe.kind === 'ternary'
        ? { ...common, kind: 'branch', construct: probe.kind, taken: event.taken }
        : undefined;
    }
    case 'value':
    case 'caught': {
      return probe.kind === 'switch' || probe.kind === 'catch'
        ? { ...common, kind: 'branch', construct: probe.kind, value: event.value }
        : undefined;
    }
    case 'mark': {
      return probe.kind === 'case' || probe.kind === 'default'
        ? { ...common, kind: 'branch', construct: probe.kind }
        : undefined;
    }
    case 'loop': {
      return probe.kind === 'loop'
        ? { ...common, kind: 'loop', iterations: event.iterations }
        : undefined;
    }
  }
}

function base(
  seq: number,
  probe: Probe,
  frame: Frame,
): { seq: number; fn: number; line: number; depth: number; inHunk: boolean; label: string } {
  return {
    seq,
    fn: frame.fn,
    line: probe.line,
    depth: frame.depth,
    inHunk: probe.inHunk,
    label: probe.label,
  };
}
