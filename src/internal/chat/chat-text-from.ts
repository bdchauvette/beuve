import type { ChatPart } from './chat-message.ts';
import { mentionKeyOf } from './mention-key-of.ts';
import type { NoteProposal } from './note-proposal.ts';

/**
 * A message's text for a prompt (ADR 0072): its text parts in order, with each `mention` part as
 * `[[@n]]`, `n` counting distinct mentions in order of first appearance (the numbering
 * {@link chatMentionsFrom} lists them in), and each proposed note as the `:::note` block it was
 * written as (ADR 0132), so a later turn sees what was proposed; a dropped one separates the text
 * around it. Reasoning, tool calls, findings and errors say nothing here. Pure.
 */
export function chatTextFrom(parts: readonly ChatPart[]): string {
  const numbers = new Map<string, number>();
  const blocks: string[] = [];
  let text = '';
  const endBlock = (): void => {
    if (text === '') {
      return;
    }
    blocks.push(text);
    text = '';
  };
  const add = (part: ChatPart): void => {
    switch (part.kind) {
      case 'text': {
        text += part.text;
        return;
      }
      case 'mention': {
        const key = mentionKeyOf(part.mention);
        const number = numbers.getOrInsertComputed(key, () => numbers.size + 1);
        text += `[[@${String(number)}]]`;
        return;
      }
      case 'proposal': {
        endBlock();
        blocks.push(proposalBlockFrom(part.note));
        return;
      }
      case 'dropped-proposal': {
        endBlock();
        return;
      }
      default: {
        return;
      }
    }
  };
  for (const part of parts) {
    add(part);
  }
  endBlock();
  return blocks.join('\n\n');
}

function proposalBlockFrom({ label, path, startLine, endLine, title, body }: NoteProposal): string {
  const opening = [':::note', label, `[[${path}:${String(startLine)}-${String(endLine)}]]`];
  if (title !== '') {
    opening.push(title);
  }
  const lines = [opening.join(' ')];
  if (body !== '') {
    lines.push(body);
  }
  lines.push(':::');
  return lines.join('\n');
}
