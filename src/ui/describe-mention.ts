import type { ChatMentionView } from '#contract/ipc-contract.ts';

import type { MentionTarget } from './chat-draft.ts';

/** A chip's text and its tooltip. */
export interface MentionLabels {
  readonly label: string;
  readonly title: string;
}

/**
 * A chip's label and tooltip (ADR 0046): the file name with its lines, `discounts.ts:27-33`,
 * `base:` before a base-side one, the name alone for a whole file. The tooltip has the full path
 * and the commit. Pure.
 */
export function describeMention(mention: MentionTarget | ChatMentionView): MentionLabels {
  const { path } = mention;
  const name = path.split('/').at(-1) ?? path;
  const span = spanOf(mention);
  const side = sideLabels[mention.side];
  const label = `${side.marker}${name}${span.suffix}`;
  const title = `${path}, ${span.what}, ${side.title}`;
  if ('sha' in mention) {
    return { label, title: `${title} at ${mention.sha.slice(0, 8)}` };
  }
  return { label, title };
}

/** How a chip writes its lines: after the name (`:27-33`), and in words (`lines 27-33`). */
interface MentionSpan {
  readonly suffix: string;
  readonly what: string;
}

const sideLabels: Readonly<Record<ChatMentionView['side'], { marker: string; title: string }>> = {
  base: { marker: 'base:', title: 'base side' },
  head: { marker: '', title: 'head' },
};

function spanOf({ startLine, endLine }: MentionTarget): MentionSpan {
  if (startLine === undefined || endLine === undefined) {
    return { suffix: '', what: 'whole file' };
  }
  if (startLine === endLine) {
    return { suffix: `:${String(startLine)}`, what: `line ${String(startLine)}` };
  }
  const range = `${String(startLine)}-${String(endLine)}`;
  return { suffix: `:${range}`, what: `lines ${range}` };
}
