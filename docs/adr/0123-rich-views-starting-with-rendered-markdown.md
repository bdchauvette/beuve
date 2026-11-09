# 0123. Rich views, starting with rendered Markdown

- Status: Accepted; amends [0067](0067-sheets-definitions-and-permalinks.md) (sheet channels) and [0077](0077-trusted-types-and-no-html-sinks-in-the-renderer.md) (a second sanctioned HTML path)
- Date: 2026-11-09

## Context

Reviewers read documentation changes as prose, and asked to see a Markdown file the way GitHub's "rich diff" shows it: rendered, with what changed marked, and with notes taken from the rendered text rather than from the source. Sheets (ADR 0067) should render Markdown too. Other file kinds (images, SVG, CSV, notebooks) will want the same treatment later, so the seam should not be Markdown-shaped.

Three things already fit. URA anchors are head-side line ranges (ADR 0023), and GitHub's own rich-diff comments land on source lines, so a note on a rendered paragraph is an ordinary `lines` anchor over that paragraph's source lines: exports, re-anchoring and outdating need no change. Every line action asks `targetFrom` (ADR 0063), so a view that feeds it a selection gets stage, add to chat, open in editor, permalinks, peek and flow for free. `session:get-file-pair` already returns a file's base and head contents.

The chat parser (ADR 0073) does not fit. It is a deliberate subset built for streaming. It leaves out raw HTML, images, reference links, setext headings, indented code, task lists, strikethrough and lazy continuation lines, all of which repository documents use (READMEs most of all). Reference definitions are document-wide and lazy continuation breaks its rule that a block's extent depends only on its own lines and the next. Its blocks carry source offsets only at the top level. A rendered view that renders a README wrong is worse than the source.

markdown-it 14 was checked against a sample document in a scratch install. Every block token carries a `[start, end)` line map, down to list items, nested list items, table rows (`tr`), quotes, HTML blocks and indented code; inline tokens and table cells carry none. Raw HTML that wraps Markdown (`<details>` … `</details>`) comes out as two `html_block` tokens with the Markdown between them, so a renderer that builds DOM token by token cannot nest it. markdown-it's own HTML renderer can. Its footnote and emoji plugins were checked the same way: a footnote definition keeps its paragraph's line map, and the emoji set covers GitHub's Unicode shortcodes but not GitHub's image emoji.

## Decision

- **Rich views by file kind.** `richViewKindFrom(path)` names a file's rich view: `markdown` for `.md` and `.markdown` (any case), nothing else yet. A file card or sheet whose file has a kind opens **rendered**. A Rendered/Source segmented control in the card's header and in the sheet's, and Toggle Rendered View (View › Diff, ⇧⌘M / Ctrl+Shift+M, main and sheet windows, ADR 0068), switch it. The choice is kept until the card or sheet shows another path. It is not a preference.
- **Regions.** A rich view turns base and head into **regions**. Each region has a status (`unchanged`, `added`, `modified` or `removed`) and, when the kind has one, a source line range: on the head for the first three statuses, on the base for `removed`. Notes, targets, cursor steps and marks work on regions, so a kind only has to produce them. A kind without line ranges (an image) takes file notes only.
- **Status comes from the hunks** (`changeRunsFrom(patch)`, the runs of removed and added lines between context lines), never from a diff of rendered trees, so the rendered view and the source view always agree on what changed:
  - A head region is `added` when every one of its lines was added, `modified` when some were, or lines were removed inside it, else `unchanged` (`regionStatusFrom`). A paragraph whose every line was rewritten is therefore the old paragraph `removed` and the new one `added`.
  - A top-level base region whose lines were all removed is `removed`, shown before the head region at its run's place (`removedRegionsFrom`).
  - A modified top-level head region maps back to its base lines (`baseLinesFrom`). The base regions there that were not wholly removed are its previous version, which "Show previous version" inserts under it.
  - Word-level changes inside rendered prose are not shown.
