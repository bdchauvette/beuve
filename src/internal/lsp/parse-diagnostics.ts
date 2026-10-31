import { isLspRange } from './is-lsp-range.ts';
import type { LspDiagnostic, LspDiagnosticSeverity, LspLocation } from './lsp-protocol.ts';

/** Keeps the well-formed diagnostics in a server array, normalising optional fields. */
export function parseDiagnostics(value: unknown): LspDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item: unknown) => {
    const diagnostic = parseDiagnostic(item);
    if (diagnostic === undefined) {
      return [];
    }
    return [diagnostic];
  });
}

type Fields = Readonly<Record<string, unknown>>;

function parseDiagnostic(value: unknown): LspDiagnostic | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { range, message, severity, code, source, tags, relatedInformation } = value as Fields;
  if (typeof message !== 'string' || !isLspRange(range)) {
    return undefined;
  }
  return {
    range,
    message,
    ...(isSeverity(severity) && { severity }),
    ...((typeof code === 'string' || typeof code === 'number') && { code }),
    ...(typeof source === 'string' && { source }),
    ...(Array.isArray(tags) && { tags: tags.filter((tag) => typeof tag === 'number') }),
    ...(Array.isArray(relatedInformation) && {
      relatedInformation: relatedInformation.flatMap((item: unknown) => parseRelated(item)),
    }),
  };
}

function isSeverity(value: unknown): value is LspDiagnosticSeverity {
  return [1, 2, 3, 4].includes(value as number);
}

function parseRelated(value: unknown): { location: LspLocation; message: string }[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const { location, message } = value as Fields;
  if (typeof location !== 'object' || location === null || typeof message !== 'string') {
    return [];
  }
  const { uri, range } = location as Fields;
  if (typeof uri === 'string' && isLspRange(range)) {
    return [{ location: { uri, range }, message }];
  }
  return [];
}
