/* eslint-disable unicorn/no-null -- the Messages API wire format spells absent fields null. */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/** A content block of a scripted reply. */
export type FakeBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    };

/** One scripted answer to a `POST /v1/messages`. */
export type FakeReply =
  | {
      readonly kind: 'message';
      readonly content: readonly FakeBlock[];
      readonly stopReason: 'end_turn' | 'tool_use' | 'refusal';
      readonly model?: string;
    }
  | {
      readonly kind: 'error';
      readonly status: number;
      readonly type: string;
      readonly message: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  /** Starts a message, streams `text`, then never finishes. */
  | { readonly kind: 'hang'; readonly text: string };

/** A request the fake received, with its JSON body parsed. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: Record<string, unknown> | undefined;
}

/** A local stand-in for the Messages API that Claude Code is pointed at with `ANTHROPIC_BASE_URL`. */
export interface FakeMessagesApi {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  /** Queues replies for the next `POST /v1/messages` requests, in order. */
  readonly reply: (...replies: readonly FakeReply[]) => void;
  readonly close: () => void;
}

/**
 * Starts a fake Messages API on 127.0.0.1 that answers `POST /v1/messages` from a queue of
 * scripted replies, as server-sent events in the API's streaming shape (enough of it for Claude
 * Code), and every other request with a 404. An empty queue answers with a non-retryable 500.
 * Every request is recorded, so tests can check what Claude Code sent.
 */
export async function startFakeMessagesApi(): Promise<FakeMessagesApi> {
  const requests: RecordedRequest[] = [];
  const queue: FakeReply[] = [];
  let messageCount = 0;
  const server = createServer((incoming, response) => {
    let raw = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk: string) => {
      raw += chunk;
    });
    incoming.on('end', () => {
      let body: Record<string, unknown> | undefined;
      if (raw !== '') {
        body = JSON.parse(raw) as Record<string, unknown>;
      }
      requests.push({
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        headers: incoming.headers,
        body,
      });
      if (incoming.method !== 'POST' || !(incoming.url ?? '').startsWith('/v1/messages?')) {
        sendError(response, 404, { type: 'not_found_error', message: 'not found', headers: {} });
        return;
      }
      messageCount += 1;
      answer(response, queue.shift(), `msg_fake${String(messageCount)}`);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = portOf(server.address());
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    reply: (...replies): void => {
      queue.push(...replies);
    },
    close: (): void => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function answer(response: ServerResponse, reply: FakeReply | undefined, id: string): void {
  if (reply === undefined) {
    sendError(response, 500, {
      type: 'api_error',
      message: 'the fake has no reply queued',
      headers: {},
    });
    return;
  }
  switch (reply.kind) {
    case 'error': {
      sendError(response, reply.status, {
        type: reply.type,
        message: reply.message,
        headers: reply.headers ?? {},
      });
      return;
    }
    case 'hang': {
      startEvents(response);
      for (const event of [
        messageStart({ id, model: 'claude-opus-5-5' }),
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } },
      ]) {
        writeEvent(response, event);
      }
      return;
    }
    case 'message': {
      startEvents(response);
      for (const event of messageEvents(id, reply)) {
        writeEvent(response, event);
      }
      response.end();
      return;
    }
  }
}

function messageEvents(
  id: string,
  reply: Extract<FakeReply, { kind: 'message' }>,
): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [
    messageStart({ id, model: reply.model ?? 'claude-opus-5-5' }),
  ];
  for (const [index, block] of reply.content.entries()) {
    if (block.type === 'text') {
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
      );
    } else {
      events.push(
        {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
        },
      );
    }
    events.push({ type: 'content_block_stop', index });
  }
  events.push(
    {
      type: 'message_delta',
      delta: {
        stop_reason: reply.stopReason,
        stop_sequence: null,
        stop_details: stopDetailsOf(reply.stopReason),
      },
      usage: { output_tokens: 20 },
    },
    { type: 'message_stop' },
  );
  return events;
}

/** The id and model of the message a reply starts. */
interface MessageIdentity {
  readonly id: string;
  readonly model: string;
}

function messageStart({ id, model }: MessageIdentity): Record<string, unknown> {
  return {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  };
}

function startEvents(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_fake' });
}

function writeEvent(response: ServerResponse, event: Record<string, unknown>): void {
  response.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** An API error's type, message and extra response headers. */
interface ApiError {
  readonly type: string;
  readonly message: string;
  readonly headers: Readonly<Record<string, string>>;
}

function sendError(
  response: ServerResponse,
  status: number,
  { type, message, headers }: ApiError,
): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'request-id': 'req_fake',
    'x-should-retry': 'false',
    ...headers,
  });
  response.end(JSON.stringify({ type: 'error', error: { type, message } }));
}

function portOf(address: ReturnType<Server['address']>): number {
  if (typeof address === 'object' && address !== null) {
    return address.port;
  }
  return 0;
}

function stopDetailsOf(stopReason: string): unknown {
  if (stopReason === 'refusal') {
    return { type: 'refusal', category: 'cyber', explanation: 'scripted refusal' };
  }
  return null;
}
