# 0077. Trusted Types in the renderer, and no HTML string sinks in our code

- Status: Accepted. The owner approved the CSP and policy on 2026-10-30, after the findings below; they shipped with the hostile-input tests under Consequences.
- Date: 2026-10-30

## Context

The renderer's CSP (ADR 0018, amended by 0050) blocks injected scripts, but nothing stops a string that reaches `innerHTML` from carrying markup. Today beuve's own `src/ui` has no HTML string sinks. The Markdown renderer (ADR 0073), insights and chat build DOM nodes and use `textContent`. Lit renders through its built-in `lit-html` Trusted Types policy. The libraries are different: `@pierre/diffs` and `@pierre/trees` set `innerHTML` from strings they build. Trusted Types (`require-trusted-types-for 'script'`) makes every such sink go through a named policy, so the set of places that turn strings into markup is closed and reviewable.

### Prototype

The prototype ran in the real app: `npm run build`, then Electron 45 (Chromium 156.0.8078.49) under Xvfb with `--no-sandbox` on the throwaway command line only, driven over the DevTools protocol. The session covered:

- opening a local review of eight files (TypeScript, Rust, Python, Go, CSS, Markdown and a 60 000-line TypeScript file);
- the diff stream in split and unified views, uncollapsing and visiting every card, and scrolling;
- peek, the flow graph, an inline sheet and a sheet window;
- chat with a streamed Markdown answer holding two highlighted code blocks;
- the palette and the Settings window.

Violations were recorded with a `securitypolicyviolation` listener installed before the page's scripts, plus console messages and exceptions. The driver, raw results and patch are in the task scratchpad (`trusted-types/`).

- **With `require-trusted-types-for 'script'; trusted-types lit-html`:**
  - No diff renders: 0 code rows, against 1,894 without Trusted Types. Lit, peek, flow, chat, the palette and Settings are unaffected.
  - Every violation comes from the libraries, plus one from our own `new Worker`:

    | Sink                                    | Code                                                                                 | Content                                                                                      |
    | --------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
    | `Element innerHTML`                     | `@pierre/diffs` `File`/`FileDiff.ensureSpriteSVG`                                    | the icon sprite sheet                                                                        |
    | `Element innerHTML`                     | `@pierre/diffs` `replaceCodeColumns` / `applyCodeColumnsInPlace` / `applyFullRender` | `hastToHtml` output: gutter and code columns with per-token `style`, `data-*` and `grid-row` |
    | `Element innerHTML`                     | `@pierre/diffs` `InteractionManager.ensureGutterUtilityNode`                         | the gutter's utility button                                                                  |
    | `Element innerHTML`                     | `@pierre/trees` `FileTree`                                                           | its sprite sheet                                                                             |
    | `Element innerHTML`                     | `@pierre/trees` `slotHost`                                                           | slot HTML (empty in this session)                                                            |
    | `Worker constructor` (TrustedScriptURL) | `startWorkerPool` in `beuve-file-card.ts`                                            | `diff-worker/worker.js`                                                                      |

  - The sheet window shows the same diffs sinks. Settings shows none.
  - A recording pass-through `default` policy saw these call sites and no others. `insertAdjacentHTML`, `headerHTML`, worker `message.html` and the editor's marker HTML exist in `@pierre/diffs` but were not reached in this session (inline editing is off).
- **Named policies passed in:** not possible. Neither library takes a policy or a sanitizer hook (no `trustedTypes`/`createPolicy` in either `dist/`), so their sinks can only be served by a `default` policy.
- **Sanitizer API:** Chromium 156 has `Element.setHTML`, `ShadowRoot.setHTML`, `Document.parseHTML`, `parseHTMLUnsafe` and `Sanitizer`, checked in the renderer. A safe parse (`Document.parseHTML`) with a remove-list configuration renders every code row and token span unchanged. But it always removes SVG `<use>`, which is part of the built-in unsafe set, so every icon disappears (14 `<use>` left of 1,090). The unsafe parse, given a configuration, keeps `<use>`. It does not strip `javascript:` URLs, so the configuration has to remove the elements that carry them.
- **Rendering with the proposed policy:**
  - code rows, token spans and `<use>` counts identical to the run without Trusted Types (1,894 / 6,472 / 1,090 in split view);
  - the sheet window and inline sheet render;
  - no violations and no exceptions.
- **Cost:** measured on the strings the libraries assigned in that session (see Consequences). Sanitizing costs about as much as a plain parse and serialization, about 24 ms per MB of HTML here (Xvfb, software rendering).

## Decision

