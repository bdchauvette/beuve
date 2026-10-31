import type { ReviewEditPreviewView } from '#contract/ipc-contract.ts';

/**
 * The one-line summary of what staging review edits would do (ADR 0088): how many suggestions
 * and notes it adds or changes, and how many earlier ones it leaves as they are. Pure.
 */
export function describeHarvest(edits: readonly ReviewEditPreviewView[]): string {
  if (edits.length === 0) {
    return 'The review edits match the reviewed head: nothing to stage.';
  }
  const changing = edits.filter((edit) => edit.action !== 'unchanged');
  const unchanged = edits.length - changing.length;
  const suggestions = changing.filter((edit) => edit.kind === 'suggestion').length;
  const notes = changing.length - suggestions;
  const parts: string[] = [];
  if (suggestions > 0) {
    parts.push(count(suggestions, 'suggestion'));
  }
  if (notes > 0) {
    parts.push(`${count(notes, 'note')} with a diff`);
  }
  let text = 'Nothing new to stage';
  if (parts.length > 0) {
    text = `Stage ${parts.join(' and ')}`;
  }
  if (unchanged > 0) {
    text += `; ${String(unchanged)} already staged`;
  }
  return `${text}.`;
}

function count(value: number, noun: string): string {
  if (value === 1) {
    return `1 ${noun}`;
  }
  return `${String(value)} ${noun}s`;
}
