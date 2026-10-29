# 0045. A chosen verdict belongs to the head it was chosen at

- Status: Accepted
- Date: 2026-10-29

## Context

ADR 0029 stored the reviewer's chosen verdict per session and noted that it is not tied to a head: a new commit kept it, so an agent reading `beuve_read_human_review` after the author pushed saw an "approve" that was decided about code that no longer exists.

## Decision

- The choice is stored with the head sha it was made at (`ura_verdict_choices.head_sha`, migration `ura-0004-verdict-choice-head`; a CHECK ties it to the verdict, so a chosen verdict always has one).
- `settleVerdictChoice` takes the current head. A choice made at another head is dropped and remembered as cleared with the reason `head-moved`, exactly as a blocker clears an approval (ADR 0029); the check runs on every read and after every change announcement, including the one `observeHead` makes when the head moves. The derived verdict applies again, and `ura:list` carries `verdictNotice`: "Verdict cleared: new commits since you chose it", shown in the dock until the reviewer chooses again.
- The head is the session's head as the reviewer's view shows it: `ura:set-verdict` stamps the choice with the session's stored head, which `ura:list` refreshes first.
- The migration rebuilds the table (SQLite can't alter a CHECK). A choice made before heads were recorded can't be tied to one, so it becomes a remembered `head-moved` clear and the reviewer sees the notice once.

## Consequences

An agent never reads a verdict the reviewer gave about an older head, and `ura:export` agrees. The notice says "new commits" for the one-off legacy case too, which is close enough. An explicit `verdict` on `ura:export` still overrides for that export. Rebasing to an identical tree moves the head and clears the choice; that is the safe side. This supersedes the "not tied to a head" consequence of ADR 0029.

## Amendment 2026-10-29: migrations squashed

Squashed into `ura-0001-initial` (ADR 0006); the schema described here is unchanged, and no upgrade step exists. The rebuild that turned a verdict chosen before heads were recorded into a remembered `head-moved` clear is gone: no such rows can exist. `head-moved` remains the reason when a head moves.
