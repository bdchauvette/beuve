import { Buffer } from 'node:buffer';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/** Why a byte stream can't be split into `Content-Length` frames. The stream is unusable after one. */
export type FramingError =
  | { readonly kind: 'header-too-large'; readonly maxHeaderBytes: number }
  | { readonly kind: 'missing-content-length'; readonly header: string }
  | { readonly kind: 'invalid-content-length'; readonly value: string }
  | {
      readonly kind: 'message-too-large';
      readonly length: number;
      readonly maxMessageBytes: number;
    };

export interface ContentLengthDecoderOptions {
  /** Largest accepted header block, terminator included. Defaults to 8 KiB. */
  readonly maxHeaderBytes?: number;
  /** Largest accepted body. Defaults to 64 MiB. */
  readonly maxMessageBytes?: number;
}

const headerTerminator = Buffer.from('\r\n\r\n', 'latin1');
const decimalPattern = /^\d{1,15}$/u;

/**
 * Splits a byte stream framed as in the Language Server Protocol base protocol
 * (`Content-Length: N\r\n…\r\n\r\n` followed by N bytes of UTF-8) into message bodies. Chunks may
 * split anywhere, including inside a header or a multi-byte character, and may carry several
 * messages. Bytes are copied O(1) times each. After an error the decoder stays failed.
 */
export class ContentLengthDecoder {
  readonly #maxHeaderBytes: number;
  readonly #maxMessageBytes: number;
  readonly #decoder = new TextDecoder('utf-8');
  #chunks: Buffer[] = [];
  #buffered = 0;
  #expectedLength: number | undefined;
  #failure: FramingError | undefined;

  constructor(options: ContentLengthDecoderOptions = {}) {
    this.#maxHeaderBytes = options.maxHeaderBytes ?? 8 * 1024;
    this.#maxMessageBytes = options.maxMessageBytes ?? 64 * 1024 * 1024;
  }

  #readHeader(): Result<number | undefined, FramingError> {
    if (this.#buffered === 0) {
      return ok(undefined);
    }
    const head = this.#compact();
    const end = head.indexOf(headerTerminator);
    if (end === -1) {
      return head.byteLength > this.#maxHeaderBytes
        ? err({ kind: 'header-too-large', maxHeaderBytes: this.#maxHeaderBytes })
        : ok(undefined);
    }
    const headerLength = end + headerTerminator.byteLength;
    if (headerLength > this.#maxHeaderBytes) {
      return err({ kind: 'header-too-large', maxHeaderBytes: this.#maxHeaderBytes });
    }
    const header = this.#take(headerLength).toString('latin1');
    return parseContentLength(header, this.#maxMessageBytes);
  }

  /** Joins the buffered chunks into one, so a header can be searched without missing a split. */
  #compact(): Buffer {
    if (this.#chunks.length > 1) {
      this.#chunks = [Buffer.concat(this.#chunks, this.#buffered)];
    }
    return this.#chunks[0] ?? Buffer.alloc(0);
  }

  #take(length: number): Buffer {
    const all = this.#compact();
    const taken = all.subarray(0, length);
    const rest = all.subarray(length);
    this.#chunks = rest.byteLength > 0 ? [rest] : [];
    this.#buffered = rest.byteLength;
    return taken;
  }

  /** Feeds `chunk` and returns every body it completed, in order. */
  push(chunk: Uint8Array): Result<readonly string[], FramingError> {
    if (this.#failure !== undefined) {
      return err(this.#failure);
    }
    if (chunk.byteLength > 0) {
      this.#chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      this.#buffered += chunk.byteLength;
    }
    const bodies: string[] = [];
    for (;;) {
      if (this.#expectedLength === undefined) {
        const header = this.#readHeader();
        if (!header.ok) {
          this.#failure = header.error;
          this.#chunks = [];
          this.#buffered = 0;
          return header;
        }
        if (header.value === undefined) {
          return ok(bodies);
        }
        this.#expectedLength = header.value;
      }
      if (this.#buffered < this.#expectedLength) {
        return ok(bodies);
      }
      bodies.push(this.#decoder.decode(this.#take(this.#expectedLength)));
      this.#expectedLength = undefined;
    }
  }

  /** Bytes received but not yet returned as part of a body. */
  get bufferedBytes(): number {
    return this.#buffered;
  }
}

function parseContentLength(header: string, maxMessageBytes: number): Result<number, FramingError> {
  const fields = header
    .slice(0, -4)
    .split('\r\n')
    .map((line) => {
      const colon = line.indexOf(':');
      return colon === -1
        ? { name: line.trim().toLowerCase(), value: '' }
        : { name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() };
    });
  const field = fields.find(({ name }) => name === 'content-length');
  if (field === undefined) {
    return err({ kind: 'missing-content-length', header });
  }
  if (!decimalPattern.test(field.value)) {
    return err({ kind: 'invalid-content-length', value: field.value });
  }
  const length = Number(field.value);
  return length > maxMessageBytes
    ? err({ kind: 'message-too-large', length, maxMessageBytes })
    : ok(length);
}
