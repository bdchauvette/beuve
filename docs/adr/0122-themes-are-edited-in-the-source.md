# 0122. Themes are edited in the source; the code font is a setting

- Status: Accepted (code font setting built, amendment 2026-11-06)
- Date: 2026-11-06

## Context

beuve is a home-cooked tool. Like the suckless tools, it would rather be changed by editing its source and rebuilding than grow a setting for every taste. ADR 0114's last amendment removed the diff color schemes on those grounds, and left open whether that was a rule. It needs to be one, so that later work does not add a theme setting, or a user stylesheet, piecemeal. Fonts are different. Which fonts are installed, and which read well on a given display, depends on the machine, and a rebuild per machine is not a fair price for that.

## Decision

- **Themes are not settings.** Colors are changed by editing `src/ui/index.css` and rebuilding. That covers the Radix scales, the semantic and diff tokens, and what derives from them: the syntax palette in `syntax-palettes.ts`, the window backgrounds main paints before the page, the terminal colors. There is no theme or color setting, no user stylesheet, and no alternative token set chosen at run time.
- **Light and dark follow the system**, through `color-scheme: light dark` and `light-dark()` (ADR 0114). That is not a theme choice, so it stays. An in-app override of the system appearance would be a theme setting, and is out.
- **The source stays easy to edit.** Every Radix step stays listed whether or not anything reads it. Colors live only in `index.css` (and the hex copies that ADR 0119 and the window palettes need), and components use semantic tokens, so a theme change is a small edit in one place.
- **The code font is outside this rule; the interface font is the system's.** Which fonts are installed, and which reads well for code, depends on the machine and the reader, and beuve bundles its own code font (Commit Mono, ADR 0121), which wins over the system's monospace font. So a code font setting is allowed: without one, the only way back to your own is a rebuild. The interface font is `system-ui`, which already follows the OS (the desktop's interface font on Linux, San Francisco on macOS), so a beuve setting would repeat a system one. The dense views are also sized against system fonts at 13 px, and a wide face would clip labels in ways a monospace swap does not. There is no interface font setting. Text size is not part of this: View › Zoom already covers it.

## Consequences

A reviewer who wants other colors needs a checkout and a build, which beuve's reviewer has anyway. Theme work never touches the settings file, the IPC contract or the Settings window. A proposal for a new appearance setting has to say why it is like fonts (it depends on the machine) rather than like themes (it is taste).

## Amendment 2026-11-06: the code font setting

Settings › Fonts › Code font, stored as `codeFont` in `settings.json` and carried by `display:get`/`display:set`, is a CSS `font-family` list, or empty for Commit Mono. "Code font" is the name throughout (the setting, the IPC field, the `--beuve-font-family-code` and `--beuve-font-code` tokens), not "monospace": it is the font code is read in.

- **Fallbacks stay.** `index.css` builds `--beuve-font-family-code` as `var(--beuve-preferred-code-font, 'Commit Mono')` followed by Commit Mono and the system monospace stack. A family the machine does not have falls through to the bundled or system font, and nothing else in the renderer changes.
- **Applied per window.** `applyCodeFont` sets or clears `--beuve-preferred-code-font` on the root of the main, Settings and sheet windows, which every shadow root inherits. The main window applies it whenever the display preferences load or change. A sheet window reads them when it opens and when it is focused again, since sheets get no `settings:changed`. The terminal watches the root's style and gives open xterms the new family once it has loaded.
- **Validated as a family list.** `isFontFamilyList` (`src/contract/`) accepts quoted names and runs of identifiers separated by commas, at most 200 characters, and refuses parentheses, semicolons, braces, backslashes, control characters and CSS-wide keywords. So a value cannot hold a `var()` or `url()` or end the declaration. `display:set` refuses anything else, and a stored value that fails reads as empty.
- **No font files.** The setting names installed fonts. Loading a font file from elsewhere would need `font-src` widened, which this does not do.
