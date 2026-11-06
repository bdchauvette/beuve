# 0122. Themes are edited in the source; fonts may be settings

- Status: Accepted (font setting built, amendment 2026-11-06)
- Date: 2026-11-06

## Context

beuve is a home-cooked tool. Like the suckless tools, it would rather be changed by editing its source and rebuilding than grow a setting for every taste. ADR 0114's last amendment removed the diff color schemes on those grounds, and left open whether that was a rule. It needs to be one, so that later work does not add a theme setting, or a user stylesheet, piecemeal. Fonts are different. Which fonts are installed, and which read well on a given display, depends on the machine, and a rebuild per machine is not a fair price for that.

## Decision

- **Themes are not settings.** Colors are changed by editing `src/ui/index.css` and rebuilding. That covers the Radix scales, the semantic and diff tokens, and what derives from them: the syntax palette in `syntax-palettes.ts`, the window backgrounds main paints before the page, the terminal colors. There is no theme or color setting, no user stylesheet, and no alternative token set chosen at run time.
- **Light and dark follow the system**, through `color-scheme: light dark` and `light-dark()` (ADR 0114). That is not a theme choice, so it stays. An in-app override of the system appearance would be a theme setting, and is out.
- **The source stays easy to edit.** Every Radix step stays listed whether or not anything reads it. Colors live only in `index.css` (and the hex copies that ADR 0119 and the window palettes need), and components use semantic tokens, so a theme change is a small edit in one place.
- **Fonts are outside this rule.** A setting for the monospace or UI font family is allowed, because the choice depends on what each machine has. None exists yet. Commit Mono is bundled as the default (ADR 0121), so the default reads the same everywhere. A font setting would set `--beuve-font-family-mono` or `-sans` on each window's root, as `diffColors` once did, and the terminal already reads its family from the token. Text size is not part of this: View › Zoom already covers it.

## Consequences

A reviewer who wants other colors needs a checkout and a build, which beuve's reviewer has anyway. Theme work never touches the settings file, the IPC contract or the Settings window. A proposal for a new appearance setting has to say why it is like fonts (it depends on the machine) rather than like themes (it is taste).

## Amendment 2026-11-06: the font setting

Settings › Fonts has a code font and an interface font, stored as `fontFamilyMono` and `fontFamilySans` in `settings.json` and carried by `display:get`/`display:set`. Each is a CSS `font-family` list, or empty for the default.

- **Fallbacks stay.** `index.css` builds `--beuve-font-family-mono` as `var(--beuve-preferred-font-family-mono, 'Commit Mono')` followed by Commit Mono and the system monospace stack, and `--beuve-font-family-sans` likewise ahead of the system font. A family the machine does not have falls through to the bundled or system font, and nothing else in the renderer changes.
- **Applied per window.** `applyPreferredFonts` sets or clears `--beuve-preferred-font-family-*` on the root of the main, Settings and sheet windows, which every shadow root inherits. The main window applies it whenever the display preferences load or change. A sheet window reads them when it opens and when it is focused again, since sheets get no `settings:changed`. The terminal watches the root's style and gives open xterms the new family once it has loaded.
- **Validated as a family list.** `isFontFamilyList` (`src/contract/`) accepts quoted names and runs of identifiers separated by commas, at most 200 characters, and refuses parentheses, semicolons, braces, backslashes, control characters and CSS-wide keywords. So a value cannot hold a `var()` or `url()` or end the declaration. `display:set` refuses anything else, and a stored value that fails reads as empty.
- **No font files.** The setting names installed fonts. Loading a font file from elsewhere would need `font-src` widened, which this does not do.
