import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { framed } from './framed.ts';

const tones = ['muted', 'ok', 'warn', 'danger', 'accent', 'merged'] as const;

const meta: Meta = { title: 'Primitives/Badges, dots and keys' };

export default meta;

export const Badges: StoryObj = {
  render: () => {
    return framed(html`
      ${tones.map((tone) => {
        return html`<span class="badge" data-tone=${tone}>${tone}</span>`;
      })}
      <span class="badge dashed">external</span>
      <span class="badge count">3</span>
      <button class="badge" type="button">#123 Stacked</button>
    `);
  },
};

export const StatusDots: StoryObj = {
  render: () => {
    return framed(html`
      ${tones.map((tone) => {
        return html`<span><span class="status-dot" data-tone=${tone}></span> ${tone}</span>`;
      })}
    `);
  },
};

export const Keys: StoryObj = {
  render: () => {
    return framed(html`<kbd>⌘</kbd><kbd>K</kbd> <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>P</kbd>`);
  },
};
