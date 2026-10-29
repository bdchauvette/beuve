# Packaging beuve

How to build the app, and what each build is good for. The decisions behind this are in [ADR 0048](adr/0048-packaging-signing-and-release.md) and, for CI, versions, releases and Homebrew, [ADR 0049](adr/0049-ci-matrix-releases-and-homebrew-cask.md).

## Commands

| Command                  | Runs on | Produces                                                                                                 |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| `npm run dist:mac`       | macOS   | `out/beuve-<version>-mac-arm64.dmg` and `.zip` (Apple silicon only)                                      |
| `npm run dist:linux-dir` | Linux   | `out/linux-unpacked/beuve`, an unpacked app for smoke tests                                              |
| `npm run dist:linux`     | Linux   | `out/beuve-<version>-linux-x86_64.AppImage`                                                              |
| `npm run build:icon`     | any     | `build/icon.icns` and `build/icon.png` from `scripts/build-icon.ts` (committed; rerun after changing it) |

Each `dist:*` command runs `npm run build` first. The configuration is `electron-builder.yml`.

## Signing and notarization

`dist:mac` signs and notarizes only when credentials are in the environment, and prints which case it is in:

| Environment                                                                                     | Result                                              |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| none                                                                                            | ad-hoc signed, no hardened runtime, not notarized   |
| `CSC_LINK` + `CSC_KEY_PASSWORD` (or `CSC_NAME`)                                                 | Developer ID signed with the hardened runtime       |
| the above + `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`                          | signed, notarized with notarytool and stapled       |
| the above + `APPLE_API_KEY` (path to `AuthKey_XXXX.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | signed, notarized with an App Store Connect API key |
| the above + `APPLE_KEYCHAIN_PROFILE` (from `xcrun notarytool store-credentials`)                | signed, notarized with a stored keychain profile    |

`CSC_LINK` is the "Developer ID Application" certificate with its private key, exported from Keychain Access as a `.p12`, given as a path or as base64 text. `CSC_NAME` names one that is already in your login keychain, for example `Developer ID Application: Your Name (TEAMID)`.

beuve is for personal use for now, so the default is the first row: there is no Developer ID, and the release workflow (`.github/workflows/release.yml`) builds an ad-hoc artifact without any secrets. The signed rows stay available. To use them, export the variables before `npm run dist:mac`, or add them as repository secrets and pass them in the workflow's `dist:mac` step.

## Ad-hoc builds for personal use

An ad-hoc build runs on the Mac that built it. Anywhere else, Gatekeeper blocks it: a downloaded copy carries the `com.apple.quarantine` attribute, and an app without a Developer ID signature and a notarization ticket is reported as damaged or from an unidentified developer.

To use one on your own Mac, pick one of these:

- Open `beuve.app` once, then allow it under System Settings › Privacy & Security › "Open Anyway". On macOS 14 and earlier, Control-click › Open also works; on macOS 15 and later it no longer bypasses Gatekeeper.
- Remove the quarantine attribute, as below.

```sh
npm run dist:mac
open out/beuve-*-mac-arm64.dmg      # drag beuve to /Applications
xattr -dr com.apple.quarantine /Applications/beuve.app   # only if the dmg or zip was downloaded
```

If you changed the bundle after the build (for example, edited a file inside it), re-sign it ad hoc:

```sh
codesign --force --deep --sign - /Applications/beuve.app
codesign --verify --deep --strict --verbose=2 /Applications/beuve.app
```

`--deep` is fine for this local, ad-hoc case. Developer ID builds are signed inside-out by electron-builder instead, and must not be re-signed with `--deep`. Removing the quarantine attribute tells macOS you trust that copy. Don't do it for builds you didn't make.

## Releasing

`package.json` is the source of truth for the version. From a clean, up-to-date `main`:

```sh
npm version patch        # or minor, major, or prerelease --preid beta (e.g. 0.2.0-beta.1)
git push --follow-tags   # pushes main and the v<version> tag that npm version created
```

`npm version` bumps `package.json` and `package-lock.json`, commits, and tags `v<version>`. Pushing the tag starts `release.yml`, which:

1. Fails if the tag (without the `v`) differs from `package.json`'s version.
2. Runs `npm run check` and `npm run dist:mac` on an Apple silicon runner (ad-hoc signed, no secrets).
3. Writes `SHA256SUMS` for the dmg and zip.
4. Generates release notes from the conventional commits since the previous `v*` tag (`scripts/release-notes.ts`: Features, Fixes, Performance, Refactoring, Documentation, Other changes) and publishes a GitHub Release, not a draft, with the dmg, zip and `SHA256SUMS` attached. A version with a suffix (`0.2.0-beta.1`) is marked as a prerelease and leaves the Homebrew cask alone.
5. For a full release, downloads the published zip, hashes it, and pushes `chore(cask): beuve <version>` to `main` with the new `version` and `sha256` in `Casks/beuve.rb`. (A push made with `GITHUB_TOKEN` starts no workflows, and only tags start a release, so this cannot loop.)
6. Installs the cask from the tap on a macOS runner as a smoke test.

Where things appear: the release at `https://github.com/bdchauvette/beuve/releases`, and a `beuve-<version>-mac-arm64` artifact on the workflow run (kept 90 days). Pull the cask commit (`git pull`) before your next release.

A manual run of the workflow (Actions › Release › Run workflow) on a branch builds `<package version>-dev.<short sha>` and uploads the artifact only: no release, no cask change.

If the guard step fails, delete the tag (`git push --delete origin v<x>` and `git tag -d v<x>`), fix the version, and tag again.

## Installing with Homebrew

An app is a Homebrew _cask_, and a _tap_ is a git repository that holds casks. The tap is this repository: the cask is `Casks/beuve.rb`. Because the repository isn't named `homebrew-<something>`, tapping needs the URL:

```sh
brew tap bdchauvette/beuve https://github.com/bdchauvette/beuve
brew install --cask beuve
```

Homebrew 6 and later require you to trust a non-official tap. Installing by full name trusts just this cask, and works without tapping first: `brew install --cask bdchauvette/beuve/beuve`. Upgrade with `brew upgrade --cask beuve`, remove with `brew uninstall --cask beuve`, and `brew uninstall --zap --cask beuve` also removes `~/Library/Application Support/beuve` (the database, settings and worktrees), preferences, caches and saved state.

The cask installs the zip rather than the dmg: Homebrew unpacks it directly, with no volume to mount. It requires Apple silicon and macOS 13 or later.

Trade-offs of using this repository as the tap: `brew tap` clones the whole application repository, and a cask change is a commit to `main`. A dedicated `bdchauvette/homebrew-tap` repository would hold only casks and allow `brew tap bdchauvette/tap`. Moving there later means moving `Casks/beuve.rb` and pointing the release workflow's cask step at it, with a token that can push to that repository.

### Gatekeeper and Homebrew

Homebrew removed `--no-quarantine`, and beuve is ad-hoc signed and not notarized, so macOS blocks the first launch of a quarantined copy. The cask deliberately does not remove the quarantine attribute (ADR 0049, amendment of 2026-10-29); that is your decision. After the first blocked launch, either:

- Open System Settings › Privacy & Security, scroll to the message about beuve and click "Open Anyway" (it stays available for about an hour after the blocked launch). Control-click › Open no longer bypasses Gatekeeper on macOS 15 and later.
- Or run `xattr -dr com.apple.quarantine /Applications/beuve.app`.

A Developer ID signed and notarized build would make this unnecessary.

## What's in the app

`app.asar` holds the esbuild output (`dist/`, without source maps) and `package.json`. `app.asar.unpacked` holds `typescript` and `typescript-language-server`, which main runs with `ELECTRON_RUN_AS_NODE=1` from the real file system. Run from inside the archive, tsserver reports wrong diagnostics. Nothing else from `node_modules` ships, because the bundles already contain it. After upgrading either package, rebuild `dist:linux-dir` and check that `p` (peek) and the MCP `beuve_get_lsp_diagnostics` tool still work in the packaged app.

In a packaged app, `BEUVE_GITHUB_API_URL` and `BEUVE_EDITOR_LAUNCH_LOG` are ignored, and the log says so. `BEUVE_CLAUDE_PATH`, `BEUVE_GH_PATH`, `BEUVE_MCP_PORT` and `BEUVE_LOG_LEVEL` keep working. A macOS app started from Finder doesn't see your shell's variables. Use `launchctl setenv` or launch it from a terminal with `open -a beuve`.

## Smoke testing on Linux

```sh
npm run dist:linux-dir
xvfb-run -a out/linux-unpacked/beuve          # add --no-sandbox only when running as root, on the command line
```
