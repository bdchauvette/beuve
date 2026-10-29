# Packaging beuve

How to build the app, and what each build is good for. The decisions behind this are in [ADR 0048](adr/0048-packaging-signing-and-release.md).

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

beuve is for personal use for now, so the default is the first row: there is no Developer ID, and the release workflow (`.github/workflows/release.yml`) builds and uploads an ad-hoc artifact without any secrets. The signed rows stay available. To use them, export the variables before `npm run dist:mac`, or add them as repository secrets and pass them in the workflow's `dist:mac` step.

## Ad-hoc builds for personal use

An ad-hoc build runs on the Mac that built it. Anywhere else, Gatekeeper blocks it: a downloaded copy carries the `com.apple.quarantine` attribute, and an app without a Developer ID signature and a notarization ticket is reported as damaged or from an unidentified developer.

To use one on your own Mac, pick one of these:

- In Finder, Control-click (or right-click) `beuve.app`, choose Open, then Open again in the dialog. macOS remembers the choice. On macOS 15 and later, open it once, then allow it under System Settings › Privacy & Security › "Open Anyway".
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

## What's in the app

`app.asar` holds the esbuild output (`dist/`, without source maps) and `package.json`. `app.asar.unpacked` holds `typescript` and `typescript-language-server`, which main runs with `ELECTRON_RUN_AS_NODE=1` from the real file system. Run from inside the archive, tsserver reports wrong diagnostics. Nothing else from `node_modules` ships, because the bundles already contain it. After upgrading either package, rebuild `dist:linux-dir` and check that `p` (peek) and the MCP `beuve_get_lsp_diagnostics` tool still work in the packaged app.

In a packaged app, `BEUVE_GITHUB_API_URL` and `BEUVE_EDITOR_LAUNCH_LOG` are ignored, and the log says so. `BEUVE_CLAUDE_PATH`, `BEUVE_GH_PATH`, `BEUVE_MCP_PORT` and `BEUVE_LOG_LEVEL` keep working. A macOS app started from Finder doesn't see your shell's variables. Use `launchctl setenv` or launch it from a terminal with `open -a beuve`.

## Smoke testing on Linux

```sh
npm run dist:linux-dir
xvfb-run -a out/linux-unpacked/beuve          # add --no-sandbox only when running as root, on the command line
```
