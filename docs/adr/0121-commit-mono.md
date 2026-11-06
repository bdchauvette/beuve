# 0121. Commit Mono, bundled, for code

- Status: Accepted
- Date: 2026-11-06

## Context

Code, diffs, sheets, hashes and the terminal used the system monospace stack (`ui-monospace`, SF Mono, Menlo, Consolas). Which font that is depends on the machine, so the same diff reads differently on macOS and Linux, and ADR 0119's bold definitions and italic types depend on whatever bold and italic the system font has. beuve is configured by editing the source and rebuilding (ADR 0114's last amendment), so the font is a choice made here, not a setting.

## Decision

- **Commit Mono 1.143** by Eigil Nikolajsen (SIL Open Font License 1.1) is the monospace face: `--beuve-font-family-mono` names `'Commit Mono'` first, ahead of the old system stack as the fallback. It has a real italic and a weight axis from 200 to 700, so ADR 0119's bold, italic and bold italic come from the font, not from synthesis.
- **Bundled, not installed.** The files are `src/ui/fonts/commit-mono.woff2` (upright) and `commit-mono-italic.woff2`, about 60 KB each. `index.css` declares them in two `@font-face` rules, and the renderer build copies them to `dist/ui/fonts/` with esbuild's `file` loader. They load from `file://` like the stylesheet, so the CSP's `font-src 'self'` is unchanged, and `dist/**` already ships them. Storybook's Vite build resolves the same `url()`s. This is a copied work, not an npm dependency.
- **Two files made from upstream's variable font.** Upstream's repository ships `src/fonts/fontlab/CommitMonoV143-VF.woff2`, one file with a `wght` and an `ital` axis. Chromium does not set `ital` for `font-style: italic`, and ignores `font-variation-settings` in `@font-face`, so one file would show italics upright. The file was changed in two ways with fontTools:
  - A `calt` feature was added whose lookups are those of `ss03`, `ss04` and `ss05` (smart case, symbol spacing, smart kerning). These are the stylistic sets commitmono.com turns on by default, and `calt` is on by default everywhere. Setting `font-feature-settings` in CSS instead would have to reach every monospace element, and on `:root` would also turn on unrelated sets in the system sans. The character variants (`cv01`–`cv11`) and the ligature and arrow sets (`ss01`, `ss02`) stay off but available.
  - `varLib.instancer` then pinned `ital` to 0 and to 1, giving two variable fonts with only the weight axis.
    To redo or change this (another set, a newer release), repeat both steps on upstream's file and replace the two woff2 files.
- **font-display: block.** The font is local, so the wait is a frame, and code never flashes in the fallback font first.
- **The terminal** reads `--beuve-font-family-mono` from its computed style instead of its own hard-coded stack, and waits for `document.fonts.load` before opening each xterm, which measures the cell size when it opens.
- **Attribution.** The font's name table carries its copyright and the OFL notice. `index.css` names the work, its license and the changes in a `/*! … */` comment that esbuild keeps, and `THIRD_PARTY_NOTICES.md` has the full license text. The OFL allows modified versions. Commit Mono declares no Reserved Font Name, so the modified files keep their names.

## Consequences

Code looks the same on every machine, and the app is about 125 KB larger. Changing the monospace face means replacing the two files and the family name, or editing `--beuve-font-family-mono` to name an installed font. The modified files cannot be rebuilt from this repository alone: the steps above are recorded, not scripted, since fontTools is Python and beuve takes no Python dependency. ADR 0119's assumption that bold has the same advance width holds, because Commit Mono is strictly monospaced at every weight. The system sans stays as it was.
