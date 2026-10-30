import type { LspServerCapabilities, PositionEncoding } from './lsp-protocol.ts';
import { positionEncodings } from './position-encodings.ts';

/**
 * Reads the `initialize` result. `undefined` when it has no `capabilities` object. A missing or
 * unrecognised `positionEncoding` means UTF-16, the protocol default.
 */
export function parseServerCapabilities(result: unknown): LspServerCapabilities | undefined {
  if (typeof result !== 'object' || result === null || !('capabilities' in result)) {
    return undefined;
  }
  const { capabilities } = result;
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    return undefined;
  }
  const raw = capabilities as Readonly<Record<string, unknown>>;
  const isEnabled = (name: string): boolean => {
    const value = raw[name];
    return value === true || (typeof value === 'object' && value !== null);
  };
  return {
    positionEncoding: encodingFrom(raw['positionEncoding']),
    callHierarchy: isEnabled('callHierarchyProvider'),
    pullDiagnostics: isEnabled('diagnosticProvider'),
    definition: isEnabled('definitionProvider'),
    references: isEnabled('referencesProvider'),
    hover: isEnabled('hoverProvider'),
    documentSymbol: isEnabled('documentSymbolProvider'),
    raw,
  };
}

function encodingFrom(value: unknown): PositionEncoding {
  return value === positionEncodings.utf8 || value === positionEncodings.utf32
    ? value
    : positionEncodings.utf16;
}
