import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '../beuve-opening.ts';
import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Progress' };

export default meta;

export const Bar: StoryObj = {
  render: () => {
    return framed(html`<span class="progress" aria-hidden="true"></span>`);
  },
};

export const Fetching: StoryObj = {
  render: () => {
    return framed(
      html`<beuve-opening
        label="octo/repo#12 Teach the parser about trailing commas"
        stage="Fetching pull request #12…"
        cancellable
      ></beuve-opening>`,
    );
  },
};

export const Opening: StoryObj = {
  render: () => {
    return framed(
      html`<beuve-opening
        label="octo/repo#12 Teach the parser about trailing commas"
        stage="Opening review…"
      ></beuve-opening>`,
    );
  },
};
