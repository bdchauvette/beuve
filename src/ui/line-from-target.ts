import type { ReviewTarget } from './target-from.ts';

/**
 * The one head line (1-based) an action that needs a single line takes from `target` (ADR
 * 0063): Open in Editor opens the editor there, and Show Callers, Show Control Flow and Run Trace Probe look up the function enclosing
 * it. A selection's first head line (mapped from the base side), a hunk's first change, a jump's
 * line, or the file's first change; `undefined` for a file without head changes or the whole
 * change. Pure.
 */
export function lineFromTarget(target: ReviewTarget): number | undefined {
  switch (target.kind) {
    case 'selection': {
      return target.head?.start;
    }
    case 'hunk':
    case 'line':
    case 'file': {
      return target.line;
    }
    case 'change': {
      return undefined;
    }
  }
}
