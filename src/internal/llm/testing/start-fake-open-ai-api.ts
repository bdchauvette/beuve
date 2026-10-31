/* eslint-disable unicorn/no-null -- the chat completions wire format spells absent fields null. */
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';

/** One scripted answer to a `POST /chat/completions`. */
export type FakeOpenAiReply =
  | {
      readonly kind: 'stream';
      /** Text deltas, in order. */
      readonly content?: readonly string[];
      /** Streamed as `reasoning_content` before the text. */
      readonly reasoning?: string;
      readonly toolCalls?: readonly {
        readonly id: string;
        readonly name: string;
        readonly arguments: string;
      }[];
      readonly model?: string;
    }
  /** A plain JSON completion, as a server that ignores `stream: true` sends. */
  | { readonly kind: 'json'; readonly content: string }
  | {
      readonly kind: 'error';
      readonly status: number;
      readonly body: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  /** Starts the stream and never finishes it. */
  | { readonly kind: 'hang' };

/** A request the fake received, with its JSON body parsed. */
export interface FakeOpenAiRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown> | undefined;
}

export interface FakeOpenAiOptions {
  /** Answers `GET /models`; 404 when omitted. */
  readonly models?: readonly string[];
  /** Answers 400 to any request with a `response_format`, like a server without JSON Schema. */
  readonly rejectsResponseFormat?: boolean;
}

/** A local stand-in for an OpenAI-compatible server (Ollama, vLLM, …). */
export interface FakeOpenAiApi {
  /** Ends in `/v1`, as the adapter's `baseUrl` does. */
  readonly baseUrl: string;
  readonly requests: readonly FakeOpenAiRequest[];
  readonly reply: (...replies: readonly FakeOpenAiReply[]) => void;
  readonly close: () => void;
}

/**
 * Starts a fake OpenAI-compatible API on 127.0.0.1 (ADR 0071): `POST /v1/chat/completions`
 * answers from a queue of scripted replies as server-sent events in the chat completions chunk
 * shape (tool call arguments split across chunks, usage in the last chunk, then `[DONE]`), and
 * an empty queue with a 500. Every request is recorded.
 */
export async function startFakeOpenAiApi(options: FakeOpenAiOptions = {}): Promise<FakeOpenAiApi> {
  const requests: FakeOpenAiRequest[] = [];
  const queue: FakeOpenAiReply[] = [];
  const server = createServer((incoming, response) => {
    void (async (): Promise<void> => {
      const body = await readBody(incoming);
      requests.push({
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        authorization: incoming.headers.authorization,
        body,
      });
      if (incoming.method === 'GET' && incoming.url === '/v1/models') {
        if (options.models === undefined) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end('{"error":"not found"}');
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            object: 'list',
            data: options.models.map((id) => {
              return { id, object: 'model' };
            }),
          }),
        );
        return;
      }
      if (incoming.method !== 'POST' || incoming.url !== '/v1/chat/completions') {
        response.writeHead(404);
        response.end();
        return;
      }
      if (options.rejectsResponseFormat === true && body?.['response_format'] !== undefined) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end('{"error":{"message":"response_format is not supported"}}');
        return;
      }
      const reply = queue.shift();
      if (reply === undefined) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end('{"error":{"message":"no scripted reply"}}');
        return;
      }
      const model = typeof body?.['model'] === 'string' ? body['model'] : 'fake';
      switch (reply.kind) {
        case 'error': {
          response.writeHead(reply.status, {
            'content-type': 'application/json',
            ...reply.headers,
          });
          response.end(reply.body);
          return;
        }
        case 'json': {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              model,
              choices: [{ index: 0, message: { role: 'assistant', content: reply.content } }],
              usage: { prompt_tokens: 3, completion_tokens: 1 },
            }),
          );
          return;
        }
        case 'hang': {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(chunk(model, { role: 'assistant', content: '' }));
          return;
        }
        case 'stream': {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          writeStream(response, reply, reply.model ?? model);
          return;
        }
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
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

function writeStream(
  response: { write: (text: string) => unknown; end: () => unknown },
  reply: Extract<FakeOpenAiReply, { kind: 'stream' }>,
  model: string,
): void {
  response.write(chunk(model, { role: 'assistant', content: '' }));
  if (reply.reasoning !== undefined) {
    response.write(chunk(model, { reasoning_content: reply.reasoning }));
  }
  const texts = reply.content ?? [];
  for (const text of texts) {
    response.write(chunk(model, { content: text }));
  }
  const calls = reply.toolCalls ?? [];
  for (const [index, call] of calls.entries()) {
    const half = Math.floor(call.arguments.length / 2);
    response.write(
      chunk(model, {
        tool_calls: [
          {
            index,
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments.slice(0, half) },
          },
        ],
      }),
    );
    response.write(
      chunk(model, {
        tool_calls: [{ index, function: { arguments: call.arguments.slice(half) } }],
      }),
    );
  }
  response.write(
    `data: ${JSON.stringify({
      model,
      choices: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    })}\n\n`,
  );
  response.write('data: [DONE]\n\n');
  response.end();
}

function chunk(model: string, delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta, finish_reason: null }],
  })}\n\n`;
}

async function readBody(incoming: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = [];
  for await (const part of incoming) {
    parts.push(part as Buffer);
  }
  const text = Buffer.concat(parts).toString('utf8');
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
