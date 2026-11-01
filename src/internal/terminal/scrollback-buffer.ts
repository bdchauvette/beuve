/**
 * The last part of a terminal's output, kept so a reloaded renderer can replay it. `end` counts
 * every character ever appended, so a replay and the live output after it can be told apart.
 */
export class ScrollbackBuffer {
  readonly #limit: number;
  #text = '';
  #end = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  /** Characters appended so far, including those already dropped. */
  get end(): number {
    return this.#end;
  }

  /** The retained output, from a line start when anything was dropped. */
  get text(): string {
    return this.#text;
  }

  append(chunk: string): void {
    this.#end += chunk.length;
    this.#text += chunk;
    if (this.#text.length <= this.#limit) {
      return;
    }
    const cut = this.#text.length - this.#limit;
    const lineStart = this.#text.indexOf('\n', cut);
    if (lineStart === -1) {
      this.#text = this.#text.slice(cut);
      return;
    }
    this.#text = this.#text.slice(lineStart + 1);
  }
}
