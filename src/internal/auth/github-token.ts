const redacted = '[redacted]';
const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');
const maxTokenLength = 4096;
const printableAscii = /^[!-~]+$/;

/**
 * A GitHub access token. The secret lives in a private field and is read only through
 * {@link GithubToken.reveal}, at the moment a request is sent; string conversion, JSON and
 * `util.inspect` (so loggers and `console.log`) all print `[redacted]`. The private field makes
 * the class nominal, so a plain string can't be passed where a token is expected. Never persist
 * it and never send it to the renderer (ADR 0034).
 */
export class GithubToken {
  /** A token from a credential source's output: trimmed, non-empty printable ASCII, no spaces. */
  static parse(raw: string): GithubToken | undefined {
    const value = raw.trim();
    return value.length > maxTokenLength || !printableAscii.test(value)
      ? undefined
      : new GithubToken(value);
  }

  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /** The secret, for an `Authorization` header. Don't store or log the result. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return redacted;
  }

  toJSON(): string {
    return redacted;
  }

  [Symbol.toPrimitive](): string {
    return redacted;
  }

  [inspectSymbol](): string {
    return redacted;
  }
}
