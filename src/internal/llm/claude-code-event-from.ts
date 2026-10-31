import { z } from 'zod';

import type { ModelUsage } from './language-model.ts';

/**
 * The parts of one `--output-format=stream-json` line the adapter uses. Claude Code emits many
 * more event types (`system/status`, `user` tool results, other `stream_event`s, …); they are
 * `other`. `message-start` and `text-delta` come from the top-level agent's `stream_event` lines,
 * which carry Messages API stream events (text deltas only with `--include-partial-messages`).
 */
export type ClaudeCodeEvent =
  | {
      readonly kind: 'init';
      readonly model: string | undefined;
      readonly version: string | undefined;
      readonly tools: readonly string[];
      /** Where the credential came from, e.g. `ANTHROPIC_API_KEY`, `none` or `oauth`. */
      readonly apiKeySource: string | undefined;
    }
  | { readonly kind: 'tool-use'; readonly uses: readonly ClaudeCodeToolUse[] }
  /** The top-level agent's tool results, by the id of the use each answers. */
  | {
      readonly kind: 'tool-result';
      readonly results: readonly { readonly id: string; readonly isError: boolean }[];
    }
  /** A content block of the top-level agent's message opened (with partial messages only). */
  | { readonly kind: 'block-start'; readonly index: number; readonly blockType: string }
  | { readonly kind: 'block-stop'; readonly index: number }
  | {
      readonly kind: 'rate-limit';
      readonly status: string;
      /** Epoch seconds, as Claude Code reports it. */
      readonly resetsAt: number | undefined;
    }
  | { readonly kind: 'message-start' }
  | { readonly kind: 'text-delta'; readonly text: string }
  /** A refusal was retried on `model`; what streamed before it was retracted. */
  | { readonly kind: 'refusal-fallback'; readonly model: string }
  | { readonly kind: 'result'; readonly result: ClaudeCodeResult }
  | { readonly kind: 'other' }
  | { readonly kind: 'invalid'; readonly reason: string };

/** One tool call of an assistant message. `input` is the model's, untrusted and unvalidated. */
export interface ClaudeCodeToolUse {
  readonly id: string;
  readonly tool: string;
  readonly input: unknown;
}

/** The final `{"type":"result"}` event of a run. */
export interface ClaudeCodeResult {
  /** `success`, or an `error_*` subtype such as `error_max_budget_usd`. */
  readonly subtype: string;
  readonly isError: boolean;
  /** The final text; with `--json-schema`, the structured output serialized. */
  readonly text: string | undefined;
  readonly hasStructuredOutput: boolean;
  readonly structuredOutput: unknown;
  readonly apiErrorStatus: number | undefined;
  readonly turns: number | undefined;
  readonly costUsd: number | undefined;
  readonly duration: Temporal.Duration | undefined;
  readonly deniedToolUses: number;
  readonly usage: ModelUsage | undefined;
}

const line = z.looseObject({ type: z.string(), subtype: z.string().optional() });

const init = z.looseObject({
  model: z.string().optional(),
  claude_code_version: z.string().optional(),
  tools: z.array(z.string()).optional(),
  apiKeySource: z.string().optional(),
});

const refusalFallback = z.looseObject({ fallback_model: z.string() });

const contentBlock = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
});

const assistant = z.looseObject({
  parent_tool_use_id: z.string().nullish(),
  message: z.looseObject({ content: z.array(contentBlock).optional() }),
});

const toolResultBlock = z.looseObject({
  type: z.string(),
  tool_use_id: z.string().optional(),
  is_error: z.boolean().optional(),
});

const toolResults = z.array(toolResultBlock);

const userContent = z.union([z.string(), toolResults]).optional();

const user = z.looseObject({
  parent_tool_use_id: z.string().nullish(),
  message: z.looseObject({ content: userContent }),
});

const streamDelta = z.looseObject({ type: z.string().optional(), text: z.string().optional() });

const apiStreamEvent = z.looseObject({
  type: z.string(),
  index: z.number().optional(),
  delta: streamDelta.optional(),
  content_block: z.looseObject({ type: z.string() }).optional(),
});

const streamEvent = z.looseObject({
  parent_tool_use_id: z.string().nullish(),
  event: apiStreamEvent,
});

const rateLimit = z.looseObject({
  rate_limit_info: z.looseObject({ status: z.string(), resetsAt: z.number().optional() }),
});

