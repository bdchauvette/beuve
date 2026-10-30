import { stat } from 'node:fs/promises';

import { z } from 'zod';

import type { Logger } from '#x/log/create-logger.ts';
import { readServerSentEvents } from '#x/net/read-server-sent-events.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

import { createReadOnlySandbox } from './create-read-only-sandbox.ts';
import type { ReadOnlySandbox, SandboxLimits } from './create-read-only-sandbox.ts';
import { describeToolUse } from './describe-tool-use.ts';
import { jsonSchemaFrom } from './json-schema-from.ts';
import type {
  BaseModelRequest,
  LanguageModel,
  ModelCapabilities,
  ModelEffort,
  ModelError,
  ModelOutput,
  ModelRequest,
  ModelUsage,
  TextModelRequest,
  TextStreamEvent,
} from './language-model.ts';
import { openAiErrorFrom } from './open-ai-error-from.ts';
import { validateModelRequest } from './validate-model-request.ts';

export interface OpenAiCompatibleModelOptions {
  /** The API root that `/chat/completions` hangs off, e.g. `http://localhost:11434/v1`. */
  readonly baseUrl: string;
  readonly model: string;
  /** Sent as a bearer token when set; never logged. */
  readonly apiKey?: string;
  /** Read-only `read_file`, `grep` and `glob` over the worktree (ADR 0071). Off by default. */
  readonly tools?: boolean;
  /**
   * `native` sends `response_format: json_schema`; `prompted` puts the schema in the system
   * prompt; `auto` (the default) tries native and falls back to prompted when the server rejects
   * the request (400 or 422). Every answer is validated with zod either way.
   */
  readonly structuredOutput?: 'auto' | 'native' | 'prompted';
  readonly contextWindowTokens?: number;
  /** Sent as `max_tokens` when set. */
  readonly maxOutputTokens?: number;
  /**
   * Sent as `reasoning_effort` (`xhigh` and `max` as `high`). Not every server knows the field,
   * so nothing is sent unless this is set; a request's own effort then overrides it.
   */
  readonly effort?: ModelEffort;
  /** Model turns (requests) per run when tools are on. Defaults to 24. */
  readonly maxTurns?: number;
  /** Fail with `output-too-large` past this many bytes of one response. Defaults to 32 MiB. */
  readonly maxResponseBytes?: number;
  readonly sandbox?: SandboxLimits;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly logger?: Logger;
}

const defaultMaxTurns = 24;
const trailingSlashes = /\/+$/u;
const fencedJson = /^```(?:json)?\s*\n([\s\S]*?)\n```$/u;
const defaultMaxResponseBytes = 32 * 1024 * 1024;
const maxToolCallsPerTurn = 16;

/**
 * A {@link LanguageModel} on any server that speaks OpenAI's `/v1/chat/completions` with
 * streaming (Ollama, llama.cpp, vLLM, LM Studio, a hosted gateway; ADR 0071), with `fetch` and
 * server-sent events and no SDK. Tools are off by default: the model answers from the prompt
 * alone (the diff, the selections and the ImpactGate summary). With `tools`, it gets the
 * read-only sandbox of {@link createReadOnlySandbox} and runs up to `maxTurns` requests. `run`
 * asks for the JSON Schema with `response_format` when the server supports it, else in the
 * prompt, and validates the answer with zod. HTTP failures map to {@link ModelError}s.
 */
export function createOpenAiCompatibleModel(options: OpenAiCompatibleModelOptions): LanguageModel {
  const capabilities: ModelCapabilities = {
    tools: options.tools === true,
    structuredOutput: options.structuredOutput === 'prompted' ? 'prompted' : 'native',
    contextWindowTokens: options.contextWindowTokens,
    ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }),
    streaming: true,
  };
  return {
    capabilities,
    run: async <T>(request: ModelRequest<T>): Promise<Result<ModelOutput<T>, ModelError>> =>
      runStructured(request, options),
    runText: async (
      request: TextModelRequest,
    ): Promise<Result<ModelOutput<string>, ModelError>> => {
      const answer = await runChat(request, options, {
        ...(request.onText !== undefined && { onText: request.onText }),
      });
      if (!answer.ok) {
        return answer;
      }
      if (answer.value.value.trim() === '') {
        return err({ kind: 'invalid-output', reason: 'the answer has no text' });
      }
      logFinished(answer.value, options);
      return answer;
    },
  };
}

