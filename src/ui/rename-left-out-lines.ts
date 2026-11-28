import type { RenamePreviewView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/** A noun for one, and for more. */
interface Nouns {
  readonly one: string;
  readonly many: string;
}

/**
 * What a rename's preview says it left out (ADR 0163), one line per kind that has any, then one
 * per file whose edits can't be suggestions, its path revealed (ADR 0082). Pure.
 */
export function renameLeftOutLines(leftOut: RenamePreviewView['leftOut']): readonly string[] {
  const lines: string[] = [];
  const add = (count: number, { one, many }: Nouns): void => {
    if (count === 1) {
      lines.push(`1 ${one} left out.`);
    } else if (count > 1) {
      lines.push(`${String(count)} ${many} left out.`);
    }
  };
  add(leftOut.resourceOperations, {
    one: 'file operation (create, rename or delete a file)',
    many: 'file operations (create, rename or delete a file)',
  });
  add(leftOut.outsideCheckout, {
    one: 'file outside the checkout',
    many: 'files outside the checkout',
  });
  add(leftOut.untracked, {
    one: 'file the head doesn’t track',
    many: 'files the head doesn’t track',
  });
  add(leftOut.malformed, { one: 'edit beuve can’t read', many: 'edits beuve can’t read' });
  for (const file of leftOut.unusable) {
    lines.push(`${revealFormatControls(file.path)} left out: ${file.reason}.`);
  }
  return lines;
}
