# 0123. Rich views, starting with rendered Markdown

- Status: Proposed
- Date: 2026-11-09

## Context

Reviewers read documentation changes as prose, and asked to see a Markdown file the way GitHub's "rich diff" shows it: rendered, with what changed marked, and with notes taken from the rendered text rather than from the source. Sheets (ADR 0067) should render Markdown too. Other file kinds (images, SVG, CSV, notebooks) will want the same treatment later, so the seam should not be Markdown-shaped.

Three things already fit. URA anchors are head-side line ranges (ADR 0023), and GitHub's own rich-diff comments land on source lines, so a note on a rendered paragraph is an ordinary `lines` anchor over that paragraph's source lines: exports, re-anchoring and outdating need no change. Every line action asks `targetFrom` (ADR 0063), so a view that feeds it a selection gets stage, add to chat, open in editor, permalinks, peek and flow for free. `session:get-file-pair` already returns a file's base and head contents.

The chat parser (ADR 0073) does not fit. It is a deliberate subset built for streaming. It leaves out raw HTML, images, reference links, setext headings, indented code, task lists, strikethrough and lazy continuation lines, all of which repository documents use (READMEs most of all). Reference definitions are document-wide and lazy continuation breaks its rule that a block's extent depends only on its own lines and the next. Its blocks carry source offsets only at the top level. A rendered view that renders a README wrong is worse than the source.

markdown-it 14 was checked against a sample document in a scratch install. Every block token carries a `[start, end)` line map, down to list items, nested list items, table rows (`tr`), quotes, HTML blocks and indented code; inline tokens and table cells carry none. Raw HTML that wraps Markdown (`<details>` … `</details>`) comes out as two `html_block` tokens with the Markdown between them, so a renderer that builds DOM token by token cannot nest it. markdown-it's own HTML renderer can.

## Decision

- **Rich views by file kind.** `richViewKindFrom(path)` names a file's rich view: `markdown` for `.md` and `.markdown` (any case), nothing else yet. A file card or sheet whose file has a kind opens **rendered**. A per-card Source/Rendered toggle (a catalog command with a menu item, ADR 0068) switches it, kept in memory for the session. It is not a preference.
- **Regions.** A rich view turns base and head into **regions**. Each region has a status (`unchanged`, `added`, `modified` or `removed`) and, when the kind has one, a source line range: on the head for the first three statuses, on the base for `removed`. Notes, targets, cursor steps and marks work on regions, so a kind only has to produce them. A kind without line ranges (an image) takes file notes only.
- **Status comes from the hunks**, never from a diff of rendered trees, so the rendered view and the source view always agree on what changed:
  - A head region is `added` when every line in it was added, `modified` when any of its lines changed, else `unchanged`.
  - A base region whose lines were all deleted is `removed`. It is placed before the head region that follows its deletion point.
  - A base region that was only partly deleted is the old version of the head region it became. That region's "Show previous" expands it in place.
  - Word-level changes inside rendered prose are not shown.
- **Markdown regions** are the top-level blocks. List items, table rows and the blocks inside a quote are nested regions, so a note can take one item or one row. A selection across regions takes the union of their lines. Nothing finer than a region is anchored.
- **Parser: markdown-it 14** (a new dependency; MIT, no install script, runtime dependencies `entities`, `linkify-it`, `mdurl`, `punycode.js` and `uc.micro`). It runs with `html: true` and `linkify: true`, and with CommonMark plus GFM tables and strikethrough, which are built in. Task lists (`[ ]`/`[x]` shown as glyphs, never as inputs) and GitHub alerts (`> [!NOTE]` …) are small in-house rules. Footnotes, emoji shortcodes, math and Mermaid are not supported: they show as text or as code. The chat keeps its own streaming parser (ADR 0073), so beuve has two Markdown renderers, one for model text and one for repository files.
- **Rendering goes through the sanctioned HTML path** (ADR 0077):
  - A core rule writes each block token's line map into a `data-source-lines` attribute.
  - markdown-it's renderer produces an HTML string, and `element.setHTML(html, { sanitizer })` inserts it with `markdownSanitizer`. That is an allow-list: the elements GFM produces, plus `details`, `summary`, `kbd`, `sub`, `sup`, `ins`, `mark`, `abbr`, `br` and `img`. The attributes are `href`, `title`, `alt`, `src`, `align`, `width`, `height`, `colspan`, `rowspan`, `open`, `data-source-lines`, and `class` on `code` only.
  - No `style` and no `id` or `name` from the document (no DOM clobbering). Headings get ids from beuve's own GitHub-style slugger.
  - The CSP is unchanged and remains the backstop.
