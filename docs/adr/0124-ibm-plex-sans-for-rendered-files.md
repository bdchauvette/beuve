# 0124. IBM Plex Sans for rendered files, and a prose font setting

- Status: Accepted; amends [0122](0122-themes-are-edited-in-the-source.md)
- Date: 2026-11-09

## Context

ADR 0123 renders Markdown files in their cards and sheets. They first used the interface font, `system-ui`, which ADR 0122 keeps for beuve's own labels, lists and panels because those are dense and sized against system fonts at 13 px. A rendered README is not interface: it is a document read at length, in its own column, and should not look like the chrome around it. Which system sans a machine has also varies more for long reading than for labels (San Francisco on macOS, Cantarell, Ubuntu or DejaVu Sans on Linux).

## Decision

- **IBM Plex Sans 1.1.0** (SIL Open Font License 1.1) is the prose font of rendered files. `--beuve-font-family-prose` names the reviewer's preference first, then `'IBM Plex Sans'`, then the interface stack; `--beuve-font-prose` is the shorthand at the body size (14 px) with the relaxed line height. `beuve-rich-view`'s document uses it; its code still uses the code font.
- **Bundled, unmodified.** Four static faces from the `@ibm/plex-sans` package, `fonts/complete/woff2/`: regular, italic, semibold and semibold italic, as `src/ui/fonts/ibm-plex-sans*.woff2` (about 265 KB). `index.css` declares them at weights 400 and 600, and esbuild's `file` loader copies them as it does Commit Mono (ADR 0121), so `font-src 'self'` is unchanged. The variable font (`@ibm/plex-sans-variable` 0.2.0) was passed over: it is a pre-1.0 package and twice the size with scripts beuve does not need. Bold text in a rendered file (`strong`, `b`, `dt`, headings, table headers) takes the semibold face, so no weight is synthesized.
- **Attribution.** "Plex" is a Reserved Font Name, which the OFL lets unmodified copies keep. `index.css` names the work and its license in a `/*! … */` comment, and `THIRD_PARTY_NOTICES.md` has the full license text.
- **A prose font setting** (amends ADR 0122): Settings › Fonts › Prose font, stored as `proseFont` beside `codeFont` and carried the same way (`display:get`/`display:set`, the same `font-family` list validation, `--beuve-preferred-prose-font` set on each window's root by `applyFonts`, which replaces `applyCodeFont`). It passes ADR 0122's test for a setting: it is a font, which depends on the machine and the reader, and without it the only way back to an installed font is a rebuild.
- **Only rendered files, for now.** Chat answers, pull request descriptions and note bodies are prose too, but they sit inside dense panels next to interface text; whether they take the prose font is left for later.

## Consequences

Documents read the same on every machine and look distinct from the interface. Plex Sans and the system sans differ in detail (Plex's angled terminals and squarer curves), which is the point at the document's edge, and shows only where the two meet inside it: the notes and findings slotted under regions keep the interface font. The app is about 265 KB larger. A file with Cyrillic, Greek or other scripts the faces lack falls back, glyph by glyph, to the interface font.
