import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { displayIcon } from '../display-icon.ts';
import '../primitives/beuve-menu.ts';
import '../primitives/beuve-tab-list.ts';
import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Segmented, menu and tabs' };

export default meta;

export const Segmented: StoryObj = {
  render: () => {
    return framed(html`
      <span class="segmented" role="radiogroup" aria-label="Layout">
        <button type="button" role="radio" aria-checked="true">
          ${displayIcon('split')} Split
        </button>
        <button type="button" role="radio" aria-checked="false">
          ${displayIcon('inline')} Inline
        </button>
      </span>
      <span class="segmented" role="group" aria-label="Files shown">
        <button type="button" aria-pressed="false">All</button>
        <button type="button" aria-pressed="true">Changed</button>
      </span>
    `);
  },
};

export const Menu: StoryObj = {
  render: () => {
    return framed(html`
      <beuve-menu label="Sort">
        <button slot="trigger" class="button quiet" type="button">
          ${displayIcon('sort')}<span>Path</span>${displayIcon('chevron')}
        </button>
        <button type="button" role="menuitemradio" aria-checked="true">
          ${displayIcon('check')}Path
        </button>
        <button type="button" role="menuitemradio" aria-checked="false">
          ${displayIcon('check')}Imports
        </button>
        <h3 class="menu-heading">More</h3>
        <button type="button" role="menuitemcheckbox" aria-checked="true">
          ${displayIcon('check')}Hide drafts
        </button>
        <button type="button" role="menuitem">Clear filters</button>
      </beuve-menu>
    `);
  },
};

export const Tabs: StoryObj = {
  render: () => {
    return framed(html`
      <beuve-tab-list label="Sidebar">
        <button class="button quiet" type="button" role="tab" aria-selected="false">
          Overview
        </button>
        <button class="button" type="button" role="tab" aria-selected="true">Files</button>
        <button class="button quiet" type="button" role="tab" aria-selected="false">Review</button>
      </beuve-tab-list>
    `);
  },
};
