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

## Amendment 2026-10-29: migrations squashed

Migrations are squashed until the first tagged release; after that, append-only. Until then each domain has one initial migration holding its final schema (`session-0001-initial`, `review-0001-initial`, `ura-0001-initial`, `chat-0001-initial`, `github-0001-initial`), and a schema change edits it. No release or database exists yet, so nothing upgrades. Once a version is tagged, a migration that shipped is never edited and every schema change is a new migration.

## Amendment 2026-11-11: a drifted database is set aside

"No database exists yet" was wrong: development builds keep `beuve.db`, and `runMigrations` never runs an applied id again, so editing a squashed migration left those databases on the old schema. The first symptom was staging a note failing with a bare "internal error" after `ura-0001-initial` gained `blocking` (ADR 0131): the insert names a column the table doesn't have.

On every start, after migrating, `openAppDatabase` compares the file's `sqlite_schema` with what the same migrations build in memory (`findSchemaDrift`, `#sqlite/find-schema-drift.ts`). If any table, index, view or trigger differs, it renames the file (with its `-wal` and `-shm`) to `beuve.db.drifted-<UTC time>`, starts a new database, and tells the reviewer once in a dialog that offers to show the old file. Nothing tries to convert the old data: before the first release there is no supported upgrade path, and the moved file keeps it for anyone who wants it.

The check stays after the first release. Then append-only migrations make drift impossible unless a shipped migration was edited, which is a bug the check surfaces instead of hiding behind failing queries.
