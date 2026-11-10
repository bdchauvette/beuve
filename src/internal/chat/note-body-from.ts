const wholeFence = /^(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*\n([\s\S]*?)\n\1[ \t]*$/u;

/**
 * The note body in a drafting answer (ADR 0125): the reply trimmed, unwrapped when the model
 * fenced the whole of it as Markdown despite the instructions. Empty when nothing is left. Pure.
 */
export function noteBodyFrom(answer: string): string {
  const trimmed = answer.trim();
  const fenced = wholeFence.exec(trimmed);
  if (fenced === null) {
    return trimmed;
  }
  return (fenced[2] ?? '').trim();
}
