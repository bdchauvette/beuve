/**
 * Splits a document into lines the way LSP counts them: `\r\n`, `\n` and a lone `\r` each end a
 * line. Line text excludes its terminator.
 */
export class LineIndex {
  readonly #text: string;
  readonly #starts: number[] = [0];
  readonly #ends: number[] = [];

  constructor(text: string) {
    this.#text = text;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.codePointAt(index);
      if (code !== 10 && code !== 13) {
        continue;
      }
      this.#ends.push(index);
      if (code === 13 && text.codePointAt(index + 1) === 10) {
        index += 1;
      }
      this.#starts.push(index + 1);
    }
    this.#ends.push(text.length);
  }

  get lineCount(): number {
    return this.#starts.length;
  }

  /** The text of 0-based `line`, or `''` past the end. */
  lineText(line: number): string {
    const start = this.#starts[line];
    const end = this.#ends[line];
    if (start === undefined || end === undefined) {
      return '';
    }
    return this.#text.slice(start, end);
  }
}
