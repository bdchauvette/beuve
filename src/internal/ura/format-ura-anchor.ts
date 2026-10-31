import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import type { UraAnchor } from './ura-item.ts';

/**
 * `src/a.ts:12`, `src/a.ts:12-14`, `src/a.ts` or `the whole change`, for human readers: the path's
 * invisible and bidi characters are shown as `⟨U+202E⟩` escapes (ADR 0082).
 */
export function formatUraAnchor(anchor: UraAnchor): string {
  switch (anchor.kind) {
    case 'lines': {
      const lines =
        anchor.startLine === anchor.endLine
          ? String(anchor.startLine)
          : `${String(anchor.startLine)}-${String(anchor.endLine)}`;
      return `${revealFormatControls(anchor.path)}:${lines}`;
    }
    case 'file': {
      return revealFormatControls(anchor.path);
    }
    case 'change': {
      return 'the whole change';
    }
  }
}