- **Markdown regions** are the top-level blocks. List items, table rows and the blocks inside a quote are nested regions, so a note can take one item or one row. A raw HTML block is a region on its block's lines, widened to a later block that closes it (`<details>` … `</details>`). A selection across regions takes the union of their lines. Nothing finer than a region is anchored.
- **Parser: markdown-it 14** (a new dependency; MIT, no install script, runtime dependencies `entities`, `linkify-it`, `mdurl`, `punycode.js` and `uc.micro`). It runs with `html: true` and `linkify: true`, and with CommonMark plus GFM tables and strikethrough, which are built in. In-house rules add task lists (`[ ]`/`[x]` as a `data-task` glyph, never an input), GitHub alerts (`> [!NOTE]` … as `data-alert`), and YAML front matter, which shows as a `yaml` code block. Two official plugins add the rest, and neither has dependencies or an install script:
  - `markdown-it-footnote` 4 adds footnotes. Definitions render at the end, as GitHub shows them, and each one's paragraph is a region on its own source lines. Its ids become anchors like any other id (below). It ships no types for its ESM line, so `types/dom/markdown-it-footnote.d.ts` declares it.
  - `markdown-it-emoji` 3 adds emoji shortcodes, using its `full` set of 1,903 names (`:tada:`, `:+1:`, `:technologist:`), with emoticon shortcuts turned off (`shortcuts: {}`), because GitHub leaves `:)` alone. GitHub's image emoji (`:shipit:`, `:octocat:` and the like) are not Unicode and stay text.
  - Math is not supported and shows as text.

  The chat keeps its own streaming parser (ADR 0073), so beuve has two Markdown renderers, one for model text and one for repository files.

- **Rendering goes through a sanctioned HTML path** (ADR 0077, amended below):
  - A core rule writes each block's line map into `data-source-lines="<nonce>:a-b"`, and each raw HTML block is preceded by a `<span data-html-lines>` marker. The nonce is a fresh `crypto.randomUUID()` per render, so a value the file's own HTML writes is dropped.
  - Inside raw HTML tags, `on…=` attributes are renamed `data-dropped-on…` (`withoutHandlers`). This is not a defence: the sanitizer removes them either way. Chromium reports an inline handler to the CSP as it parses one, even into an inert document, and a file should not raise violations.
  - markdown-it's HTML is parsed with `Document.parseHTML(html, { sanitizer: markdownSanitizerConfig })`, the Sanitizer API's safe parse into an inert document, which removes scripts, handlers and `javascript:` URLs on top of the allow-list. Nothing in that document is live, so nothing loads before the nodes are rewritten and adopted.
  - The allow-list (`markdown-sanitizer-config.ts`): GFM's elements plus `section`, `details`, `summary`, `div`, `span`, `kbd`, `samp`, `var`, `sub`, `sup`, `ins`, `del`, `mark`, `abbr`, `dfn`, `cite`, `q`, `small`, `b`, `i`, `u`, `s`, `ruby`/`rt`/`rp`, `dl`/`dt`/`dd`, `figure`/`figcaption`, `picture`, `caption`, `tfoot`, `bdi` and `wbr`. `center`, `font`, `big`, `nobr`, `tt`, `strike`, `blink` and `marquee` are replaced by their children. Global attributes are `title`, `align`, `lang`, `dir`, `id` and beuve's own `data-source-lines`, `data-html-lines`, `data-task` and `data-alert`. Per element: `a` `href` and `name`, `img` `src`, `alt`, `width` and `height`, `code` `class`, `li` `value`, `ol` `start`, `type` and `reversed`, `td`/`th` `colspan` and `rowspan` (`th` `scope`), and `details` `open`. There is no `style`, no other `class`, and no other `data-*`.
- **Before the nodes are adopted** beuve's code rewrites them (`markdownDocumentFrom`):
  - Every `id` and `<a name>` becomes `data-anchor`, with GitHub's `user-content-` prefix dropped. Headings take GitHub's slugs (`headingSlugsFrom`). Nothing in a file sets an id.
  - Every link loses its `href` and carries `data-action="link"` with what `linkTargetFrom` made of it. An `http(s)` URL (through `safeHrefFrom`) opens through `beuve-open-url`, which main opens as it does a chat answer's links. A `#fragment` scrolls the view. A relative path names a file of the repository (with the line of `#L<n>`): a card opens it in a sheet at the head, and a sheet shows it in place, joining its history. Anything else (`javascript:`, `mailto:`, protocol-relative, outside the repository) keeps only its text. The window never navigates.
  - Every image loses its `src`, as described under Images.
  - A code block carries `data-code-language`. After insertion a fence becomes `beuve-sheet-code` in compact mode (ADR 0073), except a `mermaid` fence, which becomes a diagram.
