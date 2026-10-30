# 0030. An `llm` domain for the model port and Claude Code adapter; consumers declare structural ports

- Status: Accepted; amends [0019](0019-review-model-port-and-claude-code-cli-adapter.md); the review domain's port moved to the chat by [0055](0055-review-folded-into-chat-with-verification.md)
- Date: 2026-10-28

## Context

ADR 0019 put the model port (`ReviewModel`, `ModelError`) and the Claude Code CLI adapter in the `review` domain. The Zone 4 Q&A chat needs the same adapter, but domains can't import each other (ADR 0002), type-only imports included, and a second copy of the adapter would drift. Chat also needs what review doesn't: a free-form Markdown answer instead of schema-constrained JSON, and the answer's text as it streams.

## Decision

- **`src/internal/llm/`** owns the vendor-neutral port `LanguageModel` (`language-model.ts`) and its first adapter, `createClaudeCodeModel`, with the argv builder, environment allow-list, stream-json parser, outcome classifier, the captured fixtures and the fake `claude` (`llm/testing/write-fake-claude.ts`, ADR 0013). Behavior and flags for review runs are unchanged.
- **Port**: `run<T>({ system, prompt, cwd, outputSchema, timeoutMs, signal?, onProgress? })` gives `Result<ModelOutput<T>, ModelError>` as before. `runText({ system, prompt, cwd, timeoutMs, signal?, onProgress?, onText? })` gives `Result<ModelOutput<string>, ModelError>`: the final result text, which must not be blank (`invalid-output` otherwise). Neither rejects.
- **Streaming**: with `onText`, the adapter adds `--include-partial-messages` (in `claude --help` for 2.1.312). One real run confirmed the shape: top-level `stream_event` lines carry Messages API events, with text in `content_block_delta`/`text_delta` and `message_start` opening each assistant message (fixture `claude-code-text-stream-fixture.ts`). The adapter sends `{ kind: 'append', text }` for each delta, and `{ kind: 'reset' }` when a new message starts after text was streamed, because the result is only the last message (earlier text came before a tool call). Subagent events (`parent_tool_use_id` set) are ignored. Streamed text is a preview; only the result is authoritative. Text runs send no `--json-schema`; the read-only tool flags are the same.
- **Structural ports**: consumers don't import `LanguageModel`. `review/review-model.ts` declares `ReviewModel<E>` with just `run`, and `chat/chat-model.ts` declares `ChatModel<E>` with just `runText`. Each is generic in the error, which the domain passes through untouched (`runPreliminaryReview<E>`, `askQuestion<E>`), so neither copies the `ModelError` union. Main constructs the adapter, passes it in, and maps `ModelError` (imported from `#internal/llm/language-model.ts`) to its typed codes.
- Resolving the `claude` executable stays in main (`src/main/review/resolve-claude-command.ts`, ADR 0022).

## Consequences

- Adding a backend (Agent SDK, API key, Bedrock) means one adapter in `llm`. Review and chat don't change.
- A structural port can drift from `LanguageModel` without either domain noticing. Main's calls are what check it: `runPreliminaryReview` is called with the adapter in `create-review-services.ts`, and `src/main/chat/ask-question-with-claude-code.test.ts` passes it to `askQuestion`.
- A domain test can't use the fake `claude`, because domain isolation applies to tests. Review and chat tests use in-domain fakes of their port, and tests in `src/main` cover the adapter end to end.

## Amendment 2026-10-30: one consumer

With the review folded into the chat (ADR 0055), the chat domain declares both structural ports: `ChatModel` (`runText`) and `ReviewModel` (`run`, for `/review` and its verification pass). `reviewChange` is called with the adapter in `src/main/chat/create-chat-services.ts`, which is what checks the port. Resolving `claude` moved to `src/main/chat/`.
