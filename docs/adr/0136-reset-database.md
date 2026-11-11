# 0136. Help › Reset Database… sets the database aside and restarts

- Status: Accepted
- Date: 2026-11-11

## Context

When `beuve.db` is broken, or holds a schema no upgrade path reaches (ADR 0006's 2026-11-11 amendment asks for a database made before it to be deleted by hand), the reviewer's only way out was to find `userData` and delete files while beuve was closed. That also left the sessions' checkouts under `<userData>/worktrees`, and the records `git worktree` keeps of them in the reviewers' repositories, behind. A later change will offer the same reset from the dialog shown for a database from a newer build.

## Decision

- Help › Reset Database… (`reset-database`, a main-process command beside Show Log File, no shortcut) asks first, in a native dialog that names what is cleared (sessions, review notes, progress, chat history, beuve's checkouts), that a copy of the old database is kept and that beuve restarts.
- On confirm, main disposes every service (language servers, terminals, chat, queued worktree work), then `resetDatabase` (`src/main/database/reset-database.ts`) reads the sessions' repositories, closes the database, moves it aside, removes `<userData>/worktrees` with `removeTree` and runs `git worktree prune` in each of those repositories, so none keeps a record of a checkout that is gone. beuve then relaunches (`app.relaunch()`, `app.exit(0)`), also when the reset failed, since the database is closed by then; the log says what moved where.
- `moveDatabaseAside` (`src/main/database/move-database-aside.ts`) moves `beuve.db` to `beuve.db.reset-<UTC time, no colons>` (`-2`, `-3`, … when taken), with its `-wal` and `-shm` under the same name, so the copy opens with everything committed. It hard-links each file to its new name and unlinks the old names only once every link exists, the companions first, so nothing is overwritten or deleted. It never deletes the old database; removing old copies is the reviewer's choice.
- Kept: the review-edits worktrees under `<userData>/review-edits` and their `review/` branches (ADR 0088: they hold the reviewer's own edits, and only Discard removes them, after showing what is lost; the moved-aside database still records them), `settings.json`, `model-secrets.json`, the log, and the repositories' own working trees and indexes. A new session that wants a kept branch's name is told to rename it or change the prefix, as for any branch beuve didn't record.
- A database too broken to list its sessions still moves; its repositories' stale worktree records then wait for the next `git worktree prune`, which beuve's startup cleanup runs in every session's repository, as git's own `gc` does.

## Consequences

A reviewer can recover from a broken database without a terminal, and keep the old file for a bug report or to read it back. Old copies accumulate in `userData` until the reviewer removes them. Orphaned review-edits worktrees stay registered in their repositories until the reviewer removes them with `git worktree remove` (and the branch with `git branch -D`); beuve offers no way to do that once their sessions are gone.
