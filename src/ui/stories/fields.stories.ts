import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Field' };

export default meta;

/** Each field size beside the button of the same size: one control height per row (ADR 0115). */
export const Sizes: StoryObj = {
  render: () => {
    return framed(html`
      <span>
        <input class="field small" aria-label="Small" placeholder="Small" />
        <button class="button small" type="button">Small</button>
      </span>
      <span>
        <input class="field" aria-label="Default" placeholder="Default" />
        <button class="button" type="button">Default</button>
      </span>
      <span>
        <input class="field large" aria-label="Large" placeholder="Large" />
        <button class="button large primary" type="button">Large</button>
      </span>
    `);
  },
};

/** A select, a search and a disabled field. */
export const Kinds: StoryObj = {
  render: () => {
    return framed(html`
      <select class="field" aria-label="Effort">
        <option>Medium</option>
        <option>High</option>
      </select>
      <input class="field" type="search" aria-label="Find" placeholder="Find in all files" />
      <input class="field" aria-label="Disabled" value="Disabled" disabled />
    `);
  },
};