- **Images.** A relative image is read at a commit through a new channel, `media:get-image { sessionId, sha, path }`. Main checks that the commit is a full sha of the session's repository and that the path is repository-relative (as `sheet:get-file` does). It decides the type from the bytes, never the name (`imageTypeFrom`: PNG, JPEG, GIF, WebP, or SVG, which is script-free as an `<img>`), and returns a `data:` URI. It answers `not-found` for no file there, and `unsupported` for anything else or for more than 8 MiB, which the view shows as a placeholder. A card reads head images at the session head and a removed block's at the review's `baseSha`, once per commit and path. A sheet reads at its own commit. An image `data:` URI written in the file is kept. A remote image is never loaded: it shows as its alt text and host, with the URL as the tooltip. Loading remote images would tell third parties when a review is being read and would need a wider CSP. Many would not load anyway, since private-repository attachments need GitHub's signed URLs.
- **Notes from the rendered view.**
  - Hovering a region shows the note button (the icon of ADR 0100) in the margin, placed with CSS anchor positioning. Its click selects the region and emits `beuve-note-add` with the anchor `anchorFromTarget` makes of it, as the gutter button does (ADR 0101).
  - A click on a region, or a text selection across regions, makes their lines the card's selection, so every line action (`targetFrom`, ADR 0063) works unchanged. A `removed` region is a base-side selection, which anchors to the head line before it (ADR 0063).
  - Suggest Edit switches the card to source, where the editor opens on those lines.
  - Staged notes, `/review` findings and the composer are the card's own elements, slotted in under the top-level region that holds their last line, so they look and act as they do in the diff.
  - When a note's lines lie outside every hunk of the file, the composer says so: GitHub takes inline comments only on lines its diff shows, so such a note goes in the review body (ADR 0023).
- **Mermaid** (`mermaid` 12, a new dependency):
  - It is large: 116 packages installed, among them d3, cytoscape, elkjs, katex, dompurify and marked, about 5.5 MB minified, split by esbuild into lazy chunks. It parses untrusted repository text.
  - It loads only when a view first holds a `mermaid` fence, and draws one diagram at a time with `securityLevel: 'strict'` and `htmlLabels: false`. `htmlLabels` is added to Mermaid's `secure` keys, so an `%%{init}%%` directive cannot turn HTML labels back on. Labels pass through `withoutHandlers` too.
  - Its SVG output is shown as an `<img>` from a `data:image/svg+xml` URI, at its natural width, and never joins the document. An SVG shown as an image runs no script and reaches nothing in the page, so a flaw in Mermaid's own sanitizing ends at a picture.
  - Mermaid's measuring step does add a temporary node to the document. Mermaid is imported with `globalThis.trustedTypes` hidden (and restored after), because the DOMPurify inside it reads the factory once, as its module loads, and would otherwise create a `dompurify` policy, which the CSP refuses. Without one, Mermaid's markup goes through beuve's `default` policy like every other library's. The CSP (`script-src 'self'`) blocks inline script and handlers either way.
  - Diagram text cannot be selected or found. A diagram is drawn again when the color scheme changes.
  - A fence that fails to parse shows as code, with Mermaid's error under it.
  - The diagram is one region on the fence's lines. "Show previous version" draws the base's diagram.
