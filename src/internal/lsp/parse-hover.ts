import { isLspRange } from './is-lsp-range.ts';
import type { LspRange } from './lsp-protocol.ts';

export interface LspHover {
  readonly kind: 'markdown' | 'plaintext';
  readonly value: string;
  readonly range: LspRange | undefined;
}

/**
 * Parses a hover result, folding `MarkupContent`, a `MarkedString` or `MarkedString[]` into one
 * Markdown or plain-text value. `null` or empty content is `undefined`.
 */
export function parseHover(value: unknown): LspHover | undefined {
  if (typeof value !== 'object' || value === null || !('contents' in value)) {
    return undefined;
  }
  const range = 'range' in value && isLspRange(value.range) ? value.range : undefined;
  const { contents } = value;
  const markup = asMarkup(contents);
  if (markup !== undefined) {
    return markup.value === '' ? undefined : { ...markup, range };
  }
  const parts = (Array.isArray(contents) ? contents : [contents]).flatMap((part: unknown) => {
    const text = markedString(part);
    return text ?? [];
  });
  return parts.length === 0 ? undefined : { kind: 'markdown', value: parts.join('\n\n'), range };
}

function asMarkup(value: unknown): { kind: 'markdown' | 'plaintext'; value: string } | undefined {
  if (typeof value !== 'object' || value === null || !('kind' in value) || !('value' in value)) {
    return undefined;
  }
  const { kind, value: text } = value;
  return typeof text === 'string' && (kind === 'markdown' || kind === 'plaintext')
    ? { kind, value: text }
    : undefined;
}

function markedString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value === '' ? undefined : value;
  }
  if (typeof value !== 'object' || value === null || !('value' in value)) {
    return undefined;
  }
  const language = 'language' in value && typeof value.language === 'string' ? value.language : '';
  return typeof value.value === 'string' ? `\`\`\`${language}\n${value.value}\n\`\`\`` : undefined;
}
