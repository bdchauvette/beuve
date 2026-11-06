import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Empty states' };

export default meta;

export const Line: StoryObj = {
  render: () => {
    return framed(html`<p class="empty">No notes staged yet.</p>`);
  },
};

export const Screen: StoryObj = {
  render: () => {
    return framed(
      html`<div class="empty-screen">
        <div>
          <h1>Open a review</h1>
          <p>Pick up where you left off, or paste a pull request link.</p>
        </div>
      </div>`,
    );
  },
};
