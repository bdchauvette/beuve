# 0137. Migrations run with foreign keys off, after a backup, and never on a newer database

- Status: Accepted
- Date: 2026-11-11

## Context

Migrations are append-only now (ADR 0006 amendment 2026-11-11), and the author reviews on real data, so a migration that goes wrong loses reviews. Three gaps:

- `openDatabase` turns on `PRAGMA foreign_keys`, and `runMigrations` wraps each migration in `BEGIN IMMEDIATE`, where that pragma is a no-op. A rebuild of a parent table by [SQLite's 12-step procedure](https://www.sqlite.org/lang_altertable.html#otheralter), the only way to change a CHECK or a column constraint, would `DROP TABLE sessions` with foreign keys on. That drop is an implicit `DELETE`, which cascades through every `ON DELETE CASCADE` child: checkpoints, URA items, chat, review edits, setup runs.
- Nothing keeps the database as it was before a migration. A migration that commits but is wrong (a bad `UPDATE`, a lossy copy) can't be undone.
- `runMigrations` ignores applied ids it doesn't know. An older build opened on a database a newer one migrated would run on a schema it doesn't understand, and could write rows the newer build reads as corrupt.

## Decision

**Foreign keys are off while migrations run.** When migrations are pending, `runMigrations` (`src/sqlite`) reads `PRAGMA foreign_keys`, turns it off outside any transaction, and restores it once they are done, through a `DisposableStack` (ADR 0076); called inside a transaction with work pending, it throws, since the pragma couldn't take effect. Before each migration commits, inside its transaction, the runner checks that every foreign key names a table that exists and that `PRAGMA foreign_key_check` reports no row; otherwise it throws and the migration rolls back, unrecorded. A rebuild therefore keeps its children's rows, and a migration that would leave dangling references fails at startup instead of corrupting data.

Consequences for migration authors:

- Nothing cascades during a migration: a migration that deletes parent rows deletes their children itself, or the check fails.
- A rebuild follows the documented order: create `x_new`, copy, `DROP TABLE x`, `ALTER TABLE x_new RENAME TO x`, then recreate `x`'s indexes, triggers and views. `legacy_alter_table` stays off (SQLite's default; nothing sets it), under which a rename rewrites the references in other tables, triggers and views. Renaming the old table first (`ALTER TABLE x RENAME TO x_old`) would move every child's `REFERENCES x` to `x_old`; `foreign_key_check` doesn't report a key whose parent table is missing, so the runner checks for that itself and refuses such a migration.

**A database is backed up before it migrates.** When `openAppDatabase` finds a file database that has applied at least one migration and has some pending, it first copies it with `VACUUM INTO` (`backupDatabase`, `src/sqlite`) to `<userData>/backups/beuve-<UTC time>-<last applied id>.db`, for example `beuve-2026-11-11T120000.000Z-ura-0002-drop-impact-findings.db`: the time has no colons and the id keeps only letters, digits, `_`, `.` and `-`, so the name is valid on every file system, sorts by time, and says which schema the copy has. The file is created empty with mode 0600 before `VACUUM INTO` writes into it, and `backups/` is created 0700 and is on `secureUserData`'s list (ADR 0082). The newest three backups are kept; older files matching the name pattern are removed, and nothing else in the directory is touched. A new database and `':memory:'` take no backup, nor does a database already up to date. If the backup fails, startup fails: migrating without one is what this prevents. The backup and the migrations applied are logged. Restoring is by hand: quit beuve and copy a backup over `beuve.db` (removing `beuve.db-wal` and `-shm`).

**A database from a newer build is refused.** `openAppDatabase` compares `schema_migrations` with the migration list first (`readMigrationStatus`, `src/sqlite`). If it holds an id the list doesn't, it closes the database without migrating or backing it up and returns `Err({ kind: 'newer-database', location, unknownIds })`, an expected failure (a `Result`, `#x/result/`); a failing migration or backup is a bug and still throws. `launch()` in `src/main/index.ts` logs it and shows a dialog saying the database was written by a newer version of beuve, naming the unknown migrations, with Quit (the default and cancel button), Set Database Aside and Restart, Show Log File and Show Database (each reveals the file and shows the dialog again). Set Database Aside moves the refused file aside with `moveDatabaseAside` (ADR 0136) and relaunches on an empty database; it clears nothing else, since no session was opened, and the newer build can use the copy again once it is renamed back.

## Consequences

- Rebuilding `sessions` or `ura_items` to change a constraint is safe to write as a plain migration, and the runner tests (`src/sqlite/sqlite.test.ts`) show a rebuild keeping its children and a dangling or misdirected reference rolling back.
- A migration that relied on `ON DELETE CASCADE` now fails until it deletes children explicitly. The shipped `ura-0002-drop-impact-findings` deletes URA items without their review edits; databases with such items and edits don't exist (the origin was removed long before review edits), and one would fail loudly rather than lose data.
- `foreign_key_check` runs over the whole database per migration, so a database that already held violations could not migrate. beuve has always run with foreign keys on, so it holds none.
- Each upgrade that migrates writes a full copy of the database; three are kept, so the backups take up to three times its size.
- Downgrading beuve no longer works silently: the reviewer installs the newer build again, or sets the refused database aside from the dialog.
