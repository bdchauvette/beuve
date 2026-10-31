import type { TraceEntry, TraceTimeline } from '../trace-timeline.ts';

/** Renders a timeline as indented `line: step` strings so tests read the run. Test-only. */
export function describeTimeline(timeline: TraceTimeline): string[] {
  return timeline.entries.map((entry) => {
    return `${'  '.repeat(entry.depth)}${String(entry.line)}: ${describeEntry(entry)}`;
  });
}

function describeEntry(entry: TraceEntry): string {
  switch (entry.kind) {
    case 'enter': {
      const args = entry.args.map((arg) => `${arg.name}=${arg.value.preview}`).join(', ');
      return `enter ${entry.label}(${args})`;
    }
    case 'branch': {
      return describeBranch(entry);
    }
    case 'loop': {
      return `loop ${entry.label} ×${String(entry.iterations)}`;
    }
    case 'return': {
      return `return${entry.implicit ? ' (implicit)' : ''} ${entry.value.preview}`;
    }
    case 'throw': {
      return `throw${entry.propagated ? ' (propagated)' : ''} ${entry.value.preview}`;
    }
  }
}

function describeBranch(entry: Extract<TraceEntry, { kind: 'branch' }>): string {
  switch (entry.construct) {
    case 'if':
    case 'ternary': {
      return `${entry.construct} ${entry.label} → ${String(entry.taken)}`;
    }
    case 'switch':
    case 'catch': {
      return `${entry.construct} ${entry.label} = ${entry.value.preview}`;
    }
    case 'case':
    case 'default': {
      return entry.label;
    }
  }
}
