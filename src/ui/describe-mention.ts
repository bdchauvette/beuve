import type { ChatMentionView } from '#contract/ipc-contract.ts';

import type { MentionTarget } from './chat-draft.ts';

/**
 * A chip's label and tooltip (ADR 0046): the file name with its lines, `discounts.ts:27-33`,
 * `base:` before a base-side one, the name alone for a whole file. The tooltip has the full path
 * and the commit. Pure.
 */
export function describeMention(mention: MentionTarget | ChatMentionView): {
  readonly label: string;
  readonly title: string;
} {
  const { path, side, startLine, endLine } = mention;
  const name = path.split('/').at(-1) ?? path;
  const lines =
    startLine === undefined || endLine === undefined
      ? ''
      : startLine === endLine
        ? `:${String(startLine)}`
        : `:${String(startLine)}-${String(endLine)}`;
  const marker = side === 'base' ? 'base:' : '';
  const commit = 'sha' in mention ? ` at ${mention.sha.slice(0, 8)}` : '';
  const what =
    startLine === undefined || endLine === undefined
      ? 'whole file'
      : startLine === endLine
        ? `line ${String(startLine)}`
        : `lines ${String(startLine)}-${String(endLine)}`;
  return {
    label: `${marker}${name}${lines}`,
    title: `${path}, ${what}, ${side === 'base' ? 'base side' : 'head'}${commit}`,
  };
}
