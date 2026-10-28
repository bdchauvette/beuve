# 0026. The package-aware radar tree and the file channels behind it

- Status: Accepted
- Date: 2026-10-28

## Context

Spec section 4 puts a `@pierre/trees` radar tree in Zone 1. It auto-expands packages with modified files, highlights touched files, shows package-level ImpactGate percentiles and has a diff-only mode on `f`. ADR 0018 found the library has no notion of packages and no filter predicate, and it planned two channels: the head's tree and both sides of a file. This records how they were built.

## Decision

- **`session:get-tree { sessionId }`** refreshes the head, lists it with `git ls-tree -r --name-only -z` (`listTreePaths` in the git domain), and answers `{ sessionId, headSha, paths, packageRoots }`. Package roots are the directories holding `package.json`, `go.mod`, `Cargo.toml` or `pyproject.toml`, the repository root as `''`, ignoring `node_modules` and `vendor` (`find-package-roots.ts`). Listings are cached per (repository, head) in an LRU of 8. The renderer asks once per head.
- **`session:get-file-pair { sessionId, path }`** reloads the review the session shows now, finds `path` among its head-side paths, and reads both sides by the blob ids in the diff with `readBlobs`. A side that doesn't exist is absent. A file outside the review is `not-found`, and a binary or too-large side is `unsupported`. Only reviewed files can be read, and the renderer never names a blob. `DiffFileView` gains `oldBlobSha`/`newBlobSha` (full ids, absent for a missing side), which key the diff cache. These live in `src/main/files/`.
- **Tree contents** (`plan-radar-tree.ts`, pure). Neighborhood mode lists every tracked path plus deleted files the head no longer has, and opens the directories leading to each changed file. The changed file's package and its siblings are in view, and untouched packages stay closed. Diff-only mode lists the changed files alone with all their directories open. Changed files get git-status lanes (a copy shows as added). Each changed file maps to its innermost package root.
- **Decorations** (`plan-tree-decorations.ts`, pure). A changed file shows the highest head percentile among its changed functions (`p83`), plus its findings over the cognitive limit (`p83 ▲1`). A package root shows the maximum and the sum over its files. The repository root package isn't decorated, since everything is in it.
- **Behavior.** `f` toggles the mode anywhere outside a text field. Tab into Zone 1 focuses the tree on the first changed file. Arrows move, and selecting a reviewed file (click, Enter, Space) scrolls Zone 2 to its card, at its header. The tree mounts lazily with the library (ADR 0025). Its colors map `--trees-*-override` to `--beuve-*`.

## Consequences

Reviewers see where a change sits in its package without a filter the library lacks. Mode switches reset the expansion to the planned one. A very large repository sends every path once per head: about 4 MB for 100 000 paths, which the tree virtualizes. Packages are found by manifest name only, so workspaces declared elsewhere (Bazel, Gradle) aren't packages until a rule is added. The file pair reloads the review diff per call (a few git spawns), which is fine for a click but not for bulk reads.
