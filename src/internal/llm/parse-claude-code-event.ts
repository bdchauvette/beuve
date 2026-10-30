import { z } from 'zod';

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
    }
  | { readonly kind: 'tool-use'; readonly tools: readonly string[] }
  | {
      readonly kind: 'rate-limit';
      readonly status: string;
      /** Epoch seconds, as Claude Code reports it. */
      readonly resetsAt: number | undefined;
    }
  | { readonly kind: 'message-start' }
  | { readonly kind: 'text-delta'; readonly text: string }
  | { readonly kind: 'result'; readonly result: ClaudeCodeResult }
  | { readonly kind: 'other' }
  | { readonly kind: 'invalid'; readonly reason: string };

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
}

const line = z.looseObject({ type: z.string(), subtype: z.string().optional() });

const init = z.looseObject({
  model: z.string().optional(),
  claude_code_version: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

const contentBlock = z.looseObject({ type: z.string(), name: z.string().optional() });

const assistant = z.looseObject({
  message: z.looseObject({ content: z.array(contentBlock).optional() }),
});

const streamDelta = z.looseObject({ type: z.string().optional(), text: z.string().optional() });

const apiStreamEvent = z.looseObject({ type: z.string(), delta: streamDelta.optional() });

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
});

/** Parses one line of Claude Code's stream-json output. Never throws. */
export function parseClaudeCodeEvent(text: string): ClaudeCodeEvent {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: 'not JSON' };
  }
  const envelope = line.safeParse(json);
  if (!envelope.success) {
    return { kind: 'invalid', reason: 'not a stream-json event' };
  }
  const { type, subtype } = envelope.data;
  if (type === 'system' && subtype === 'init') {
    return toInit(json);
  }
  switch (type) {
    case 'assistant': {
      return toToolUse(json);
    }
    case 'stream_event': {
      return toStreamEvent(json);
    }
    case 'rate_limit_event': {
      return toRateLimit(json);
    }
    case 'result': {
      return toResult(json);
    }
    default: {
      return { kind: 'other' };
    }
  }
}

function toInit(json: unknown): ClaudeCodeEvent {
  const parsed = init.safeParse(json);
  if (!parsed.success) {
    return { kind: 'invalid', reason: 'malformed init event' };
  }
  return {
    kind: 'init',
    model: parsed.data.model,
    version: parsed.data.claude_code_version,
    tools: parsed.data.tools ?? [],
  };
}

function toToolUse(json: unknown): ClaudeCodeEvent {
  const parsed = assistant.safeParse(json);
  if (!parsed.success) {
    return { kind: 'other' };
  }
  const tools = (parsed.data.message.content ?? [])
    .filter((block) => block.type === 'tool_use')
    .map((block) => block.name ?? 'unknown');
  return tools.length === 0 ? { kind: 'other' } : { kind: 'tool-use', tools };
}

function toStreamEvent(json: unknown): ClaudeCodeEvent {
  const parsed = streamEvent.safeParse(json);
  if (!parsed.success || (parsed.data.parent_tool_use_id ?? undefined) !== undefined) {
    return { kind: 'other' };
  }
  const { event } = parsed.data;
  if (event.type === 'message_start') {
    return { kind: 'message-start' };
  }
  const text = event.delta?.type === 'text_delta' ? event.delta.text : undefined;
  return text !== undefined && text !== '' && event.type === 'content_block_delta'
    ? { kind: 'text-delta', text }
    : { kind: 'other' };
}

function toRateLimit(json: unknown): ClaudeCodeEvent {
  const parsed = rateLimit.safeParse(json);
  if (!parsed.success) {
    return { kind: 'other' };
  }
  const info = parsed.data.rate_limit_info;
  return { kind: 'rate-limit', status: info.status, resetsAt: info.resetsAt };
}

function toResult(json: unknown): ClaudeCodeEvent {
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
      structuredOutput: hasStructuredOutput ? data['structured_output'] : undefined,
      apiErrorStatus: data.api_error_status ?? undefined,
      turns: data.num_turns,
      costUsd: data.total_cost_usd,
      duration:
        data.duration_ms === undefined
          ? undefined
          : Temporal.Duration.from({ milliseconds: Math.round(data.duration_ms) }),
      deniedToolUses: data.permission_denials?.length ?? 0,
    },
  };
}
