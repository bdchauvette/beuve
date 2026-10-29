# beuve: Architecture Specification

Code Review and Verification Workbench.

> Where this document conflicts with an ADR in `docs/adr/`, the ADR wins. The code samples in sections 6 and 7 are illustrative and contain known errors that the ADRs correct.

- Target platform: macOS (Electron desktop app wrapping a local Node.js backend daemon).
- Core architecture: Modular monolith with a Go-inspired layout: single repository, strict domain boundaries, no monorepo workspaces, easy to migrate to workspaces later.
- Core stack: Node.js main process daemon (local LLM/RAG context bridge, LSP proxy and call-graph resolver, Tree-sitter AST parser, git/interdiff engine, SQLite local store, ImpactGate telemetry parser, automated agentic reviewer) plus a Lit/custom-elements renderer with CSS custom properties. No React, no Monaco.
- UI libraries: `@pierre/diffs` (diff rendering, syntax highlighting, interdiff highlights, inline editing) and `@pierre/trees` (path-first repository navigation with package-aware expansion and a diff-only filter).
- Code quality: ESLint flat config, type-checked via `projectService`, with Unicorn, @e18e, wc, lit, n, promise and security plugins, plus local AST rules (single named export per file, no barrel files, internal utility usage, kebab-case filenames, top-level `function` style). Prettier for formatting.
- Boundaries: package.json `imports` aliases plus dependency-cruiser enforcing domain isolation and no cycles.
- Style: Go, the Zen of Python, Ousterhout, Wlaschin, Hickey, pragmatic simplicity. Files read top-down ("newspaper style"): public entry first, helpers below. Top-level functions use the `function` keyword, classes use methods, all other inner helpers and function expressions are arrow functions. Explicit module types and function return types everywhere.

## 1. Product vision and principles

As AI agents accelerate code generation, comprehension and verification become the bottleneck. GitHub PR UIs are built for static text inspection; agent UIs are trapped in chat logs.

beuve is a review-first, authoring-resistant workbench, named after the critic Sainte-Beuve. It is for close examination, triage and validation, and deliberately resists becoming an editor or IDE.

Objectives:

- Zero blinders and call-stack X-ray: a package-aware neighborhood file tree, read-only LSP call-stack peek portals, and AST control-flow visualizers, without opening editor tabs.
- Runtime trace probes (`r`): lightweight test-driven execution traces instead of a debugger.
- Preliminary agentic review pass: an optional background worker on session load scans interdiffs and ImpactGate metrics and leaves non-blocking purple insights.
- Agentic verification loop: a built-in MCP server exposing LSP diagnostics, ImpactGate metrics and trace probes so coding agents can self-correct before human review.
- Context-aware Q&A chat (Zone 4): read-only, backed by local worktree embeddings and LSP symbols.
- Unified agent and human workflows: local agent runs (e.g. Claude Code) and GitHub PRs reviewed the same way, including stack navigation and CI status.
- Incremental reviews (interdiffs), inspired by Flirt: don't review the same code twice when fixups are pushed.
- Change impact and complexity gating (ImpactGate): marginal change impact and cognitive complexity surfaced in the review stream.
- Keyboard-first, modal-lite, Vim/Helix-inspired navigation.
- Universal Review Artifacts (URA): review decisions compiled into one schema and exported to Claude Code (MCP/XML), GitHub PR reviews, or applied directly.

## 2. Engineering philosophy

A. Ousterhout, A Philosophy of Software Design: deep modules with simple interfaces hiding complexity; no shallow pass-through wrappers; define errors out of existence; strategic over tactical programming.

B. Wlaschin, Domain Modeling Made Functional (in TypeScript): thin models and pure transformations; domain entities are plain data acted on by deterministic functions; make illegal states unrepresentable with discriminated unions and branded types.

C. Hickey, Simple Made Easy / Grokking Simplicity: decouple state (SQLite, git sync) from business logic; favor immutable data through explicit pipelines over mutable objects crossing IPC boundaries.

D. Minimal runtime dependencies: build small transparent utilities in `src/pkg/` rather than pulling in packages for simple tasks. Local lint rules steer contributors to `#pkg/*`.

E. Modular monolith: `src/internal/` and `src/pkg/` with `#internal/*` and `#pkg/*` aliases, dependency-cruiser enforcing isolation and acyclicity.

## 3. Directory structure

    beuve/
    ├── package.json
    ├── tsconfig.json
    ├── eslint.config.js
    ├── .dependency-cruiser.js
    ├── src/
    │   ├── internal/          private domain modules
    │   │   ├── auth/          GitHub and token authentication
    │   │   ├── chat/          Zone 4 Q&A, RAG and context indexing
    │   │   ├── git/           worktrees, interdiffs, branch management
    │   │   ├── impact/        ImpactGate complexity and telemetry
    │   │   ├── lsp/           LSP multiplexer, call-graph resolver, tree-sitter
    │   │   ├── review/        automated preliminary agentic reviewer
    │   │   ├── session/       review sessions and checkpoints (ADR 0006)
    │   │   └── ura/           Universal Review Artifact generation
    │   ├── pkg/               shared utilities, zero external deps
    │   │   ├── logger/
    │   │   ├── result/
    │   │   └── datastructures/
    │   ├── main/              Electron main process, IPC bridge, MCP server
    │   ├── preload/           context-bridge preload
    │   └── ui/                Lit renderer
    └── test/                  integration, MCP agentic, Playwright E2E