async function runStructured<T>(
  request: ModelRequest<T>,
  options: OpenAiCompatibleModelOptions,
): Promise<Result<ModelOutput<T>, ModelError>> {
  const schema = jsonSchemaFrom(request.outputSchema);
  if (schema === undefined) {
    return err({ kind: 'invalid-request', reason: 'the output schema has no JSON Schema form' });
  }
  const preferred = options.structuredOutput ?? 'auto';
  let answer = await runChat(request, options, {
    schema,
    format: preferred === 'prompted' ? 'prompted' : 'native',
  });
  if (
    preferred === 'auto' &&
    !answer.ok &&
    answer.error.kind === 'model-failed' &&
    (answer.error.status === 400 || answer.error.status === 422)
  ) {
    options.logger?.info('openai-compatible: json_schema refused; asking in the prompt', {
      status: answer.error.status,
    });
    answer = await runChat(request, options, { schema, format: 'prompted' });
  }
  if (!answer.ok) {
    return answer;
  }
  const json = jsonFrom(answer.value.value);
  if (json === undefined) {
    return err({ kind: 'invalid-output', reason: 'the answer is not JSON' });
  }
  const parsed = request.outputSchema.safeParse(json);
  if (!parsed.success) {
    options.logger?.info('openai-compatible: output does not match the schema', {
      duration: answer.value.duration,
    });
    return err({ kind: 'invalid-output', reason: z.prettifyError(parsed.error) });
  }
  logFinished(answer.value, options);
  return ok({ ...answer.value, value: parsed.data });
}

interface OutputMode {
  readonly schema?: Record<string, unknown>;
  readonly format?: 'native' | 'prompted';
  readonly onText?: (event: TextStreamEvent) => void;
}

interface WireToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** One response, streamed or not, read to its end. */
interface Turn {
  readonly content: string;
  readonly toolCalls: readonly WireToolCall[];
  readonly model: string | undefined;
  readonly usage: ModelUsage | undefined;
}

async function runChat(
  request: BaseModelRequest,
  options: OpenAiCompatibleModelOptions,
  mode: OutputMode,
): Promise<Result<ModelOutput<string>, ModelError>> {
  const invalid = validateModelRequest(
    request,
    mode.schema === undefined ? 0 : JSON.stringify(mode.schema).length,
  );
  if (invalid !== undefined) {
    return err(invalid);
  }
  if (request.signal?.aborted === true) {
    return err({ kind: 'cancelled' });
  }
  const sandbox =
    options.tools === true ? createReadOnlySandbox(request.cwd, options.sandbox) : undefined;
  if (sandbox !== undefined && !(await isDirectory(request.cwd))) {
    return err({ kind: 'invalid-request', reason: 'cwd is not a directory' });
  }
  const deadline = timeoutSignal(request.timeout);
  const signal =
    request.signal === undefined ? deadline : AbortSignal.any([request.signal, deadline]);
  const stopwatch = new Stopwatch();
  options.logger?.debug('openai-compatible: starting', {
    model: request.model ?? options.model,
    tools: sandbox !== undefined,
    messages: request.messages.length,
  });
  const run = await converse(request, options, mode, sandbox, signal);
  if (signal.aborted) {
    return signal.reason === deadline.reason
      ? err({ kind: 'timeout', timeout: request.timeout })
      : err({ kind: 'cancelled' });
  }
  if (!run.ok) {
    options.logger?.info('openai-compatible: run failed', {
      duration: stopwatch.elapsed(),
      error: run.error.kind,
    });
    return run;
  }
  return ok({ ...run.value, duration: stopwatch.elapsed() });
}

