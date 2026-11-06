# 0117. Storybook for the UI primitives

- Status: Accepted (diff scheme switch removed by [0114](0114-design-tokens-logical-properties-and-diff-color-schemes.md)'s last amendment); extends [0115](0115-ui-primitives.md)
- Date: 2026-11-06

## Context

ADR 0115 made the renderer's controls shared primitives. Working on one, or reviewing them together, needs a place where each renders on its own, in each state, theme and diff color scheme, with controls for its options. Storybook is the usual tool for that. It is a large dev dependency, and its preview cannot run under beuve's Content Security Policy (it injects scripts and styles).

## Decision

- **Storybook 10 with `@storybook/web-components-vite`**, pinned exactly at 10.6.3. That was the newest release older than two weeks when added; 10.6.6 was a day old. It is a dev dependency only and nothing in `src` imports its runtime. It adds 107 packages, most of them optional platform binaries. Vite 8 was already installed through Vitest. It has no install scripts and no `npm audit` findings beyond the 18 moderate ones the tree already had (the typescript-eslint chain). `npm run storybook` serves it, and `npm run build-storybook` writes `dist-storybook/`, which git, Prettier and ESLint ignore. Telemetry is off.
- **Stories live in `src/ui/stories/*.stories.ts`** as Component Story Format: a default-exported meta and one named export per story. They may import Storybook's types but not its runtime. Each renders through `framed()`, which puts the markup in `beuve-story-frame`: a shadow root with every primitive style module, as a component's own has. That frame also answers `beuve-commit-info` from sample commits, as the review does (ADR 0116). The tokens story draws type, colors and a diff sample as they resolve. Controls exist where they help: the button's variant, size, disabled and pressed state, and a time's format and styles.
- **Storybook is the one catalog.** An earlier draft also rendered the stories on a gallery page in the built app, so a script could screenshot them under the production CSP. It was dropped: two hosts for one catalog, for coverage the app's own checks mostly give. The hostile-render, diagnostics and terminal checks render the components that use the primitives under the production policy, so what no check covers is a primitive the app does not use yet.
- **The toolbar sets theme and diff scheme.** `.storybook/preview.ts` loads `index.css` and sets the root's `color-scheme` and `data-diff-colors` from two globals. For `color-scheme` to work, ADR 0114's tokens are now `light-dark()` pairs instead of a `prefers-color-scheme` block (see the amendment there). Vite would lower `light-dark()` to a polyfill that ignores an inline `color-scheme`, so the Storybook build targets browsers that have it (Chrome 123, Firefox 120, Safari 17.5). The stories also need Temporal, which Safari does not have yet.
- **Decorators are lowered by esbuild.** Vite 8's own transform leaves Lit's standard decorators (`@customElement`, `accessor`) in place, and no browser runs them. `.storybook/main.ts` runs our TypeScript through esbuild first, as `scripts/build.ts` does.
- **CI builds it.** The static workflow's matrix gains `storybook:ci` (`storybook build`), so a story that no longer compiles fails there.

## Consequences

Working on a primitive, or reviewing them all, means `npm run storybook` and its toolbar and controls. A new primitive needs a story; a story is not rendered under the production CSP until a component uses the primitive. Storybook upgrades are deliberate, pinned and two weeks old at least. The stories and their frame are linted like the rest of `src/ui`, with the config-file exemption for default exports and many exports per file.