- **Lint (in effect now).** `src/ui` may not assign `innerHTML`, `outerHTML` or `srcdoc`, call `insertAdjacentHTML`, `createContextualFragment`, `setHTMLUnsafe`, `parseHTMLUnsafe`, `document.write` or `writeln`, or import Lit's `unsafe-html`, `unsafe-svg` or `unsafe-mathml` directives. This is `no-restricted-syntax` and `no-restricted-imports` in `eslint.config.js`; no new dependency. Reading `innerHTML` is not a sink and is not banned.
- **The sanctioned path.** If beuve ever needs to render an HTML string, it uses `element.setHTML(html, { sanitizer })`. That is the Sanitizer API's safe method, which needs no Trusted Types policy and always removes script-capable markup. TypeScript 6.0's DOM lib declares `Sanitizer` but not `setHTML`, `Document.parseHTML`, the options of `parseHTMLUnsafe` or Trusted Types, so `types/dom/trusted-types-and-sanitizer.d.ts` declares them for the renderer's project only.
- **CSP**, in `src/ui/index.html`, `sheet.html` and `settings.html` (one line each):

  ```
  …; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types lit-html default beuve-sanitizer-input
  ```

- **Policy:** `src/ui/install-trusted-types-policy.ts`. Each entry (`index.ts`, `sheet-entry.ts`, `settings-entry.ts`) calls it after its imports, before the first render.
  - `default.createHTML(html)`:
    - `Document.parseHTMLUnsafe(html, { sanitizer })`, where `sanitizer` is `new Sanitizer({ removeElements: [], removeAttributes: [] })` after `removeUnsafe()`, which removes scripts, frames and every event handler attribute. It also removes every navigating or submitting element (`a`, `area`, `base`, `form`, `input`, `select`, `textarea`, `meta`, `link`, and SVG `a`), the attributes that make a `<button>` submit (`formaction`, `action`, `form`; the gutter's utility button stays), and SVG animation (`animate`, `animateMotion`, `animateTransform`, `set`), so no `javascript:` URL survives.
    - Then it removes any `<use>` whose `href` is not a `#fragment` or that has an `xlink:href`.
    - Then it serializes with `body.getHTML()`.

    The libraries' HTML uses none of the removed elements.

  - `default.createScriptURL(url)`: only `diff-worker/worker.js` beside the page; anything else throws.
  - `beuve-sanitizer-input`: a pass-through `createHTML` that only the installer's closure holds; it is never exported or reachable from `window`. `parseHTMLUnsafe` is itself a Trusted Types sink, and calling it with a string from inside the default policy would recurse. The `trusted-types` list has no `'allow-duplicates'`, so once the entry has run, `createPolicy` throws for `default`, `beuve-sanitizer-input`, `lit-html` and any other name.
  - **It fails closed.** If `trustedTypes`, `Sanitizer` or `Document.parseHTMLUnsafe` is missing, or a self-test parse (`<script>` and `<a href>`) shows the sanitizer was ignored, it claims `default` with a policy that throws, replaces the page with the error as text, and throws. No library string then becomes markup. Chromium 156 (Electron 45) has all of them; the self-test uses no event handler, because parsing one reports a `script-src-attr` violation even in an inert document.
- **Rejected:**
  - A pass-through `default` policy. It closes nothing, and it is the fallback if the sanitizing policy ever costs too much.
  - The safe `Document.parseHTML`, which loses every icon.
  - Patching the libraries.

## Consequences

Once the CSP lands, a string can become markup in the renderer only through Lit's policy, through this file, or through `setHTML`, and a review of `install-trusted-types-policy.ts` covers the libraries. A library update that adds a new sink is sanitized automatically. If it adds a new script URL, the app fails loudly in development.

The cost:

- **Whole session:** the policy parsed 89 strings (3.4 million characters) in 81 ms, against 82 ms for the same parse and serialize without a sanitizer (median of five rounds; a sanitized parse costs no more than a plain one).
- **Largest string:** a 748,589-character column of the 60 000-line file took 22 ms, against 25 ms.
- **Output compared with a plain parse:** 0 of the strings differ: the policy changes nothing the libraries produce today.

The sink parses the serialized string again, so each library `innerHTML` costs one extra parse plus a serialization. Highlighting runs in workers (ADR 0050), so this lands in the main thread's DOM-update work.

Electron's `--no-sandbox` is not affected; Trusted Types is per document. Tests do not load the entries.

### Hostile-input tests

The owner asked for tests showing that hostile file names and contents render inert. Two layers:

- **Library escaping, in `npm run check`** (`src/ui/pierre-diffs-escaping.test.ts`, Vitest on Node on both CI systems; no DOM needed). Hostile file names (`<script>`, attribute breakouts, closing tags, quotes, backticks, `javascript:`, bidi overrides, NUL, newlines and tabs, backslashes, entities, `<use>`, very long names and deep paths), rename pairs, file contents (the same plus `<!--`, `-->`, CDATA and `]]>`, `<svg><use href>`, template literals, raw-text openers, processing instructions), hunk header context after `@@`, a hostile language and a chat code block's info string go through the code paths `FileDiff` and `File` build their `innerHTML` strings with: `processFile` on a git-quoted patch, `DiffHunksRenderer` and `FileRenderer`, and `hastToHtml` for the file header, gutter, code columns and hunk separators (`line-info`, which cards use, and `metadata`, which prints the hunk header). A small HTML tokenizer (`src/ui/testing/html-structure-from.ts`) lists each element and attribute; the hostile output may have none the same input with benign text lacks, and the hostile text must be visible as text. A canary splices each name unescaped into the benign output and checks the oracle catches it. No escaping bug was found: the hast builders escape text and attribute values, NUL passes through (the HTML parser drops it), and an unknown language rejects before any HTML is built (beuve only ever passes `text` or a name-derived language; info strings become `snippet.<ext>`). `@pierre/trees` builds its rows as DOM nodes; its only string sinks are its sprite sheet and slot HTML, which beuve does not set.
- **The real app, with the policy** (`scripts/check-hostile-render.ts`, run in CI on Ubuntu under Xvfb after `npm run check`). It generates a repository at run time (names valid on Linux and macOS, so nothing odd is committed), opens its review in the built app, and visits every card in split and unified views, peek, sheet windows (a hostile-named file and the hostile lines; until ADR 0067's 2026-11-06 amendment one was an inline sheet) and the Settings window. It fails on any `securitypolicyviolation`, any `script` outside `<head>`, frame, plugin or `<base>`, any `on*` attribute, any `javascript:` URL, any `<use>` that is not a `#id` reference, any uncaught exception, or hostile text that is not visible. Then it feeds the default policy `<img onerror>`, `<a href=javascript:>`, `<use href=//evil>`, `<form>`/`formaction`, SVG animation, `<foreignObject><script>` and frames and compares the exact output, checks that no policy name can be created again, that only the worker's script URL is allowed, and that no global holds the pass-through policy. The CI job lets Chromium's sandbox use unprivileged user namespaces (Ubuntu 24.04's AppArmor blocks them by default) rather than passing `--no-sandbox`.

## Amendment 2026-10-31: one corpus, and where each layer runs

The owner asked for the corpus to run through the real renderer, not only through the libraries' HTML builders in Node.

- **One corpus.** `src/ui/testing/hostile-corpus.ts` holds every hostile name, line, hunk-header context, language and chat info string, and builds each case with its benign twin and the text it must show. The Node test, the harness page and the generated repository all read it, so they cannot drift. The oracle (`html-structure-from.ts`, with `extra-markup.ts` and `visible-text.ts`) is shared too.
- **Layer 1, library escaping: Node, in `npm run check`, on Ubuntu and macOS.** `pierre-diffs-escaping.test.ts`, unchanged in what it asserts (275 tests), stays the fast pre-check.
- **Layer 2, the built app: Electron, after `npm run check`, on Ubuntu (under Xvfb, with AppArmor's user-namespace restriction lifted rather than `--no-sandbox`) and on macOS (its runner has a display).** `node scripts/build.ts --hostile-harness`, then `scripts/check-hostile-render.ts`:
  - **The app's own code paths.** The generated repository now holds the corpus wherever a file system can (every name but NUL, `//` and the 4000-byte component; every line but the one with NUL): each name as a changed file and as a rename, and each line as a changed section under itself as the hunk header's context, each beside a benign twin. The diff stream renders them in split and unified views; each card is serialized with its shadow roots, once highlighting settles, and must hold no element or attribute its twin's card lacks (ImpactGate's chip and details, which Lit builds from main's analysis, are left out of that comparison only). Peek, an inline sheet, a sheet window and Settings are checked as before.
  - **The components, in a test-only page.** `dist-test/ui/hostile-harness.html` is `index.html` with the harness entry (`src/ui/testing/hostile-harness-entry.ts`) in place of the app's, so it has the production CSP, and installs the same `default` policy. The check navigates the main window, with its production web preferences, to it. It renders all 252 corpus cases with their twins through `@pierre/diffs`' `FileDiff` (split and unified, `line-info` and `metadata` separators: the hunk-header contexts and NUL names the repository cannot hold) and `File`, and the chat code blocks through a real `beuve-chat-drawer`, and applies the Node test's oracle to the live DOM. A hostile language fails to highlight as it fails to render in Node; the library keeps the plain lines and reports the failure with `console.error`, which the harness takes as that case's expected outcome. Then each hostile string is spliced unescaped into markup and assigned through the page's policy, as a library escaping bug would, and nothing unsafe may remain; the policy checks run on this page too. The test build lives outside `dist/`, so electron-builder never packages it, and the check fails if anything of it is in `dist/` or if the page's CSP differs from the app's.
  - **It fails on** any `securitypolicyviolation` (except the `script-src-attr` reports the sanitizer's own parse makes for the spliced strings, and the refused `createPolicy` calls), any uncaught exception, any console error (the theme double registration it found is fixed), any `on*` attribute, `javascript:` URL in an attribute that takes a URL, `script` outside `<head>`, frame, plugin or `<base>`, any `<use>` that is not a `#id` reference, and hostile text that is not visible.
  - **Cost**: the check step took 46 s on Ubuntu and 63 s on macOS in its first CI run (run 41157239513), plus about 2 s to build; the harness's 252 cases take about 30 s of either.
  - **The negative control**, run locally, not in CI: `node scripts/build.ts --hostile-harness --pass-through-policy` builds the harness with a pass-through `default` policy (`src/ui/testing/install-pass-through-policy.ts`), and the check then fails (23 failures: the spliced scripts, handlers, `<use>` and `javascript:` link survive, every sanitizer case differs, and the pass-through name and any script URL are allowed).