## 4. Spatial architecture: four zones

ADR 0044 overrides the geometry below: the diff stream and one tabbed sidebar (Zone 1, Zone 3 and Zone 4 as tabs), on the right by default, with no zone title bars.

- Zone 1, Intent sidebar and radar tree (260px). Top: requirements (REQ-1, REQ-2) extracted from PR descriptions or agent prompts, mapped to hunks; unmapped diffs flagged as scope creep. Bottom: `@pierre/trees` package-aware tree that auto-expands packages with modified files, highlights touched files, and shows package-level ImpactGate percentiles. `f` toggles diff-only mode.
- Zone 2, semantic diff stream (flexible). `@pierre/diffs` cards ordered by call-graph logic rather than path. Interdiff mode (rev 1 → rev 2). ImpactGate header banners. Inline tools: call-stack peek (`p`), control-flow graph (`Shift+p`), trace probe (`r`), inline edit (`e`), open in IDE (`o`).
- Zone 3, URA staging dock (320px). Collects patches, severity tags, ImpactGate violations and notes; exports to GitHub PR review or Claude Code (MCP or XML with metrics).
- Zone 4, read-only Q&A chat (toggleable drawer). Indexed on worktree files, diff hunks and LSP symbols. Cannot write files. Answers carry citation pills that jump Zone 2 to the hunk, and a button to stage an explanation as a URA comment.

## 5. Key components and workflows

A. Keyboard: `j`/`k` step hunks or files; `Space` expand/collapse; `Tab`/`Shift+Tab` cycle zones; `c` chat; `f` tree mode; `p` call-stack peek (`textDocument/incomingCalls`); `Shift+p` control-flow graph; `r` trace probe (Vitest); `e` inline edit; `m` stage into URA; `o` open in IDE.

B. Preliminary agentic review: on session init and worktree checkout, a background worker analyzes the interdiff and ImpactGate metrics and emits insights (edge cases, security, type mismatches) rendered as purple badges. `y` promotes to URA, `d` dismisses.

C. MCP server: embedded in the main process (`@modelcontextprotocol/sdk`). Tools: `beuve_get_lsp_diagnostics`, `beuve_run_impact_check`, `beuve_run_trace_probe`, `beuve_read_human_review`.

D. Peek portals and CFGs: `p` builds an expandable caller/callee tree from `textDocument/incomingCalls`, badging each caller Modified or Untouched. `Shift+p` renders a Tree-sitter-derived mini flowchart with modified lines highlighted.

E. Trace probes: `r` runs the test covering the hunk with trace logging and shows an inline execution timeline (entry, branches, return/error). Target: under 200 ms.

F. Interdiff engine: checkpoints stored in SQLite. When a PR updates, offer interdiff mode showing `git diff <last-reviewed> <current-head>`, and handle rebases sensibly.

G. ImpactGate: on worktree checkout, run local AST/Lizard-style complexity analysis to score marginal change impact and flag methods over a cognitive complexity limit. Warnings appear in diff card headers and can be auto-staged into URA.

## 6. Persistence

Initial tables (ownership per ADR 0006):

- `sessions` (id, repo_path, pr_number, last_checkpoint_sha, current_sha, updated_at)
- `checkpoints` (id, session_id → sessions, commit_sha, created_at)
- `ura_items` (id, session_id, file_path, line_start, line_end, severity, critique, patch, impact_percentile, cognitive_complexity_breach, verified_by_lsp)
- `chat_messages` (id, session_id, sender, content, citations, created_at)
- `agent_comments` (id, session_id, file_path, line_number, severity, category, body, status default 'pending_review', created_at)

The main window uses `titleBarStyle: 'hiddenInset'`, 1440×900, context isolation on, node integration off.

## 7. Code quality enforcement

- package.json `imports`: `#internal/*` → `./src/internal/*`, `#pkg/*` → `./src/pkg/*`.
- dependency-cruiser: no circular deps; domain isolation; no barrel files (ADR 0002).
- Local ESLint rules: `enforce-single-named-export` (exactly one runtime export, no default exports, types unrestricted); `enforce-internal-utils` (ban lodash/underscore and similar in favor of built-ins and `#pkg/*`); `enforce-top-level-function-syntax` (no top-level `const f = () => …` or function expressions).
- ESLint flat config: `@eslint/js` recommended, unicorn recommended, security recommended, typescript-eslint type-checked via `projectService`, `unicorn/filename-case` kebab-case, `@typescript-eslint/explicit-function-return-type`, `explicit-module-boundary-types`, n and promise for Node code (`promise/prefer-await-to-then`), `no-floating-promises`, `await-thenable`, `strict-boolean-expressions`, wc and lit for `src/ui`, @e18e recommended everywhere, eslint-config-prettier last.

## 8. Roadmap

- Phase 1: scaffold layout and aliases, SQLite init, git worktree manager, ImpactGate telemetry, LSP JSON-RPC multiplexer, automated preliminary reviewer, embedded MCP server.
- Phase 2: `@pierre/diffs`, package-aware `@pierre/trees` with `f` toggle, Zone 4 chat drawer, AST control-flow visualizer.
- Phase 3: global keyboard router, interdiff view, trace probe runner, URA dock export targets.
