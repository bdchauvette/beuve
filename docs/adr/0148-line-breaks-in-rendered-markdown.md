# 0148. Line breaks in rendered Markdown are kept, as GitHub keeps them

- Status: Accepted; amends [0073](0073-streaming-markdown-renderer.md)
- Date: 2026-11-20

## Context

ADR 0073's subset joins a paragraph's lines and lists hard line breaks as unsupported, so a line break renders as a space, as CommonMark and the GFM spec have it. Most of what beuve renders with it is not CommonMark documents but text written for GitHub's comment box: pull request descriptions, review threads and timeline comments. GitHub renders those with every line break kept. A description that ends in trailers (`Co-Authored-By:`, `Signed-off-by:`, a session link) ran them together into one line in beuve, where GitHub shows one per line. Chat answers, insights and notes are read beside those comments and are written the same way.

Language-server hovers are different: they carry doc comments wrapped at a fixed width, which editors render with soft breaks.

## Decision

- **A line break inside a paragraph is a `break` node.** `MarkdownInline` gains `{ kind: 'break' }`, which `createMarkdownNodes` renders as `<br>`. `parseMarkdownInline` emits one for each `\n` it reaches outside a code span, including inside emphasis and link text; a code span still turns its line breaks into spaces. This is GitHub's comment rendering, not the GFM spec's.
- **`lineBreaks: 'hard' | 'soft'`** on `parseMarkdown` and `parseMarkdownInline`, `hard` by default. `soft` keeps the old behavior: the break stays in the text and renders as a space. The hover card passes `soft`; everything else takes the default.
- Files previewed by the rich view (`markdown-it`, ADR 0123) are unchanged: GitHub renders `.md` files with soft breaks too.

## Consequences

Descriptions, comments, notes and answers break where their author broke them, as on GitHub. A hard-wrapped paragraph (a commit message wrapped at 72 columns pasted into a description) now shows its wrapping, as it does on GitHub. The streaming renderer still gives the same tree as a whole parse, since a break never spans blocks.
