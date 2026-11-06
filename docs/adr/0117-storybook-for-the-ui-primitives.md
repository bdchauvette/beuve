# 0117. Storybook for the UI primitives, sharing its stories with the gallery

- Status: Accepted; amends [0115](0115-ui-primitives.md) (the gallery)
- Date: 2026-11-06

## Context

ADR 0115 added a gallery page that `scripts/check-gallery.ts` renders in the built app under the production Content Security Policy. It is good at catching a broken primitive in CI, but poor for working on one: no controls, no isolation per state, one long page, and only in the theme and scheme the script sets. Storybook is the usual tool for that. It is a large dev dependency, and its preview cannot run under beuve's CSP (it injects scripts and styles), so it cannot replace the CSP check.

## Decision

- **Storybook 10 with `@storybook/web-components-vite`**, pinned exactly at 10.6.3. That was the newest release older than two weeks when added; 10.6.6 was a day old. It is a dev dependency only and nothing in `src` imports its runtime. It adds 107 packages, most of them optional platform binaries. Vite 8 was already installed through Vitest. It has no install scripts and no `npm audit` findings beyond the 18 moderate ones the tree already had (the typescript-eslint chain). `npm run storybook` serves it, and `npm run build-storybook` writes `dist-storybook/`, which git, Prettier and ESLint ignore. Telemetry is off.
- **Stories live in `src/ui/stories/*.stories.ts`** as Component Story Format: a default-exported meta and one named export per story. They may import Storybook's types but not its runtime. Each renders through `framed()`, which puts the markup in `beuve-story-frame`: a shadow root with every primitive style module, as a component's own has. That frame also answers `beuve-commit-info` from sample commits, as the review does (ADR 0116). The tokens story draws type, colors and a diff sample as they resolve. Controls exist where they help: the button's variant, size, disabled and pressed state, and a time's format and styles.
- **The gallery renders the stories.** `src/ui/testing/gallery-entry.ts` imports each stories module and renders every story with its meta's args and its own, as Storybook would. One catalog serves both hosts. `check-gallery.ts` fails when `src/ui/stories/` holds a module the gallery does not import. The check keeps its job: every story under the production CSP, in both themes and every diff scheme, in CI.
- **The toolbar sets theme and diff scheme.** `.storybook/preview.ts` loads `index.css` and sets the root's `color-scheme` and `data-diff-colors` from two globals. For `color-scheme` to work, ADR 0114's tokens are now `light-dark()` pairs instead of a `prefers-color-scheme` block (see the amendment there). Vite would lower `light-dark()` to a polyfill that ignores an inline `color-scheme`, so the Storybook build targets browsers that have it (Chrome 123, Firefox 120, Safari 17.5). The stories also need Temporal, which Safari does not have yet.
- **Decorators are lowered by esbuild.** Vite 8's own transform leaves Lit's standard decorators (`@customElement`, `accessor`) in place, and no browser runs them. `.storybook/main.ts` runs our TypeScript through esbuild first, as `scripts/build.ts` does.
- **CI builds it.** The static workflow's matrix gains `storybook:ci` (`storybook build`), so a story that no longer compiles fails there. The gallery check in the build workflow still renders them under the CSP.

## Consequences

Working on a primitive means `npm run storybook` and its controls; reviewing all of them in context means the gallery screenshots CI uploads. A new primitive needs a story, and the gallery picks it up once it is imported there (the check says so when it is not). Storybook upgrades are deliberate, pinned and two weeks old at least. The stories and their frame are linted like the rest of `src/ui`, with the config-file exemption for default exports and many exports per file.
