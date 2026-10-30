# 0077. Trusted Types in the renderer, and no HTML string sinks in our code

- Status: Proposed. The lint ban and these findings are in; the CSP and policy below need the owner's approval before they ship. The template's statuses are Proposed, Accepted and Superseded; this ADR moves to Accepted when the CSP change lands.
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
- **The sanctioned path.** If beuve ever needs to render an HTML string, it uses `element.setHTML(html, { sanitizer })`. That is the Sanitizer API's safe method, which needs no Trusted Types policy and always removes script-capable markup. TypeScript 6.0's DOM lib declares `Sanitizer` but not `setHTML` or `Document.parseHTML`, so the first use declares them locally (`types/`).
- **Proposed CSP**, added to `src/ui/index.html`, `sheet.html` and `settings.html` (one line each):

  ```
  …; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types lit-html default beuve-sanitizer-input
  ```

- **Proposed policy:** `src/ui/install-trusted-types-policy.ts`. Each entry (`index.ts`, `sheet-entry.ts`, `settings-entry.ts`) calls it after its imports, before the first render.
  - `default.createHTML(html)`:
    - `Document.parseHTMLUnsafe(html, { sanitizer })`, where `sanitizer` is `new Sanitizer({ removeElements: [], removeAttributes: [] })` after `removeUnsafe()`, which removes scripts, frames and every event handler attribute. It also removes every navigating or submitting element (`a`, `area`, `base`, `form`, `input`, `select`, `textarea`, `meta`, `link`, and SVG `a`), the attributes that make a `<button>` submit (`formaction`, `action`, `form`; the gutter's utility button stays), and SVG animation (`animate`, `animateMotion`, `animateTransform`, `set`), so no `javascript:` URL survives.
    - Then it removes any `<use>` whose `href` is not a `#fragment` or that has an `xlink:href`.
    - Then it serializes with `body.getHTML()`.

    The libraries' HTML uses none of the removed elements.

  - `default.createScriptURL(url)`: only `diff-worker/worker.js` beside the page; anything else throws.
  - `beuve-sanitizer-input`: a pass-through `createHTML` that only the default policy's closure holds. `parseHTMLUnsafe` is itself a Trusted Types sink, and calling it with a string from inside the default policy would recurse.
  - The exact code and HTML changes are in the proposal's patch (`csp.patch`).
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

Electron's `--no-sandbox` is not affected; Trusted Types is per document. Tests do not load the entries, and the installer does nothing where `trustedTypes` is missing.
