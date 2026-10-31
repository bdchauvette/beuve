/** A fenced code block: its info string (the language, `diff` or `suggestion`) and its content. */
export interface CodeBlock {
  readonly info: string;
  readonly content: string;
}
const backtickRun = /`+/gu;

/**
 * A Markdown fenced code block whose fence is longer than any backtick run in `content`, so the
 * content can't close it early. `content` may or may not end with a newline.
 */
export function fenceCodeBlock({ info, content }: CodeBlock): string {
  let longest = 0;
  for (const run of content.matchAll(backtickRun)) {
    longest = Math.max(longest, run[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  let body = content;
  if (content !== '' && !content.endsWith('\n')) {
    body += '\n';
  }
  return `${fence}${info}\n${body}${fence}`;
}
