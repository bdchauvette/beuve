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
      entries: entriesFrom(plan, group?.events ?? []),
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
    if (id === undefined) {
      return undefined;
    }
    return plan.probes[id];
  };
  const ordered = events.toSorted((left, right) => left.seq - right.seq);
  for (const event of ordered) {
    if (event.kind === 'enter') {
      const probe = probeOf(event.probe);
      if (probe?.kind !== 'enter') {
        continue;
      }
      const frame = { fn: probe.fn, depth: depthUnder(frames, event.parent) };
      frames.set(event.frame, frame);
      const names = probe.parameters ?? [];
      const args = event.args.map((value, index) => {
        return { name: names[index] ?? '?', value };
      });
      entries.push({ ...base(event.seq, probe, frame), kind: 'enter', args });
      continue;
    }
    const entry = entryFrom(plan, event, {
      probe: probeOf(event.probe),
      frame: frames.get(event.frame),
    });
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return entries;
}

/** Where an event happened: its probe and the frame it ran in, when the record has them. */
interface EventSite {
  readonly probe: Probe | undefined;
  readonly frame: Frame | undefined;
}

function entryFrom(
  plan: InstrumentationPlan,
  event: Exclude<RawTraceEvent, { kind: 'enter' }>,
  { probe, frame }: EventSite,
): TraceEntry | undefined {
  if (event.kind === 'return' || event.kind === 'throw') {
    const fn = frame?.fn ?? probe?.fn;
    if (fn === undefined) {
      return undefined;
    }
    const traced = plan.functions[fn];
    if (traced === undefined) {
      return undefined;
    }
    let line = traced.startLine;
    if (event.kind === 'return') {
      line = traced.endLine;
    }
    const common = {
      seq: event.seq,
      fn,
      depth: frame?.depth ?? 0,
      line: probe?.line ?? line,
      inHunk: probe?.inHunk ?? false,
      label: probe?.label ?? traced.name,
    };
    if (event.kind === 'return') {
      return { ...common, kind: 'return', value: event.value, implicit: probe === undefined };
    }
    return { ...common, kind: 'throw', value: event.value, propagated: probe === undefined };
  }
  if (probe === undefined) {
    return undefined;
  }
  const common = base(event.seq, probe, frame ?? { fn: probe.fn, depth: 0 });
  switch (event.kind) {
    case 'branch': {
      if (probe.kind === 'if' || probe.kind === 'ternary') {
        return { ...common, kind: 'branch', construct: probe.kind, taken: event.taken };
      }
      return undefined;
    }
    case 'value':
    case 'caught': {
      if (probe.kind === 'switch' || probe.kind === 'catch') {
        return { ...common, kind: 'branch', construct: probe.kind, value: event.value };
      }
      return undefined;
    }
    case 'mark': {
      if (probe.kind === 'case' || probe.kind === 'default') {
        return { ...common, kind: 'branch', construct: probe.kind };
      }
      return undefined;
    }
    case 'loop': {
      if (probe.kind === 'loop') {
        return { ...common, kind: 'loop', iterations: event.iterations };
      }
      return undefined;
    }
  }
}

/** What every entry has: its order, function, place and label. */
interface EntryBase {
  seq: number;
  fn: number;
  line: number;
  depth: number;
  inHunk: boolean;
  label: string;
}

/** The depth of a frame entered from `parent`: one below it, or the top. */
function depthUnder(frames: ReadonlyMap<number, Frame>, parent: number | undefined): number {
  if (parent === undefined) {
    return 0;
  }
  const outer = frames.get(parent);
  if (outer === undefined) {
    return 0;
  }
  return outer.depth + 1;
}

function base(seq: number, probe: Probe, frame: Frame): EntryBase {
  return {
    seq,
    fn: frame.fn,
    line: probe.line,
    depth: frame.depth,
    inHunk: probe.inHunk,
    label: probe.label,
  };
}
