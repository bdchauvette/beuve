# 0102. Drop ImpactGate, and credit the work it drew on

- Status: Accepted
- Date: 2026-11-02

## Context

ADR 0015, 0021, 0042 and 0053 built "ImpactGate" (spec 5G): per-function cognitive and cyclomatic complexity from Tree-sitter trees, a mid-rank percentile among the analyzed files' functions, and findings for changed functions over a cognitive complexity limit (15). It reached the diff cards as a chip and popover, the radar tree as percentile decorations, the URA dock as staged findings, the chat prompt as a section, and agents as the `beuve_run_impact_check` MCP tool, and it ran in its own worker thread.

The name, and part of the idea, come from [officefloor/ImpactGate](https://github.com/officefloor/ImpactGate) (Apache-2.0, by the OfficeFloor project), a Python merge gate that scores a change by its "impact". What beuve built is a different measure. It is a Sonar-style cognitive complexity check, not ImpactGate's formula, and it shares only the name, the gating idea and a `cognitive-max` style threshold with the project it was named after. Nothing in the repository or its history shows ImpactGate code or data in beuve. beuve's implementation is its own TypeScript on `web-tree-sitter`, not Python on `lizard`.

The reviewer is not sure that either ImpactGate's formula or SonarQube-inspired metrics are the right measure for a review tool, and wants to think about it before building more on it. The feature works, which was the point of building it, but it constrains a lot of surface for a metric that may change.

## Decision

- **ImpactGate is removed**, with no replacement for now: `src/internal/impact`, `src/main/impact` and its worker (and the `dist/main/impact-worker.js` build entry), the diff card's chip, popover and findings table, the stream's totals, the radar tree's percentile decorations, `session:get-impact`, `ura:stage-impact-finding`, the `impact-details` command (ImpactGate Details), `beuve_run_impact_check`, and the ImpactGate findings in the chat prompt and its budget. The MCP server keeps `beuve_get_lsp_diagnostics` and `beuve_read_human_review`.
- **URA items lose the `impact-finding` origin.** Per ADR 0006's squash amendment (no tagged release yet), `ura-0001-initial` is edited in place: the `impact_*` columns, the origin CHECK branch and the unique index on findings are gone, and `origin_kind` is `human` or `chat-answer`. A database created before this ADR keeps its old `ura_items` table, whose extra columns are simply never written, and a retired migration (`ura-0002-drop-impact-findings`, in `src/main/database/retired-migrations.ts`) deletes the `impact-finding` rows it holds, which would otherwise read as corrupt. After the first release, a schema change like this is a new migration of the domain.
- **The reviewed marks stay on the radar tree**, now the tree's only decorations: `reviewedDecorations` replaces `withReviewedDecorations`.
- **Kept on purpose:** the syntax domain (flow, peek and review order use it), `packageRoots` and `RadarTreePlan.packageOf` (package-aware tree work still wants them), and the Tree-sitter wasm assets.
- **Credit.** If this work returns, it must name its sources. Until then they are recorded here:
  - **ImpactGate** by the OfficeFloor project, Apache-2.0: the idea of a change-impact gate that weighs a change by the complexity around the code it touches, and the name. If beuve ever copies its code or its seed data, Apache-2.0 section 4 applies (a copy of the license, notices on modified files, retained copyright and attribution notices, and a NOTICE file's attributions if there is one; upstream has none today).
  - **G. Ann Campbell, "Cognitive Complexity" (SonarSource, 2018)**: the cognitive complexity metric ADR 0015 implemented.
  - **lizard** by Terry Yin: the tool ImpactGate and ADR 0015's Sonar/Lizard comparison refer to; beuve did not use it.

## Reference: what ImpactGate measures

Read from upstream's README, REASONING.md and blog post on 2026-11-02, so a later ADR need not repeat the research. Re-check against the source before relying on any detail; its docs leave several points open.

- **Formula** (the blog's form): the cost of a changed function is `max(surrounding_weight, 1) × complexity × max(1, lines_changed)`, where `surrounding_weight` is the summed cyclomatic complexity of the other methods in its class, `complexity` is the function's own cyclomatic complexity, and `lines_changed` counts the lines the change added or edited in it (a new function has none). The change's impact is `files_changed × Σ cost`. The README writes it as `files_changed × Σ max(WMC_other, 1) × CC × Δlines`, without the `max(1, …)` on lines.
- **Gates:** absolute `warn_at` and `block_at` (sample 50,000 and 200,000, with a `tolerance` multiplier), or a percentile grade ("curve" mode: warn at 90 and block at 98 in the sample), plus an independent per-method cognitive complexity gate (`--cognitive-max`).
- **Grade:** a weighted average of two midrank percentiles, `w × project + (1 − w) × seed` with `w = n / (n + K)` and `K = 200`. The seed side interpolates linearly between the 50th, 75th, 90th, 95th, 98th and 99th percentile values of a per-language table; the project side is the repo's first-parent mainline history.
- **Seed tables:** `impact_gate/data/seed_percentiles.json`, from a scan of 20 unnamed open-source repositories (349,165 non-merge commits, eight languages, languages under 2,000 observations pooled). The scan script and the repository list are not published, and the seed's unit is a composite ("mutation plus godclass") that the README formula does not obviously reduce to. Its numbers are therefore not comparable with anything beuve could compute, and beuve's tree-sitter function boundaries would differ from lizard's anyway. A beuve percentile table would need its own corpus scan and its own script.
- **Left open by upstream:** how free functions are weighted (class or file), whether removed lines count, the rename-match threshold, deleted functions and files, and which files count as production files.

## Consequences

- About 100 files and several thousand lines go, with two IPC channels, one command, one MCP tool and a worker entry.
- Reviewers lose the complexity chip, the tree percentiles, staged findings and the agent-facing check. The `/review` chat command and its findings are unaffected.
- URA items staged from ImpactGate findings are deleted from databases that hold them (see Decision). Items of every other origin are untouched.
- A later metric starts from a clean slate and needs its own ADR. It can reuse the syntax seam (ADR 0014) and the shared git caches (ADR 0081), and should credit its sources as above.
- ADR 0015 and 0053 are superseded. ADR 0021 (ImpactGate half) and ADR 0042 (the chip) are partly superseded. Their text and the amendments in other ADRs stay as the record.
