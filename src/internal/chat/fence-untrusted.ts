const backtickRun = /`+/gu;

/** Fences untrusted text in a Markdown code block it can't close from inside. Pure. */
export function fenceUntrusted(text: string, language: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(text.matchAll(backtickRun), (match) => match[0].length),
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
}