async function converse(
  request: BaseModelRequest,
  options: OpenAiCompatibleModelOptions,
  mode: OutputMode,
  sandbox: ReadOnlySandbox | undefined,
  signal: AbortSignal,
): Promise<Result<Omit<ModelOutput<string>, 'duration'>, ModelError>> {
  /** A message of the chat completions wire format. */
  type WireMessage =
    | { readonly role: 'system' | 'user'; readonly content: string }
    | {
        readonly role: 'assistant';
        readonly content: string | null;
        readonly tool_calls?: readonly WireToolCall[];
      }
    | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };
  const model = request.model ?? options.model;
  const effort = options.effort === undefined ? undefined : (request.effort ?? options.effort);
  const system =
    mode.schema !== undefined && mode.format === 'prompted'
      ? `${request.system}\n\n${promptedSchemaInstructions(mode.schema)}`
      : request.system;
  const wire: WireMessage[] = [
    { role: 'system', content: system },
    ...request.messages.map(({ role, content }): WireMessage => ({ role, content })),
  ];
  const maxTurns = sandbox === undefined ? 1 : (options.maxTurns ?? defaultMaxTurns);
  let usage: ModelUsage | undefined;
  let reported: string | undefined;
  let denied = 0;
  const streamed = { hasText: false };
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (streamed.hasText) {
      streamed.hasText = false;
      mode.onText?.({ kind: 'reset' });
    }
    if (turn === 1) {
      request.onProgress?.({ kind: 'started', model });
    }
    const body = {
      model,
      messages: wire,
      stream: true,
      ...(sandbox !== undefined && { tools: sandbox.definitions, tool_choice: 'auto' }),
      ...(mode.schema !== undefined &&
        mode.format === 'native' && {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'answer', schema: mode.schema, strict: false },
          },
        }),
      ...(effort !== undefined && {
        reasoning_effort: effort === 'low' || effort === 'medium' ? effort : 'high',
      }),
      ...(options.maxOutputTokens !== undefined && { max_tokens: options.maxOutputTokens }),
    };
    const answered = await requestTurn(body, options, signal, {
      onText: (text) => {
        streamed.hasText = true;
        mode.onText?.({ kind: 'append', text });
      },
      onProgress: request.onProgress,
    });
    if (!answered.ok) {
      return answered;
    }
    const { value } = answered;
    reported = value.model ?? reported;
    usage = sumUsage(usage, value.usage);
    if (sandbox === undefined || value.toolCalls.length === 0) {
      return ok({
        value: value.content,
        model: reported ?? model,
        turns: turn,
        costUsd: undefined,
        deniedToolUses: denied,
        ...(usage !== undefined && { usage }),
      });
    }
    wire.push({
      role: 'assistant',
      // eslint-disable-next-line unicorn/no-null -- the wire format's "no text" is null.
      content: value.content === '' ? null : value.content,
      tool_calls: value.toolCalls,
    });
    for (const [index, call] of value.toolCalls.entries()) {
      if (index >= maxToolCallsPerTurn) {
        denied += 1;
        wire.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'refused: too many calls at once',
        });
        continue;
      }
      const name = call.function.name;
      request.onProgress?.({
        kind: 'tool-start',
        id: call.id,
        tool: name,
        description: describeToolUse(name, parseArguments(call.function.arguments), request.cwd),
      });
      const result = await sandbox.run(name, call.function.arguments);
      denied += result.denied ? 1 : 0;
      request.onProgress?.({ kind: 'tool-end', id: call.id, tool: name, ok: !result.denied });
      wire.push({ role: 'tool', tool_call_id: call.id, content: result.output });
    }
  }
  return err({
    kind: 'model-failed',
    reason: 'max-turns',
    message: `The model was still calling tools after ${String(maxTurns)} turns.`,
  });
}

interface TurnListeners {
  readonly onText: (text: string) => void;
  readonly onProgress: BaseModelRequest['onProgress'];
}

