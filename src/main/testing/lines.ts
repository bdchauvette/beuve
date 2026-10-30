/** Source lines joined into file content, each ended by a newline. */
export function lines(content: readonly string[]): string {
  return content.map((line) => `${line}\n`).join('');
}
