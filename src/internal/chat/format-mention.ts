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
  const { path, side } = mention;
  return `${sidePrefixes[side]}${path}${linesOf(mention)}`;
}

const sidePrefixes = { head: '', base: 'base:' } as const;

function linesOf({ startLine, endLine }: MentionPlace): string {
  if (startLine === undefined || endLine === undefined) {
    return '';
  }
  if (startLine === endLine) {
    return `:${String(startLine)}`;
  }
  return `:${String(startLine)}-${String(endLine)}`;
}
