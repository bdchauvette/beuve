import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '../primitives/beuve-duration.ts';
import '../primitives/beuve-time.ts';
import { framed } from './framed.ts';

/** The controls a single time takes. */
interface TimeArgs {
  readonly minutesAgo: number;
  readonly format: 'absolute' | 'relative';
  readonly dateStyle: 'full' | 'long' | 'medium' | 'short';
  readonly formatStyle: 'long' | 'short' | 'narrow';
}

const meta: Meta<TimeArgs> = {
  title: 'Primitives/Time and duration',
  args: { minutesAgo: 5, format: 'relative', dateStyle: 'medium', formatStyle: 'long' },
  argTypes: {
    format: { control: 'inline-radio', options: ['absolute', 'relative'] },
    dateStyle: { control: 'select', options: ['full', 'long', 'medium', 'short'] },
    formatStyle: { control: 'inline-radio', options: ['long', 'short', 'narrow'] },
  },
  render: ({ minutesAgo, format, dateStyle, formatStyle }) => {
    const datetime = Temporal.Now.instant().subtract({ minutes: minutesAgo }).toString();
    return framed(
      html`<beuve-time
        datetime=${datetime}
        format=${format}
        date-style=${dateStyle}
        format-style=${formatStyle}
      ></beuve-time>`,
    );
  },
};

export default meta;

export const Playground: StoryObj<TimeArgs> = {};

export const Relative: StoryObj<TimeArgs> = {
  render: () => {
    const now = Temporal.Now.instant();
    return framed(html`
      ${[
        { seconds: 10 },
        { minutes: 5 },
        { hours: 3 },
        { hours: 30 },
        { hours: 50 },
        { hours: 400 },
      ].map((ago) => {
        return html`<beuve-time
          datetime=${now.subtract(ago).toString()}
          format="relative"
        ></beuve-time>`;
      })}
    `);
  },
};

export const Durations: StoryObj<TimeArgs> = {
  render: () => {
    return framed(html`
      <beuve-duration value="PT0.712S"></beuve-duration>
      <beuve-duration value="PT90S"></beuve-duration>
      <beuve-duration value="PT90S" format-style="long"></beuve-duration>
      <beuve-duration value="PT2H5M" format-style="digital"></beuve-duration>
    `);
  },
};
