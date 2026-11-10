# 0100. Review notes: optional titles, a severity emoji and a note icon

- Status: Accepted; the severities and their emoji are superseded by [0131](0131-conventional-comments-labels-and-a-blocking-decoration.md)
- Date: 2026-11-02

## Context

A review note (a URA item, ADR 0023) required a one-line title, which made praise and short questions awkward: the reviewer had to invent a headline for a note whose body says it all. Severities were also only words, easy to skim past in the dock, in the diff marker and in a posted GitHub review. The chat has a speech-bubble button in the diff gutter; notes had no icon of their own.

## Decision

- The title is optional: an empty string. A note must still say something, so at least one of title, body and suggested patch is non-empty. `validateUraItem` is the one gate, and the `ura_items` table mirrors it with a `CHECK`.
- Where a headline is needed (the dock row, the diff marker, the command palette) a note without a title shows the first line of its body.
- Each severity has an emoji: 🛑 blocker, ⚠️ issue, ❓ question, ⛏️ nit, ✨ praise. They appear in the dock, the diff marker, the composer and the posted GitHub review (`✨ **Praise:** title`, or `✨ **Praise**` with no title). The agent payload (JSON and XML) carries the `severity` word only and omits `<title>` when there is none.
- The staged-note marker in the diff and the dock rows carry a note icon, the chat bubble outlined with two lines of text. `@pierre/diffs` offers a single gutter button, so the gutter keeps the chat bubble.
- ⚠️ stands for `issue` rather than 🤔, which reads as a question next to ❓.

## Consequences

- Consumers of `title` (exporters, the MCP payload) must handle `''`.
- Migrations are still squashed (ADR 0006 amendment), so `ura-0001-initial` was edited in place; after the first tagged release this would have been a new migration.
- The emoji live in two tables, `src/internal/ura/ura-severity-emoji.ts` and `src/ui/ura-severity-emoji.ts`, because the renderer may not import a domain.
