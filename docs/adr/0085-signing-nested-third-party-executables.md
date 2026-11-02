# 0085. Nested third-party executables keep their own signatures on macOS

- Status: Accepted
- Date: 2026-10-31

## Context

The macOS app now contains a third-party executable that beuve runs: the bundled Node, `Contents/Resources/node/node` (ADR 0083). nodejs.org's darwin binary is signed with the Node.js Foundation's Developer ID (team `HX7739G8FX`), with the hardened runtime and a timestamp. Its entitlements are what Node needs: `allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection`, `allow-dyld-environment-variables`, `disable-library-validation` and `get-task-allow`. The last was seen in CI's `codesign -d --entitlements -` output for 26.13.0.

electron-builder signs through `@electron/osx-sign`, which walks the whole bundle and re-signs every Mach-O file with `--force`, under beuve's identity and `entitlementsInherit`. Today that identity is ad hoc (`-`), without the hardened runtime (ADR 0048).

The Node binary then has two possible signatures:

- **Re-signed as beuve.** Under a future Developer ID build with the hardened runtime, it would get beuve's inherited entitlements, which are only `allow-jit`. Library validation would then reject the reviewed repository's native addons (such as rolldown's napi binding, which Vite and Vitest load) whenever they aren't signed by beuve's team, so probes would break. Adding `disable-library-validation` to `entitlementsInherit` would also weaken every Electron helper. electron-builder has no per-file entitlements option.
- **Kept as the Foundation signed it.** `mac.signIgnore` skips the file. The app's seal still covers it, because a Mach-O file in `Contents/Resources` is hashed as a resource. Notarization accepts nested code with another team's Developer ID, the hardened runtime and a secure timestamp.

## Decision

- **Keep the Node.js Foundation signature.** `electron-builder.yml` lists `Contents/Resources/node/node$` in `mac.signIgnore`. The binary keeps Node's own entitlements. beuve's `entitlementsInherit` stays at `allow-jit` alone.
- **The same applies to later third-party executables** that come signed by their vendor: keep the vendor's signature unless beuve has to change the binary. The bundled Claude Code binary (ADR 0069, 0070) is still re-signed, as before; whether it should keep Anthropic's signature is a separate decision, to make when a signed build first runs it.
- **CI checks it on every push**, on the macOS runner:
  - `npm run dist:mac` builds the app;
  - `npm run check:signatures -- --app out/mac-arm64/beuve.app` (`scripts/check-signatures.ts`) passes: `codesign --verify --deep --strict` on the app, `codesign --verify --strict` on `Contents/Resources/node/node`, and the binary's team identifier equals `macTeamId` in `scripts/node-runtime.json` (`HX7739G8FX`, public, so not a secret); it also prints the entitlements and an informational `spctl --assess`;
  - `npm run check:packaged` passes.

  The release workflow runs the same two scripts on the artifact it uploads.

## Consequences

The bundled Node behaves as upstream's does, with the same entitlements under any beuve signing mode, so probes don't depend on how beuve was signed. beuve doesn't vouch for the binary with its own identity, and a Node bump changes the signer's certificate only if the Foundation does. Not verified yet:

- **Notarization** needs Apple credentials beuve doesn't have. It is also a known risk for this decision. Apple's notary service normally rejects any executable whose entitlements include `get-task-allow`, and the Foundation's 26.13.0 binary carries it. If the first notarized build is refused for this reason, the fallback is to re-sign the binary as beuve:
  - `signIgnore` it from electron-builder's pass;
  - sign it in an `afterSign` step with a Node-only entitlements file: Node's entitlements minus `get-task-allow`;
  - amend this ADR.

  Ad-hoc builds, today's default, are unaffected.

- **First launch of a quarantined, ad-hoc build that spawns the nested Node** needs a person at a Mac. Gatekeeper may assess the quarantined `node` separately from the app, though `xattr -dr com.apple.quarantine` (docs/packaging.md) clears it with the rest of the bundle.