- **After insertion** beuve's code walks the nodes:
  - A fence becomes `beuve-sheet-code` in compact mode (ADR 0073).
  - Every `a` is rewritten. An `http(s)` link goes through `safeHrefFrom` and `beuve-open-link`. A `#fragment` scrolls within the view. A relative path to a file in the repository opens a sheet at the view's commit, at the line from `#L<n>` if there is one. Anything else keeps its text only. The window never navigates.
  - Every `img` is rewritten as described under Images.
- **Images.** A relative image is read at the view's commit through a new channel, `media:get-image { sessionId, sha, path }`. Main checks that the path is repository-relative, decides the type from the bytes (PNG, JPEG, GIF, WebP, or SVG, which is script-free as an `<img>`) and returns a `data:` URI. Above a size cap it answers `too-large` and the view shows a placeholder. A remote image is never loaded, by default or otherwise: it shows as a placeholder with its alt text and host. Loading remote images would tell third parties when a review is being read and would need a wider CSP. Many such images would not load anyway, since private-repository attachments need GitHub's signed URLs.
- **Notes from the rendered view.**
  - Hovering a region shows the note button in its margin (the icon of ADR 0100). It emits `beuve-note-add` with a `lines` anchor over the region's head lines, as the gutter button does (ADR 0101).
  - A `removed` region anchors to the head line before it, the pure-deletion rule of ADR 0063.
  - The rendered view feeds the card's cursor state (focused region, the reviewer's selection) to `targetFrom`, so every line action works unchanged.
  - Suggest (`e`) switches the card to source, with the composer on those lines.
  - A staged note shows as a marker beside the innermost region that holds its first line.
  - When a note's lines lie outside the pull request's commentable ranges, the composer says it will go in the review body (ADR 0023).
- **Navigation.** `j`/`k` step over changed regions, as they step over hunks in source.
- **Sheets** render Markdown by default, with the same toggle as a sheet-window command.
  - Region marks replace the gutter marks, and the line cursor becomes a region cursor.
  - Relative links show their target in the same sheet and join its history.
  - Sheets stay read-only (ADR 0067). Notes made at the session head show as markers, but a sheet still cannot stage one.
  - `media:get-image` is added to `sheetInvokeChannels`, deliberately.
- **Permalinks.** For a Markdown path with a line anchor, `permalinkFrom` adds `?plain=1`, so GitHub shows the source lines instead of the rendered file (to verify against GitHub before building).
- **Where it lives.**
  - The generic part is in `src/ui/rich-view/`: `richViewKindFrom`, the region model, `regionStatusesFrom(hunks, regions)` and the region cursor. Markdown's part is in `src/ui/rich-view/markdown/`.
  - Region status, placement and slugging are pure and Vitest-tested without a DOM.
  - markdown-it loads lazily, like `@pierre/diffs` (`load-diffs-library.ts`).
  - The hostile-input tests of ADR 0077 grow a Markdown corpus: script, event handlers, `javascript:` and `data:` links, SVG with script, clobbering ids, and nested `details`.

## Consequences

- Documentation changes read as documents by default. Notes taken on the rendered text are ordinary line notes, so posting, exporting and outdating behave exactly as in source.
- A new rich view means implementing regions for one more kind. Cards, sheets, notes and targets don't change.
- Prose rewrapped within a paragraph marks the whole paragraph modified. A table edit marks only its rows. There are no word-level highlights.
- A note can't take less than a list item, a table row or a paragraph from the rendered view; finer notes need the source toggle.
- A note on a part of the file the pull request diff doesn't show goes in the review body, which the composer says up front.
- READMEs that rely on remote images or badges show placeholders. Footnotes and Mermaid show as text and code.
- beuve takes a dependency and maintains two Markdown renderers that may disagree on edge cases. Model text stays on the streaming parser, which never produces HTML. Repository text goes through the Sanitizer allow-list, a second reviewed path that turns strings into markup.

## Open questions

- Should find in review (ADR 0051) search the rendered text of a rendered card, or the source as now, switching the card to source on a hit?
- Should sheets ever stage notes? That would amend ADR 0067's channel list. This ADR keeps them read-only.
- What is the image size cap? 8 MB is the working figure.
