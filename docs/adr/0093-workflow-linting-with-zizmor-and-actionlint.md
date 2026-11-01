# 0093. Workflow linting with zizmor and actionlint

- Status: Accepted
- Date: 2026-11-01

## Context

The workflows build and publish releases and push to `main`, so a workflow bug or injection is a supply-chain risk. Neither workflow was linted.

## Decision

- `.github/workflows/workflow-lint.yml` runs on changes under `.github/`: actionlint (syntax, expressions, shellcheck) and zizmor (security) with `persona: auditor`, the strictest setting, plus its online audits. Findings fail the job.
- actionlint is downloaded as a pinned release and verified against a pinned SHA-256 before it runs. zizmor runs through its action, pinned by commit, with the zizmor version pinned too.
- Every `uses:` is pinned to a full commit SHA with the tag in a trailing comment. Dependabot (`.github/dependabot.yml`, 7-day cooldown) proposes updates.
- Workflows default to `permissions: {}`, and each job asks for its own. `actions/checkout` sets `persist-credentials: false`; the release job passes its token to git through the environment for the cask push only. The release workflow, which publishes artifacts, uses no dependency cache.
- Reproduce locally with `zizmor --persona auditor .github` and `actionlint`.

## Consequences

A new action or permission needs a pinned SHA and a reason. Bumping zizmor or actionlint means updating the version, and for actionlint the checksum, in the workflow. New zizmor audits can fail the job after a version bump; that is the point.
