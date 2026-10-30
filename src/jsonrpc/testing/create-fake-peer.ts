import { PassThrough } from 'node:stream';

import { ContentLengthDecoder } from '../content-length-decoder.ts';
import { encodeMessage } from '../encode-message.ts';
import { JsonRpcConnection } from '../json-rpc-connection.ts';
import type { JsonRpcCloseReason, JsonRpcConnectionOptions } from '../json-rpc-connection.ts';
import type { JsonRpcMessage } from '../json-rpc-message.ts';

/** An in-memory peer: what the connection writes is decoded into `sent`; `send` feeds it bytes. */
export interface FakePeer {
  readonly connection: JsonRpcConnection;
  readonly sent: unknown[];
  readonly closes: JsonRpcCloseReason[];
  readonly send: (message: JsonRpcMessage) => void;
  readonly sendRaw: (bytes: string) => void;
  readonly endInput: () => void;
  readonly nextSent: () => Promise<unknown>;
  /** Closes the connection and destroys both streams. Safe to call twice. */
  readonly close: () => void;
}

/** Creates a {@link FakePeer} over a connection with in-memory streams. */
export function createFakePeer(options: Partial<JsonRpcConnectionOptions> = {}): FakePeer {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent: unknown[] = [];
  const closes: JsonRpcCloseReason[] = [];
  const waiters: ((message: unknown) => void)[] = [];
  let consumed = 0;
  const decoder = new ContentLengthDecoder();
  output.on('data', (chunk: Buffer) => {
    const decoded = decoder.push(chunk);
    const bodies = decoded.ok ? decoded.value : [];
    for (const body of bodies) {
      const message: unknown = JSON.parse(body);
      sent.push(message);
      const waiter = waiters.shift();
      if (waiter === undefined) {
        continue;
      }
      consumed += 1;
      waiter(message);
    }
  });
  const connection = new JsonRpcConnection({
    input,
    output,
    cancelMethod: '$/cancelRequest',
    onClose: (reason): void => {
      closes.push(reason);
    },
    ...options,
  });
  const peer: FakePeer = {
    connection,
    sent,
    closes,
    send: (message): void => {
      input.write(encodeMessage(message));
    },
    sendRaw: (bytes): void => {
      input.write(bytes);
    },
    endInput: (): void => {
      input.end();
    },
    close: (): void => {
      connection.close();
      input.destroy();
      output.destroy();
    },
    nextSent: async (): Promise<unknown> => {
      if (consumed < sent.length) {
        consumed += 1;
        return sent[consumed - 1];
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
  return peer;
}
