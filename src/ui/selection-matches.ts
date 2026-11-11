import type { ReactiveController } from 'lit';

import { needleOffsetsIn } from './needle-offsets-in.ts';
import { selectionNeedleFrom } from './selection-needle-from.ts';
import type { LineSelection, SelectionNeedle } from './selection-needle-from.ts';
import { textRangeIn } from './text-range-in.ts';

/** The name `index.css` styles with `::highlight()`: a faint tint, under every other highlight. */
const highlightName = 'beuve-selection-match';
/** How long the selection must rest before the rows are scanned: a drag fires many changes. */
const settleMilliseconds = 120;
/** At most this many occurrences are painted, so a common selection stays cheap on a long diff. */
const maxMatches = 500;
const rowSelector = 'code [data-line]';

/**
 * Highlights the other occurrences of the text selected in a code view (ADR 0126), in the code
 * views `roots` returns (each a `@pierre/diffs` shadow root): a container (the diff stream, a
 * sheet) adds it in its constructor, `this.addController(new SelectionMatches(() => …))`. Only a selection inside
 * one row of those roots counts, and only the rows the library has rendered are scanned. The
 * ranges go in one document-wide CSS Custom Highlight, as the diagnostics do, so nothing is added
 * to the library's DOM; each container adds and takes out only its own.
 */
export class SelectionMatches implements ReactiveController {
  private readonly roots: () => readonly ShadowRoot[];
  private connection: DisposableStack | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private owned: readonly Range[] = [];

  constructor(roots: () => readonly ShadowRoot[]) {
    this.roots = roots;
  }

  private sync(): void {
    const roots = this.roots();
    const selected = selectedLine(roots);
    const needle = selected && selectionNeedleFrom(selected);
    if (needle === undefined) {
      this.clear();
      return;
    }
    this.set(matchRangesIn(roots, needle));
  }

  private set(ranges: readonly Range[]): void {
    this.clear();
    const highlight = sharedHighlight();
    for (const range of ranges) {
      highlight.add(range);
    }
    this.owned = ranges;
  }

  private clear(): void {
    const highlight = CSS.highlights.get(highlightName);
    for (const range of this.owned) {
      highlight?.delete(range);
    }
    this.owned = [];
  }

  hostConnected(): void {
    this.connection?.dispose();
    const connection = new DisposableStack();
    const listener = connection.adopt(new AbortController(), (controller) => {
      controller.abort();
    });
    connection.defer(() => {
      clearTimeout(this.timer);
      this.clear();
    });
    document.addEventListener(
      'selectionchange',
      () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.sync();
        }, settleMilliseconds);
      },
      { signal: listener.signal },
    );
    this.connection = connection;
  }

  hostDisconnected(): void {
    this.connection?.dispose();
    this.connection = undefined;
  }
}

/** The document's selection, when it lies inside one code row of `roots`, with its neighbors. */
function selectedLine(roots: readonly ShadowRoot[]): LineSelection | undefined {
  const selection = document.getSelection();
  if (selection === null || roots.length === 0) {
    return undefined;
  }
  const [composed] = selection.getComposedRanges({ shadowRoots: [...roots] });
  if (composed === undefined || composed.collapsed) {
    return undefined;
  }
  const row = rowOf(composed.startContainer);
  if (
    row === undefined ||
    rowOf(composed.endContainer) !== row ||
    roots.every((root) => root !== row.getRootNode())
  ) {
    return undefined;
  }
  const before = document.createRange();
  before.setStart(row, 0);
  before.setEnd(composed.startContainer, composed.startOffset);
  const range = document.createRange();
  range.setStart(composed.startContainer, composed.startOffset);
  range.setEnd(composed.endContainer, composed.endOffset);
  const line = row.textContent;
  const start = before.toString().length;
  const text = range.toString();
  return { text, before: line.charAt(start - 1), after: line.charAt(start + text.length) };
}

/** The ranges of `needle`'s occurrences on the rows the roots have rendered, at most {@link maxMatches}. */
function matchRangesIn(roots: readonly ShadowRoot[], needle: SelectionNeedle): Range[] {
  const ranges: Range[] = [];
  for (const root of roots) {
    for (const row of root.querySelectorAll<HTMLElement>(rowSelector)) {
      const found = needleOffsetsIn(row.textContent, needle, maxMatches - ranges.length);
      for (const offsets of found) {
        const range = textRangeIn(row, offsets);
        if (range !== undefined) {
          ranges.push(range);
        }
      }
      if (ranges.length >= maxMatches) {
        return ranges;
      }
    }
  }
  return ranges;
}

function rowOf(node: Node): HTMLElement | undefined {
  let element = node.parentElement;
  if (node instanceof HTMLElement) {
    element = node;
  }
  return element?.closest<HTMLElement>(rowSelector) ?? undefined;
}

function sharedHighlight(): Highlight {
  const existing = CSS.highlights.get(highlightName);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Highlight();
  created.priority = 0;
  CSS.highlights.set(highlightName, created);
  return created;
}
