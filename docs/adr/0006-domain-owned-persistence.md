# 0006. Domains own their tables; main composes

- Status: Accepted
- Date: 2026-10-28

## Context

The spec defines a single schema in `src/main/database-initializer.ts` with tables that belong to different domains (sessions, checkpoints, URA items, chat messages, agent comments). Domain isolation (ADR 0002) forbids domains from importing each other, so a single shared repository layer would either leak domain types across boundaries or become a dumping ground.

## Decision

- Each domain owns its tables: it defines its migrations and repository functions, and takes a database handle as a parameter. Domains never open connections themselves.
- `src/main` opens the database, enables foreign keys and WAL, and runs the composed migrations in a fixed order.
- Add a `src/internal/session/` domain to own `sessions` and `checkpoints`, since a review session spans git, URA, chat and review. Other tables go to `ura` (`ura_items`), `chat` (`chat_messages`) and `review` (`agent_comments`) as those domains are built.
- Cross-domain foreign keys (e.g. `ura_items.session_id`) are allowed in SQL. They express data integrity, not code dependencies.
- Domain logic stays in pure functions over plain data; repositories are a thin edge.
- IDs are `crypto.randomUUID()` strings; timestamps are ISO-8601 UTC text.

## Consequences

Domains can be tested against an in-memory database in isolation. Migration ordering is a composition concern in `src/main`, and later domains must only reference tables from domains that migrate earlier.
