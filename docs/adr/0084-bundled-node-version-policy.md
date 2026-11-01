# 0084. The bundled Node tracks the CI LTS, pinned by checksum

- Status: Accepted
- Date: 2026-10-31

## Context

Packaged beuve ships its own Node for the language server and trace probes (ADR 0083). It runs code beuve injects into the reviewed repository's Vitest, such as the setup module, which uses `Temporal`. It also runs that repository's own tests, so its version decides what those tests see. It is a download from outside the repository, built into every artifact, and a security-relevant runtime that beuve must keep current, independently of Electron.

## Decision

- **Track the Node LTS that CI and development use** (`.node-version`, ADR 0060), currently 26. Don't track Electron's embedded Node (24). The packaged Node's major version is always ≥ the CI version, so anything that passes beuve's tests also runs on the shipped Node. `resolveNodeRuntime` refuses anything below 26. A test ties its default minimum to `.node-version`.
- **Pin one version with its checksums in `scripts/node-runtime.json`**: `version`, and the SHA-256 of `node-v<version>-<target>.tar.xz` for each shipped target (`darwin-arm64`, `linux-x64`). The first pin is **26.13.0**, the first 26.x LTS ("Lithium", 2026-10-28), and still the latest 26.x on 2026-10-31.
- **Hashes come from the release's official `SHASUMS256.txt`.** When bumping, check that file's detached signature (`SHASUMS256.txt.sig`) against a Node.js releaser key listed in the nodejs/node README. For 26.13.0 it verified as signed by Richard Lau, `C82F A3AE 1CBE DC6B E46B 9360 C43C EC45 C17A B93C` (key fetched from keys.openpgp.org). The build doesn't check signatures: it trusts the hashes committed to the repository, and `scripts/fetch-node.ts` refuses any download that doesn't match them, before extracting anything.
- **Fetched at build time, never committed.** Archives are cached in `vendor/node/cache`, and a second run with the same pin neither downloads nor extracts. Tests never fetch: `fetchNodeBinary` takes its download function as a parameter.
- **Bump deliberately**, in its own commit: on a Node security release for the pinned line, and when CI moves to a new LTS (move `.node-version`, the pin and the resolver's minimum together). Each bump updates the version and both hashes, and runs `npm run dist:linux-dir` and `npm run check:packaged`.

## Consequences

Probe results match what the repository's CI would see on the same Node line. A forgotten bump leaves a Node with known vulnerabilities in the app, so Node security releases join Electron's on the release checklist (docs/packaging.md). Adding a target, such as Intel macOS, means adding its hash. Committed hashes make every build reproducible and tamper-evident, but only as trustworthy as the bump that recorded them, which is why the signature is checked at that point.

## Amendment (2026-11-01, ADR 0091): corepack

The bundled corepack (ADR 0091), pinned exactly in `package.json` and checked by `check-packaged-app`, follows the same policy: bumped deliberately, in its own commit, after checking it on the CI Node and in the packaged app.
