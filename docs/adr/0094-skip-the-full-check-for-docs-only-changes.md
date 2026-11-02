# 0094. Skip the full check for docs-only changes

- Status: Superseded by [0103](0103-separate-test-static-and-build-workflows.md)
- Date: 2026-11-01

## Context

`ci.yml` typechecks, lints, tests, builds and packages on two operating systems. None of that depends on prose, and a docs-only change still paid for all of it. `format:check` does cover Markdown, so dropping CI outright would let an unformatted doc land and fail the next code change.

## Decision

- `ci.yml` has `paths-ignore` for `docs/**`, `**/*.md` and `LICENSE`, on both `push` and `pull_request`. A change that also touches any other file runs everything.
- `docs.yml` runs on exactly those paths and runs `prettier --check` on them.
- The two path lists stay identical. Tests build their own fixtures and never read the repository's docs; a test or script that starts to must be added to the path lists.

## Consequences

Docs-only changes finish in about a minute. If branch protection requires the `check (…)` jobs, a docs-only pull request never reports them and cannot merge. Require `format` as well, or switch to a job-level `if`, if that rule is turned on.
