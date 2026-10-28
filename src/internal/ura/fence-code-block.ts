const backtickRun = /`+/gu;

/**
 * A Markdown fenced code block whose fence is longer than any backtick run in `content`, so the
 * content can't close it early. `content` may or may not end with a newline.
 */
export function fenceCodeBlock(info: string, content: string): string {
  let longest = 0;
  for (const run of content.matchAll(backtickRun)) {
    longest = Math.max(longest, run[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `${fence}${info}\n${content === '' ? '' : body}${fence}`;
}
