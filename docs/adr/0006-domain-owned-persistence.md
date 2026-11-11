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

## Amendment 2026-11-11: migrations are append-only from now on

"No database exists yet" was wrong: development builds keep `beuve.db`, and `runMigrations` never runs an applied id again, so each edit of a squashed migration left those databases on the old schema. The first symptom was staging a note failing with a bare "internal error" after `ura-0001-initial` gained `blocking` (ADR 0131): the insert names a column the table didn't have.

Squashing ends here, before the first release, rather than at it. The initial migrations were edited one last time (ADR 0131's label list, ADR 0134's origin rule) and are now shipped: every schema change is a new migration that `runMigrations` applies at startup, including table rebuilds for CHECK changes SQLite can't `ALTER`. `src/main/database/app-migrations.test.ts` pins every migration by id and a fingerprint of its SQL, so editing one that has shipped fails the tests instead of failing a reviewer's database; a new migration adds its line. A function migration is pinned by id only.

A database made before this change has to be deleted once (`beuve.db`, `-wal`, `-shm` in `userData`); no upgrade path is written for schemas that only ever existed in development.

## Amendment 2026-11-11: upgrades are tested against shipped schemas

A fingerprint stops a shipped migration from being edited, but not a new one that works on an empty database and fails, or builds something else, on a reviewer's rows. `findSchemaDrift` (comparing `sqlite_schema` with a fresh migrated database) was tried at startup and removed; the comparison now runs in tests instead.

`src/main/database/testing/schema-fixtures/` holds one SQL dump per shipped schema: the tables, indexes and `schema_migrations` rows a release leaves, and representative rows in every table (each session kind, URA origin, label and status, chat role, status and part). A fixture is named after its last migration, written by `node scripts/write-schema-fixture.ts` (which refuses to replace one) and never edited. `app-migrations.test.ts` loads each into `:memory:`, runs `appMigrations`, and requires the normalised `sqlite_schema` to equal a fresh `openAppDatabase(':memory:')`, `foreign_key_check` and `integrity_check` to be clean, and every table both sides have to keep its row count. It also checks that each fixture is a run of the shipped migrations with rows in every table, and that each domain's migration ids carry its prefix and no prefix reuses a number.

When a release is tagged, add a fixture for its schema (after extending the script's seed rows to any table or column the release added); a release whose last migration already has one needs none. A new migration needs no new fixture, but must pass against all of them. A migration that deliberately deletes rows a fixture holds changes the counts check in the same commit, with the reason.

## Amendment 2026-11-11: migration safety

ADR 0137 makes `runMigrations` run migrations with foreign keys off and checked before each commits, has `openAppDatabase` back the database up to `userData/backups` before migrating it, and refuses a database that has applied migrations this build doesn't know.