- **Navigation.** `j`/`k` step over hunks as in source. In a rendered card each step outlines the region of the hunk's changed lines, or, for a hunk that only removes, the removed region (`hunkTargetFrom`). A citation, flow or dock jump outlines its line's region.
- **Find in review** (ADR 0051) searches the source, as now, in rendered cards too. A hit in a rendered card outlines the region that holds its line, without switching the card to source.
- **Sheets** render Markdown by default, with the same toggle.
  - Regions are tinted from the sheet's marks (`changeRunsFromMarks`). A sheet has no base text, so it shows no removed regions.
  - The line cursor outlines its region. ↑/↓, Next/Previous Change and find hits reveal regions.
  - Relative links show their target in the same sheet and join its history. A web link is copied to the clipboard with a notice, since a sheet opens nothing else.
  - Sheets stay read-only (ADR 0067). Staged notes at the session head show as quiet lines under their regions, but a sheet still cannot stage one.
  - `media:get-image` is added to `sheetInvokeChannels`, deliberately.
- **Permalinks.** Line links to a file GitHub renders (`.md`, `.markdown` and the other markups: `.mdown`, `.mkdn`, `.mkd`, `.mdwn`, `.rst`, `.adoc`, `.asciidoc`, `.org`, `.textile`, `.rdoc`, `.ipynb`) add `?plain=1`, so GitHub shows the source lines the anchor names instead of the rendered file. A link to the whole file stays rendered.
- **Where it lives.**
  - The generic part is `src/ui/rich-view/`: `richViewKindFrom`, the change runs, `regionStatusFrom`, `removedRegionsFrom`, `baseLinesFrom`, `hunkTargetFrom`, the link and image targets, the slugger, and `beuve-rich-view`, which builds, tints and hydrates a document and handles regions, notes and links.
  - Markdown's part is `src/ui/rich-view/markdown/`: `createMarkdownIt`, `markdownSanitizerConfig`, `markdownDocumentFrom`, `withoutHandlers` and `renderMermaidDiagram`.
  - Everything but the element and the DOM rewrite is pure and Vitest-tested without a DOM. markdown-it, its plugins and Mermaid are lazy chunks.
  - Main's side is `src/main/sheets/` (`imageTypeFrom`, `readRepositoryImage`, `getImage`).
  - `check-hostile-render` (ADR 0077) renders `docs/hostile.md` in the built app: raw HTML with handlers, forged source lines, styles, classes and clobbering ids, `javascript:`, `data:` and protocol-relative links, remote and escaping images, SVG with script, frames, forms, `base` and `meta`, a footnote, and a Mermaid diagram with an `%%{init}%%` directive and hostile labels, followed by the corpus lines. It checks that nothing unsafe is in the page, that no link keeps an `href`, that no image comes from elsewhere, and that no CSP violation is raised.

## Consequences

- Documentation changes read as documents by default. Notes taken on the rendered text are ordinary line notes, so posting, exporting and outdating behave exactly as in source.
- A new rich view means implementing regions for one more kind. Cards, sheets, notes and targets don't change.
- A rewritten paragraph shows as removed and added; a partly changed one is modified, with its previous version on demand. A table edit marks only its rows. There are no word-level highlights.
- A note can't take less than a list item, a table row or a paragraph from the rendered view; finer notes need the source toggle.
- Raw HTML behaves as HTML: an unclosed `<textarea>`, `<xmp>` or comment swallows the rest of the document, which then shows as little or nothing, never as markup.
- READMEs that rely on remote images or badges show placeholders. GitHub's image emoji and math show as text. In an interdiff, a removed block's images are read at the review's `baseSha`, which may not be the commit the removed text came from.
- A find hit in a rendered card points at a region, not at the exact characters; the source toggle shows them.
- Mermaid is most of the new dependency weight (the lazy renderer chunks grow by about 9 MiB), and most of what `npm audit` will report on. It costs nothing until a view holds a diagram. Hiding `trustedTypes` while it loads is a workaround for a library that reads the factory at import; a Mermaid or DOMPurify upgrade must be checked against the hostile render again.
- beuve takes dependencies (markdown-it, two of its plugins, and Mermaid) and maintains two Markdown renderers that may disagree on edge cases. Model text stays on the streaming parser, which never produces HTML. Repository text goes through the Sanitizer allow-list, a second reviewed path that turns strings into markup.

## Open question

- Should sheets ever stage notes? That would amend ADR 0067's channel list. This ADR keeps them read-only.
