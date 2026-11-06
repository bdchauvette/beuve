import { convertRange } from './convert-range.ts';
import type { LineIndex } from './line-index.ts';
import type {
  CallHierarchyNode,
  DiagnosticSeverity,
  DiagnosticView,
  DocumentSymbolView,
  LocationView,
  Range,
} from './lsp-model.ts';
import type {
  LspCallHierarchyItem,
  LspDiagnostic,
  LspDocumentSymbol,
  LspLocation,
  LspRange,
  PositionEncoding,
} from './lsp-protocol.ts';
import { normalizeUri } from './normalize-uri.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import { symbolKindName } from './symbol-kind-name.ts';
import { fileReferenceFrom } from './file-reference-from.ts';
import { positionEncodings } from './position-encodings.ts';

export interface ViewMapperContext {
  readonly root: WorkspaceRoot;
  /** The server these values come from, which its diagnostics are tagged with. */
  readonly serverId: string;
  /** The server's negotiated encoding. */
  readonly encoding: PositionEncoding;
  /** Lines of a document by normalized URI, when known; needed unless the encoding is UTF-16. */
  readonly lines: (uri: string) => LineIndex | undefined;
}

/** Converts checked protocol values into beuve's model: UTF-16 columns, root-relative files. */
export interface ViewMapper {
  readonly range: (uri: string, range: LspRange) => Range;
  readonly location: (location: LspLocation) => LocationView;
  readonly diagnostic: (uri: string, diagnostic: LspDiagnostic) => DiagnosticView;
  readonly node: (id: string, item: LspCallHierarchyItem) => CallHierarchyNode;
  readonly symbol: (uri: string, symbol: LspDocumentSymbol) => DocumentSymbolView;
}

const severities: Readonly<Record<number, DiagnosticSeverity>> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
};

/**
 * Creates the mapper for one server's results. Columns in files whose lines are unknown (outside
 * the root and not open) are passed through unconverted.
 */
export function createViewMapper(context: ViewMapperContext): ViewMapper {
  const range = (uri: string, value: LspRange): Range => {
    return convertRange(value, context.lines(normalizeUri(uri)), {
      from: context.encoding,
      to: positionEncodings.utf16,
    });
  };

  const location = (value: LspLocation): LocationView => {
    return {
      file: fileReferenceFrom(context.root, value.uri),
      range: range(value.uri, value.range),
    };
  };

  const symbol = (uri: string, value: LspDocumentSymbol): DocumentSymbolView => {
    return {
      name: value.name,
      kind: symbolKindName(value.kind),
      detail: value.detail,
      range: range(uri, value.range),
      selectionRange: range(uri, value.selectionRange),
      children: (value.children ?? []).map((child) => symbol(uri, child)),
    };
  };

  return {
    range,
    location,
    diagnostic: (uri, value): DiagnosticView => {
      return {
        serverId: context.serverId,
        range: range(uri, value.range),
        severity: severityOf(value),
        code: codeOf(value),
        source: value.source,
        message: value.message,
        tags: (value.tags ?? [])
          .filter((tag) => tag === 1 || tag === 2)
          .map((tag) => {
            if (tag === 1) {
              return 'unnecessary';
            }
            return 'deprecated';
          }),
        related: (value.relatedInformation ?? []).map((related) => {
          return {
            location: location(related.location),
            message: related.message,
          };
        }),
      };
    },
    node: (id, item): CallHierarchyNode => {
      return {
        id,
        name: item.name,
        kind: symbolKindName(item.kind),
        detail: detailOf(item),
        file: fileReferenceFrom(context.root, item.uri),
        range: range(item.uri, item.range),
        selectionRange: range(item.uri, item.selectionRange),
      };
    },
    symbol,
  };
}

function severityOf(diagnostic: LspDiagnostic): DiagnosticSeverity | undefined {
  if (diagnostic.severity === undefined) {
    return undefined;
  }
  return severities[diagnostic.severity];
}

function codeOf(diagnostic: LspDiagnostic): string | undefined {
  if (diagnostic.code === undefined) {
    return undefined;
  }
  return String(diagnostic.code);
}

/** A server's detail, where an empty one means none. */
function detailOf(item: LspCallHierarchyItem): string | undefined {
  if (item.detail === '') {
    return undefined;
  }
  return item.detail;
}
