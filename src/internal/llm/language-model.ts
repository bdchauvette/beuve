import type { z } from 'zod';

import type { Result } from '#x/result/result.ts';

import type { SandboxTree } from './create-read-only-sandbox.ts';

/**
 * beuve's port to a language model (ADR 0019, 0030). Vendor-neutral: an adapter turns one request
 * into one agentic, read-only run over `cwd` or `tree`. Neither method rejects; every failure is a
 * {@link ModelError}. Domains don't import this type (ADR 0002): each declares the structural
 * subset it needs, and main passes an adapter in.
 */
export interface LanguageModel {
  /** What this configured model can do; consumers size prompts and pick instructions from it. */
  readonly capabilities: ModelCapabilities;
  /** A structured answer that already matches `outputSchema` (the preliminary review). */
  readonly run: <T>(request: ModelRequest<T>) => Promise<Result<ModelOutput<T>, ModelError>>;
  /** A free-form Markdown answer (Q&A chat), optionally streamed as it is written. */
  readonly runText: (request: TextModelRequest) => Promise<Result<ModelOutput<string>, ModelError>>;
}

/**
 * What a configured model can do (ADR 0070). `structuredOutput` is `native` when the backend
 * constrains the answer to the schema itself, `prompted` when the schema travels in the prompt
 * and only validation enforces it. `contextWindowTokens` is `undefined` when unknown.
 */
export interface ModelCapabilities {
  /** Whether the model may read the repository with read-only tools. */
  readonly tools: boolean;
  /**
   * Whether a run reads files from `cwd` itself (Claude Code's own `Read`, `Grep` and `Glob`), so
   * the request needs a checkout. `false` when its tools read `tree` (git objects) or it has
   * none; such a request needs no worktree lease (ADR 0087).
   */
  readonly checkout: boolean;
  readonly structuredOutput: 'native' | 'prompted';
  readonly contextWindowTokens: number | undefined;
  readonly maxOutputTokens?: number;
  /** Whether `onText` receives the answer as it is written. */
  readonly streaming: boolean;
}

/** How hard the model thinks: Claude Code's `--effort` levels (2.1.312). */
export type ModelEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * One turn of the conversation sent to the model. `cache` marks the end of the stable prefix
 * (the change and its diff, which repeat across questions at one head): an adapter that can
 * cache prompts caches up to and including the last message so marked. Adapters that take a
 * single prompt flatten the messages ({@link flattenModelMessages}).
 */
export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  /** Never logged above debug level. */
  readonly content: string;
  readonly cache?: boolean;
}

/** What every run needs, whatever the shape of its answer. */
export interface BaseModelRequest {
  /** Instructions appended to the backend's own system prompt. Not secret, but not logged at info. */
  readonly system: string;
  /** The conversation, oldest first; the last message is the user's. */
  readonly messages: readonly ModelMessage[];
  /**
   * Absolute directory the model may read (the session worktree), which must never be written.
   * Required by adapters whose capabilities say `checkout`; the others never read it.
   */
  readonly cwd?: string | undefined;
  /** The reviewed commit's tracked files, for adapters whose tools read git objects (ADR 0087). */
  readonly tree?: SandboxTree | undefined;
  readonly timeout: Temporal.Duration;
  readonly signal?: AbortSignal | undefined;
  /** Coarse progress for a status line. Carries no prompt or file content. */
  readonly onProgress?: (progress: ModelProgress) => void;
  /** Overrides the configured effort for this request. */
  readonly effort?: ModelEffort;
  /** Overrides the configured model for this request. */
  readonly model?: string;
}

/** A request to an adapter that reads a checkout: `cwd` is set. */
export type CheckoutModelRequest = BaseModelRequest & { readonly cwd: string };

export interface ModelRequest<T> extends BaseModelRequest {
  /** The shape of the answer. Adapters send it as JSON Schema and validate the reply against it. */
  readonly outputSchema: z.ZodType<T>;
}

export interface TextModelRequest extends BaseModelRequest {
  /**
   * The answer as it is written, when the backend streams. The final answer is the last assistant
   * message, so `reset` drops text written before a tool call. The streamed text is a preview:
   * only the run's result is authoritative.
   */
  readonly onText?: (event: TextStreamEvent) => void;
}

export type TextStreamEvent =
  { readonly kind: 'append'; readonly text: string } | { readonly kind: 'reset' };

/**
 * Coarse progress of a run, for a status line (ADR 0070). A tool's `description` names what it
 * looks at (`read src/auth.ts:1-40`, `grep validate(`), never what it found; `summary` is set
 * only when the backend reports a short, content-free one.
 */
export type ModelProgress =
  | { readonly kind: 'started'; readonly model: string | undefined }
  | { readonly kind: 'thinking'; readonly summary?: string }
  | {
      readonly kind: 'tool-start';
      readonly id: string;
      readonly tool: string;
      readonly description: string;
    }
  | { readonly kind: 'tool-end'; readonly id: string; readonly tool: string; readonly ok: boolean }
  | { readonly kind: 'text-start' }
  | { readonly kind: 'text-end' };

export interface ModelOutput<T> {
  readonly value: T;
  /** The backend's model identifier, e.g. `claude-sonnet-5-5`, when it reports one. */
  readonly model: string | undefined;
  readonly turns: number | undefined;
  /** The backend's cost estimate; for subscription logins this is notional, not billed. */
  readonly costUsd: number | undefined;
  readonly duration: Temporal.Duration;
  /** Tool calls the backend refused under the read-only policy. */
  readonly deniedToolUses: number;
  /** Tokens across every request of the run, when the backend reports them. */
  readonly usage?: ModelUsage;
}

/** Token counts summed over a run's requests (and, after a refusal fallback, every attempt). */
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

/** Why a model run produced no usable output. Every variant is an expected failure. */
export type ModelError =
  | { readonly kind: 'invalid-request'; readonly reason: string }
  | { readonly kind: 'not-installed'; readonly command: string }
  /** The executable runs but is older than the version the adapter needs. */
  | {
      readonly kind: 'unsupported-version';
      readonly command: string;
      readonly version: string;
      readonly required: string;
    }
  | { readonly kind: 'not-authenticated'; readonly message: string }
  | {
      readonly kind: 'rate-limited';
      readonly message: string;
      readonly resetsAt: string | undefined;
    }
  | { readonly kind: 'timeout'; readonly timeout: Temporal.Duration }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'output-too-large'; readonly maxBytes: number }
  | { readonly kind: 'invalid-output'; readonly reason: string }
  /**
   * The backend ran but reported an error result (budget exhausted, execution error, a refusal
   * with no fallback, …), with the API's HTTP `status` when one caused it.
   */
  | {
      readonly kind: 'model-failed';
      readonly reason: string;
      readonly message: string;
      readonly status?: number;
    }
  | {
      readonly kind: 'process-failed';
      readonly exitCode: number | undefined;
      readonly signal: string | undefined;
      readonly stderr: string;
    };
