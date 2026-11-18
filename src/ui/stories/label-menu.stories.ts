import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '../beuve-ura-label-menu.ts';
import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Note label menu' };

export default meta;

/** The composer's and the dock editor's label and Blocking, as one menu button (ADR 0131). */
export const LabelMenu: StoryObj = {
  render: () => {
    return framed(html`
      <beuve-ura-label-menu></beuve-ura-label-menu>
      <beuve-ura-label-menu severity="question" blocking></beuve-ura-label-menu>
    `);
  },
};
