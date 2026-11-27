import { isLspRange } from './is-lsp-range.ts';
import type { LspTextEdit } from './lsp-protocol.ts';
import { normalizeUri } from './normalize-uri.ts';

/** One document's text edits, in the order the server sent them. */
export interface WorkspaceEditFile {
  /** Normalized, as the server named the document; not yet checked. */
  readonly uri: string;
  readonly edits: readonly LspTextEdit[];
}

/**
 * A checked `WorkspaceEdit` (ADR 0163), reduced to what beuve can show: the text edits per
 * document, and how much was left out. Nothing here is applied.
 */
export interface ParsedWorkspaceEdit {
  /** Documents in the order the server first named them; edits of one document are joined. */
  readonly files: readonly WorkspaceEditFile[];
  /** `create`, `rename` and `delete` entries of `documentChanges`. */
  readonly resourceOperations: number;
  /** Entries and edits that are none of the shapes the protocol defines (snippet edits among them). */
  readonly malformed: number;
}

/**
 * Parses a `textDocument/rename` result, which is untrusted. `documentChanges` is read when it is
 * an array, as the protocol says clients that announce it prefer it, and `changes` otherwise;
 * `null` is no edit.
 */
export function parseWorkspaceEdit(value: unknown): ParsedWorkspaceEdit {
  const files = new Map<string, LspTextEdit[]>();
  const counts = { resourceOperations: 0, malformed: 0 };
  if (typeof value !== 'object' || value === null) {
    return { files: [], ...counts };
  }
  const add = ({ uri, edits }: UncheckedEdits): void => {
    if (typeof uri !== 'string' || !Array.isArray(edits)) {
      counts.malformed += 1;
      return;
    }
    const kept = files.getOrInsertComputed(normalizeUri(uri), () => {
      return [];
    });
    for (const edit of edits as readonly unknown[]) {
      if (isTextEdit(edit)) {
        kept.push({ range: edit.range, newText: edit.newText });
      } else {
        counts.malformed += 1;
      }
    }
  };
  if ('documentChanges' in value && Array.isArray(value.documentChanges)) {
    for (const change of value.documentChanges as readonly unknown[]) {
      if (isResourceOperation(change)) {
        counts.resourceOperations += 1;
      } else if (isTextDocumentEdit(change)) {
        add({ uri: change.textDocument.uri, edits: change.edits });
      } else {
        counts.malformed += 1;
      }
    }
  } else if ('changes' in value && typeof value.changes === 'object' && value.changes !== null) {
    for (const [uri, edits] of Object.entries(value.changes)) {
      add({ uri, edits });
    }
  }
  return {
    files: Array.from(files, ([uri, edits]) => {
      return { uri, edits };
    }),
    ...counts,
  };
}

/** One document's edits as the server sent them, unchecked. */
interface UncheckedEdits {
  readonly uri: unknown;
  readonly edits: unknown;
}

/** A `TextDocumentEdit`'s shape, before its edits are checked. */
interface UncheckedDocumentEdit {
  readonly textDocument: { readonly uri: unknown };
  readonly edits: unknown;
}

const resourceKinds = new Set(['create', 'rename', 'delete']);

function isResourceOperation(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    resourceKinds.has(value.kind)
  );
}

function isTextDocumentEdit(value: unknown): value is UncheckedDocumentEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    'textDocument' in value &&
    'edits' in value &&
    typeof value.textDocument === 'object' &&
    value.textDocument !== null &&
    'uri' in value.textDocument
  );
}

/** A `TextEdit` or `AnnotatedTextEdit` (its annotation is ignored); a snippet edit is not one. */
function isTextEdit(value: unknown): value is LspTextEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    'range' in value &&
    'newText' in value &&
    isLspRange(value.range) &&
    typeof value.newText === 'string'
  );
}