async function requestTurn(
  body: Record<string, unknown>,
  options: OpenAiCompatibleModelOptions,
  signal: AbortSignal,
  listeners: TurnListeners,
): Promise<Result<Turn, ModelError>> {
  const url = `${options.baseUrl.replace(trailingSlashes, '')}/chat/completions`;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream, application/json',
        ...(options.apiKey !== undefined &&
          options.apiKey !== '' && {
            authorization: `Bearer ${options.apiKey}`,
          }),
      },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
  } catch (error: unknown) {
    return err(unreachable(options.baseUrl, error, signal));
  }
  if (!response.ok) {
    const text = await textOf(response);
    return err(openAiErrorFrom(response.status, text.slice(0, 4000), response.headers));
  }
  const maxBytes = options.maxResponseBytes ?? defaultMaxResponseBytes;
  try {
    const type = response.headers.get('content-type') ?? '';
    return type.includes('text/event-stream')
      ? await readStream(response, maxBytes, listeners)
      : await readWhole(response, maxBytes, listeners);
  } catch (error: unknown) {
    return error instanceof RangeError
      ? err({ kind: 'output-too-large', maxBytes })
      : err(unreachable(options.baseUrl, error, signal));
  }
}

const toolCallDelta = z.looseObject({
  index: z.number().int().min(0).max(255).optional(),
  id: z.string().optional(),
  function: z
    .looseObject({ name: z.string().optional(), arguments: z.string().optional() })
    .optional(),
});

const usageShape = z
  .looseObject({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    prompt_tokens_details: z.looseObject({ cached_tokens: z.number().nullish() }).nullish(),
  })
  .nullish();

const toolCallDeltas = z.array(toolCallDelta).nullish();

const deltaShape = z.looseObject({
  content: z.string().nullish(),
  reasoning_content: z.string().nullish(),
  reasoning: z.string().nullish(),
  tool_calls: toolCallDeltas,
});

const chunkChoice = z.looseObject({ delta: deltaShape.optional() });

const chunkShape = z.looseObject({
  model: z.string().optional(),
  choices: z.array(chunkChoice).optional(),
  usage: usageShape,
});

const completionMessage = z.looseObject({
  content: z.string().nullish(),
  tool_calls: toolCallDeltas,
});

const completionShape = z.looseObject({
  model: z.string().optional(),
  choices: z.array(z.looseObject({ message: completionMessage })),
  usage: usageShape,
});

async function readStream(
  response: Response,
  maxBytes: number,
  listeners: TurnListeners,
): Promise<Result<Turn, ModelError>> {
  if (response.body === null) {
    return err({ kind: 'invalid-output', reason: 'the response has no body' });
  }
  let content = '';
  let model: string | undefined;
  let usage: ModelUsage | undefined;
  let isThinking = false;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  for await (const data of readServerSentEvents(response.body, maxBytes)) {
    if (data.trim() === '[DONE]') {
      break;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const chunk = chunkShape.safeParse(json);
    if (!chunk.success) {
      continue;
    }
    model = chunk.data.model ?? model;
    usage = usageFrom(chunk.data.usage) ?? usage;
    const choices = chunk.data.choices ?? [];
    for (const choice of choices) {
      const delta = choice.delta;
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (reasoning !== undefined && reasoning !== null && reasoning !== '' && !isThinking) {
        isThinking = true;
        listeners.onProgress?.({ kind: 'thinking' });
      }
      const text = delta?.content;
      if (text !== undefined && text !== null && text !== '') {
        if (content === '') {
          listeners.onProgress?.({ kind: 'text-start' });
        }
        content += text;
        listeners.onText(text);
      }
      const deltas = delta?.tool_calls ?? [];
      for (const [position, call] of deltas.entries()) {
        const index = call.index ?? position;
        const current = calls.get(index) ?? { id: '', name: '', arguments: '' };
        calls.set(index, {
          id: call.id ?? current.id,
          name: current.name + (call.function?.name ?? ''),
          arguments: current.arguments + (call.function?.arguments ?? ''),
        });
      }
    }
  }
  if (content !== '') {
    listeners.onProgress?.({ kind: 'text-end' });
  }
  return ok({ content, toolCalls: toolCallsFrom([...calls]), model, usage });
}

/** A server that ignored `stream: true` and answered with one JSON completion. */
async function readWhole(
  response: Response,
  maxBytes: number,
  listeners: TurnListeners,
): Promise<Result<Turn, ModelError>> {
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    return err({ kind: 'output-too-large', maxBytes });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({ kind: 'invalid-output', reason: 'the response is not JSON' });
  }
  const parsed = completionShape.safeParse(json);
  const message = parsed.success ? parsed.data.choices[0]?.message : undefined;
  if (message === undefined || !parsed.success) {
    return err({ kind: 'invalid-output', reason: 'the response has no choice' });
  }
  const content = message.content ?? '';
  if (content !== '') {
    listeners.onProgress?.({ kind: 'text-start' });
    listeners.onText(content);
    listeners.onProgress?.({ kind: 'text-end' });
  }
  const calls = (message.tool_calls ?? []).map(
    (call, index) =>
      [
        call.index ?? index,
        {
          id: call.id ?? '',
          name: call.function?.name ?? '',
          arguments: call.function?.arguments ?? '',
        },
      ] as const,
  );
  return ok({
    content,
    toolCalls: toolCallsFrom(calls),
    model: parsed.data.model,
    usage: usageFrom(parsed.data.usage),
  });
}

