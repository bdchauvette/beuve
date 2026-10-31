import type { CallHierarchyNode } from './lsp-model.ts';

/** Inclusive 1-based line span on the new side of a diff (git's `newStart`, `newStart+newCount-1`). */
export interface ChangedLineSpan {
  readonly startLine: number;
  readonly endLine: number;
}

/** Changed spans per workspace-relative path (`/` separators), as main derives them from hunks. */
export type ChangedLines = ReadonlyMap<string, readonly ChangedLineSpan[]>;

export type CallHierarchyBadge = 'modified' | 'untouched' | 'external';

/**
 * Badges a peek-portal node: `modified` when any changed span overlaps the node's whole range
 * (declaration and body), `untouched` otherwise, `external` for files outside the workspace.
 * For a hunk that only deletes lines (`newCount` 0), pass the lines on either side of the gap.
 */
export function badgeCallHierarchyNode(
  node: Pick<CallHierarchyNode, 'file' | 'range'>,
  changed: ChangedLines,
): CallHierarchyBadge {
  if (node.file.kind === 'external') {
    return 'external';
  }
  const first = node.range.start.line + 1;
  const last =
    node.range.end.line +
    (node.range.end.character === 0 && node.range.end.line > node.range.start.line ? 0 : 1);
  const spans = changed.get(node.file.path) ?? [];
  if (spans.some((span) => span.startLine <= last && span.endLine >= first)) {
    return 'modified';
  }
  return 'untouched';
}
