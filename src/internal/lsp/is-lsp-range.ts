import type { LspRange } from './lsp-protocol.ts';

/** Whether a server value is a well-formed LSP range of non-negative integers. */
export function isLspRange(value: unknown): value is LspRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    'end' in value &&
    isPosition(value.start) &&
    isPosition(value.end)
  );
}

function isPosition(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { line, character } = value as { line?: unknown; character?: unknown };
  return isCount(line) && isCount(character);
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
