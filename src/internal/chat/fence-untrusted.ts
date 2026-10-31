const backtickRun = /`+/gu;

/** A code block's info string: the language its content is shown as. */
export type FenceLanguage = '' | 'diff' | 'markdown' | 'text';

/** Fences untrusted text in a Markdown code block it can't close from inside. Pure. */
export function fenceUntrusted(text: string, language: FenceLanguage): string {
  const longestRun = Math.max(
    0,
    ...Array.from(text.matchAll(backtickRun), (match) => match[0].length),
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  if (text.endsWith('\n')) {
    return `${fence}${language}\n${text}${fence}`;
  }
  return `${fence}${language}\n${text}\n${fence}`;
}
