import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '../beuve-ura-label-menu.ts';
import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Note label menu' };

export default meta;

/**
 * The composer's and the dock editor's label and Blocking, as one menu button (ADR 0131): the
 * labels, a separator, then Blocking.
 */
export const LabelMenu: StoryObj = {
  render: () => {
    return framed(html`
      <beuve-ura-label-menu></beuve-ura-label-menu>
      <beuve-ura-label-menu severity="question" blocking></beuve-ura-label-menu>
    `);
  },
};

/** Beside the Title field, as the composer and the dock's editor show it: one control height. */
export const BesideATitle: StoryObj = {
  render: () => {
    return framed(html`
      <beuve-ura-label-menu severity="suggestion"></beuve-ura-label-menu>
      <input class="field" aria-label="Title" placeholder="Title (optional)" />
    `);
  },
};
