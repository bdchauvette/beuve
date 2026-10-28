# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-10-28

## Context

beuve is built by a mix of human and agent contributors. Decisions that deviate from, or refine, the architecture specification need a durable home so later contributors don't re-litigate them or silently drift.

## Decision

Keep lightweight ADRs in `docs/adr/`, one Markdown file per decision, using the sections in `0000-template.md`. Write an ADR whenever a choice constrains future work: a dependency, a boundary rule, a data model, or a deliberate deviation from the spec. Keep them short.

## Consequences

The ADR index in `docs/adr/README.md` must be updated alongside each new record. Superseded ADRs stay in place with an updated status.