const result = z.looseObject({
  subtype: z.string(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  api_error_status: z.number().nullish(),
  num_turns: z.number().optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  permission_denials: z.array(z.unknown()).optional(),
  usage: z
    .looseObject({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_read_input_tokens: z.number().nullish(),
      cache_creation_input_tokens: z.number().nullish(),
    })
    .optional(),
});

/**
 * Reads one Claude Code stream-json message, already parsed: a line of `claude --print` output or
 * a message the Agent SDK's `query()` yields, which are the same objects. Never throws.
 */
export function claudeCodeEventFrom(json: unknown): ClaudeCodeEvent {
  const envelope = line.safeParse(json);
  if (!envelope.success) {
    return { kind: 'invalid', reason: 'not a stream-json event' };
  }
  const { type, subtype } = envelope.data;
  if (type === 'system' && subtype === 'init') {
    return initFrom(json);
  }
  if (type === 'system' && subtype === 'model_refusal_fallback') {
    const parsed = refusalFallback.safeParse(json);
    if (parsed.success) {
      return { kind: 'refusal-fallback', model: parsed.data.fallback_model };
    }
    return { kind: 'other' };
  }
  switch (type) {
    case 'assistant': {
      return toolUseFrom(json);
    }
    case 'user': {
      return toolResultFrom(json);
    }
    case 'stream_event': {
      return streamEventFrom(json);
    }
    case 'rate_limit_event': {
      return rateLimitFrom(json);
    }
    case 'result': {
      return resultFrom(json);
    }
    default: {
      return { kind: 'other' };
    }
  }
}

function initFrom(json: unknown): ClaudeCodeEvent {
  const parsed = init.safeParse(json);
  if (!parsed.success) {
    return { kind: 'invalid', reason: 'malformed init event' };
  }
  return {
    kind: 'init',
    model: parsed.data.model,
    version: parsed.data.claude_code_version,
    tools: parsed.data.tools ?? [],
    apiKeySource: parsed.data.apiKeySource,
  };
}

function toolUseFrom(json: unknown): ClaudeCodeEvent {
  const parsed = assistant.safeParse(json);
  if (!parsed.success || (parsed.data.parent_tool_use_id ?? undefined) !== undefined) {
    return { kind: 'other' };
  }
  const uses = (parsed.data.message.content ?? [])
    .filter((block) => block.type === 'tool_use')
    .map((block, index): ClaudeCodeToolUse => {
      return {
        id: block.id ?? `tool-${String(index)}`,
        tool: block.name ?? 'unknown',
        input: block.input,
      };
    });
  if (uses.length === 0) {
    return { kind: 'other' };
  }
  return { kind: 'tool-use', uses };
}

function toolResultFrom(json: unknown): ClaudeCodeEvent {
  const parsed = user.safeParse(json);
  if (!parsed.success || (parsed.data.parent_tool_use_id ?? undefined) !== undefined) {
    return { kind: 'other' };
  }
  const { content } = parsed.data.message;
  if (!Array.isArray(content)) {
    return { kind: 'other' };
  }
  const results = content
    .filter((block) => block.type === 'tool_result' && block.tool_use_id !== undefined)
    .map((block) => {
      return { id: block.tool_use_id ?? '', isError: block.is_error === true };
    });
  if (results.length === 0) {
    return { kind: 'other' };
  }
  return { kind: 'tool-result', results };
}

function streamEventFrom(json: unknown): ClaudeCodeEvent {
  const parsed = streamEvent.safeParse(json);
  if (!parsed.success || (parsed.data.parent_tool_use_id ?? undefined) !== undefined) {
    return { kind: 'other' };
  }
  const { event } = parsed.data;
  if (event.type === 'message_start') {
    return { kind: 'message-start' };
  }
  if (event.type === 'content_block_start' && event.index !== undefined) {
    return {
      kind: 'block-start',
      index: event.index,
      blockType: event.content_block?.type ?? 'unknown',
    };
  }
  if (event.type === 'content_block_stop' && event.index !== undefined) {
    return { kind: 'block-stop', index: event.index };
  }
  if (event.delta?.type !== 'text_delta' || event.type !== 'content_block_delta') {
    return { kind: 'other' };
  }
  const { text } = event.delta;
  if (text !== undefined && text !== '') {
    return { kind: 'text-delta', text };
  }
  return { kind: 'other' };
}

function rateLimitFrom(json: unknown): ClaudeCodeEvent {
  const parsed = rateLimit.safeParse(json);
  if (!parsed.success) {
    return { kind: 'other' };
  }
  const info = parsed.data.rate_limit_info;
  return { kind: 'rate-limit', status: info.status, resetsAt: info.resetsAt };
}

function resultFrom(json: unknown): ClaudeCodeEvent {
  const parsed = result.safeParse(json);
  if (!parsed.success) {
    return { kind: 'invalid', reason: 'malformed result event' };
  }
  const data = parsed.data;
  const hasStructuredOutput = 'structured_output' in data && data['structured_output'] !== null;
  return {
    kind: 'result',
    result: {
      subtype: data.subtype,
      isError: data.is_error ?? data.subtype !== 'success',
      text: data.result,
      hasStructuredOutput,
      structuredOutput: structuredOutputOf(data),
      apiErrorStatus: data.api_error_status ?? undefined,
      turns: data.num_turns,
      costUsd: data.total_cost_usd,
      duration: durationOf(data.duration_ms),
      deniedToolUses: data.permission_denials?.length ?? 0,
      usage: usageOf(data.usage),
    },
  };
}

type ResultData = z.infer<typeof result>;

function structuredOutputOf(data: ResultData): unknown {
  if ('structured_output' in data && data['structured_output'] !== null) {
    return data['structured_output'];
  }
  return undefined;
}

function durationOf(milliseconds: number | undefined): Temporal.Duration | undefined {
  if (milliseconds === undefined) {
    return undefined;
  }
  return Temporal.Duration.from({ milliseconds: Math.round(milliseconds) });
}

function usageOf(usage: ResultData['usage']): ModelUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}
