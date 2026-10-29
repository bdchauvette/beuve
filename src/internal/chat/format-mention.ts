/** The part of a mention the prompt names. */
export interface MentionPlace {
  readonly path: string;
  readonly side: 'head' | 'base';
  readonly startLine?: number;
  readonly endLine?: number;
}

/**
 * How the prompt writes a mention (ADR 0046): `path:start-end` (or `path:line`, or `path` for a
 * whole file), prefixed with `base:` for the base side. Pure.
 */
export function formatMention(mention: MentionPlace): string {
  const { path, side, startLine, endLine } = mention;
  const lines =
    startLine === undefined || endLine === undefined
      ? ''
      : startLine === endLine
        ? `:${String(startLine)}`
        : `:${String(startLine)}-${String(endLine)}`;
  return `${side === 'base' ? 'base:' : ''}${path}${lines}`;
}
