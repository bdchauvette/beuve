import type { DiagnosticSeverityView } from '#contract/ipc-contract.ts';

/** A range of text on screen, and how bad the problem under it is. */
export interface DiagnosticRange {
  readonly severity: DiagnosticSeverityView;
  readonly range: Range;
}

/** Where overlapping highlights meet, the worse problem is painted on top. */
const priorities: Readonly<Record<DiagnosticSeverityView, number>> = {
  error: 4,
  warning: 3,
  information: 2,
  hint: 1,
};

/**
 * Underlines the text of diagnostics with CSS Custom Highlights (`index.css` styles
 * `::highlight(beuve-diagnostic-<severity>)`), as the definition link does: nothing is added to the
 * library's DOM, and the underline stays on the text through scrolling and re-layout. The four
 * highlights are shared by the whole document, so each owner (a file card, a sheet) adds its own
 * ranges and takes out only those. An owner calls {@link DiagnosticHighlights.set} whenever its
 * rows may have changed, and {@link DiagnosticHighlights.clear} when it goes away.
 */
export class DiagnosticHighlights {
  private owned: readonly DiagnosticRange[] = [];

  /** Replaces this owner's ranges. */
  set(ranges: readonly DiagnosticRange[]): void {
    this.clear();
    for (const { severity, range } of ranges) {
      sharedHighlight(severity).add(range);
    }
    this.owned = ranges;
  }

  /** Takes this owner's ranges off the screen. */
  clear(): void {
    for (const { severity, range } of this.owned) {
      sharedHighlight(severity).delete(range);
    }
    this.owned = [];
  }
}

function sharedHighlight(severity: DiagnosticSeverityView): Highlight {
  const name = `beuve-diagnostic-${severity}`;
  const existing = CSS.highlights.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Highlight();
  created.priority = priorities[severity];
  CSS.highlights.set(name, created);
  return created;
}
