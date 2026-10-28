import type { UraAnchor } from './ura-item.ts';

/** `src/a.ts:12`, `src/a.ts:12-14`, `src/a.ts` or `the whole change`, for human readers. */
export function formatUraAnchor(anchor: UraAnchor): string {
  switch (anchor.kind) {
    case 'lines': {
      const lines =
        anchor.startLine === anchor.endLine
          ? String(anchor.startLine)
          : `${String(anchor.startLine)}-${String(anchor.endLine)}`;
      return `${anchor.path}:${lines}`;
    }
    case 'file': {
      return anchor.path;
    }
    case 'change': {
      return 'the whole change';
    }
  }
}
