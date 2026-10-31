import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import type { UraAnchor } from './ura-item.ts';

/**
 * `src/a.ts:12`, `src/a.ts:12-14`, `src/a.ts` or `the whole change`, for human readers: the path's
 * invisible and bidi characters are shown as `⟨U+202E⟩` escapes (ADR 0082).
 */
export function formatUraAnchor(anchor: UraAnchor): string {
  switch (anchor.kind) {
    case 'lines': {
      const path = revealFormatControls(anchor.path);
      if (anchor.startLine === anchor.endLine) {
        return `${path}:${String(anchor.startLine)}`;
      }
      return `${path}:${String(anchor.startLine)}-${String(anchor.endLine)}`;
    }
    case 'file': {
      return revealFormatControls(anchor.path);
    }
    case 'change': {
      return 'the whole change';
    }
  }
}