function toolCallsFrom(
  calls: readonly (readonly [number, { id: string; name: string; arguments: string }])[],
): WireToolCall[] {
  return calls
    .toSorted(([left], [right]) => left - right)
    .filter(([, call]) => call.name !== '')
    .map(([index, call]) => ({
      id: call.id === '' ? `call_${String(index)}` : call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
}

function usageFrom(usage: z.infer<typeof usageShape>): ModelUsage | undefined {
  if (usage === undefined || usage === null) {
    return undefined;
  }
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    cacheReadInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    cacheCreationInputTokens: 0,
  };
}

function sumUsage(
  total: ModelUsage | undefined,
  next: ModelUsage | undefined,
): ModelUsage | undefined {
  if (total === undefined || next === undefined) {
    return next ?? total;
  }
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cacheReadInputTokens: total.cacheReadInputTokens + next.cacheReadInputTokens,
    cacheCreationInputTokens: total.cacheCreationInputTokens + next.cacheCreationInputTokens,
  };
}

function unreachable(baseUrl: string, error: unknown, signal: AbortSignal): ModelError {
  if (signal.aborted) {
    return { kind: 'cancelled' };
  }
  const cause =
    Error.isError(error) && Error.isError(error.cause) ? error.cause.message : String(error);
  const origin = URL.parse(baseUrl)?.origin ?? baseUrl;
  return {
    kind: 'model-failed',
    reason: 'unreachable',
    message: `Could not reach ${origin} (${cause}). Is the server running?`,
  };
}

function promptedSchemaInstructions(schema: Record<string, unknown>): string {
  return [
    'Answer with one JSON object and nothing else (no prose, no code fence). It must match this',
    'JSON Schema:',
    '',
    JSON.stringify(schema),
  ].join('\n');
}

/** The JSON in an answer: the whole text, or inside a code fence, or its outermost object. */
function jsonFrom(text: string): unknown {
  const trimmed = text.trim();
  const fenced = fencedJson.exec(trimmed)?.[1];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  const candidates = [
    trimmed,
    ...(fenced === undefined ? [] : [fenced]),
    ...(first !== -1 && last > first ? [trimmed.slice(first, last + 1)] : []),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // The next candidate.
    }
  }
  return undefined;
}

async function textOf(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function logFinished(output: ModelOutput<unknown>, options: OpenAiCompatibleModelOptions): void {
  options.logger?.info('openai-compatible: run finished', {
    duration: output.duration,
    model: output.model,
    turns: output.turns,
    deniedToolUses: output.deniedToolUses,
  });
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await stat(directory);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
