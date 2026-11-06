import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

import * as buttons from '../stories/buttons.stories.ts';
import * as commit from '../stories/commit.stories.ts';
import * as controls from '../stories/controls.stories.ts';
import * as emptyStates from '../stories/empty-states.stories.ts';
import * as labels from '../stories/labels.stories.ts';
import * as times from '../stories/times.stories.ts';
import * as tokens from '../stories/tokens.stories.ts';

/** A Storybook story as the gallery reads it: its args and render. */
interface Story {
  readonly args?: Readonly<Record<string, unknown>>;
  readonly render?: (args: Readonly<Record<string, unknown>>) => unknown;
}

/** A stories module: its meta (default export) and its stories (named exports). */
type StoriesModule = Readonly<Record<string, unknown>> & {
  readonly default: Story & { readonly title?: string };
};

/** Every stories module in `src/ui/stories/`; `scripts/check-gallery.ts` fails when one is missing. */
const modules = [
  buttons,
  labels,
  controls,
  times,
  commit,
  emptyStates,
  tokens,
] as unknown as readonly StoriesModule[];

/**
 * The Storybook stories (ADR 0117) on one page in the production CSP, for
 * `scripts/check-gallery.ts`, which shoots it per theme and diff color scheme. Each story renders
 * with its meta's args and its own, as Storybook would. Built only into `dist-test/`
 * (`node scripts/build.ts --gallery`); no shipped bundle contains it.
 */
@customElement('beuve-gallery')
class BeuveGallery extends LitElement {
  static override styles = css`
    :host {
      display: block;
      block-size: 100%;
      overflow: auto;
      box-sizing: border-box;
      padding: var(--beuve-space-6);
      background: var(--beuve-bg);
      color: var(--beuve-text);
      font: var(--beuve-font-body);
    }

    h1 {
      margin: 0 0 var(--beuve-space-4);
      font: var(--beuve-font-title);
    }

    section {
      margin-block-end: var(--beuve-space-6);
    }

    h2 {
      margin: 0 0 var(--beuve-space-2);
      font: var(--beuve-font-heading);
    }

    h3 {
      margin: var(--beuve-space-3) 0 var(--beuve-space-1);
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
    }
  `;

  private renderModule(module: StoriesModule): TemplateResult {
    const { default: meta, ...stories } = module;
    return html`<section>
      <h2>${meta.title}</h2>
      ${Object.entries(stories).map(([name, story]) => {
        return this.renderStory({ meta, name, story: story as Story });
      })}
    </section>`;
  }

  private renderStory({ meta, name, story }: StoryParts): TemplateResult {
    const render = story.render ?? meta.render;
    if (render === undefined) {
      return html`${nothing}`;
    }
    return html`<h3>${name}</h3>
      ${render({ ...meta.args, ...story.args })}`;
  }

  /** The titles rendered, for the check to compare with the stories on disk. */
  get titles(): readonly string[] {
    return modules.map((module) => module.default.title ?? '');
  }

  protected override render(): TemplateResult {
    return html`<h1>beuve primitives</h1>
      ${modules.map((module) => this.renderModule(module))}`;
  }
}

/** One story and the meta it inherits from. */
interface StoryParts {
  readonly meta: Story;
  readonly name: string;
  readonly story: Story;
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-gallery': BeuveGallery;
  }
}
