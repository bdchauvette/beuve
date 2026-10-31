import type { ChatMessageView } from '#contract/ipc-contract.ts';

/** A message's text parts joined, each mention part as `[[@n]]` in order, for assertions. */
export function textOf(message: ChatMessageView | undefined): string {
  let mentions = 0;
  return (message?.parts ?? [])
    .map((part) => {
      if (part.kind === 'mention') {
        mentions += 1;
        return `[[@${String(mentions)}]]`;
      }
      if (part.kind === 'text') {
        return part.text;
      }
      return '';
    })
    .join('');
}
