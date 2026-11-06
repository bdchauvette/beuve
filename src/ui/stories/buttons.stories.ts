import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { framed } from './framed.ts';

/** The controls a single button takes. */
interface ButtonArgs {
  readonly label: string;
  readonly variant: 'default' | 'primary' | 'quiet' | 'link' | 'icon';
  readonly size: 'normal' | 'large';
  readonly isDisabled: boolean;
  readonly isPressed: boolean;
}

/** The class each variant and size adds to `button`. */
const variantClasses: Readonly<Record<ButtonArgs['variant'], string>> = {
  default: '',
  primary: 'primary',
  quiet: 'quiet',
  link: 'link',
  icon: 'icon',
};
const sizeClasses: Readonly<Record<ButtonArgs['size'], string>> = { normal: '', large: 'large' };

const meta: Meta<ButtonArgs> = {
  title: 'Primitives/Button',
  args: {
    label: 'Save Progress',
    variant: 'primary',
    size: 'normal',
    isDisabled: false,
    isPressed: false,
  },
  argTypes: {
    variant: { control: 'select', options: ['default', 'primary', 'quiet', 'link', 'icon'] },
    size: { control: 'inline-radio', options: ['normal', 'large'] },
  },
  render: ({ label, variant, size, isDisabled, isPressed }) => {
    const classes = ['button', variantClasses[variant], sizeClasses[size]]
      .filter((name) => name !== '')
      .join(' ');
    return framed(
      html`<button
        class=${classes}
        type="button"
        ?disabled=${isDisabled}
        aria-pressed=${isPressed ? 'true' : 'false'}
      >
        ${label}
      </button>`,
    );
  },
};

export default meta;

export const Playground: StoryObj<ButtonArgs> = {};

export const Variants: StoryObj<ButtonArgs> = {
  render: () => {
    return framed(html`
      <button class="button" type="button">Default</button>
      <button class="button primary" type="button">Primary</button>
      <button class="button quiet" type="button">Quiet</button>
      <button class="button link" type="button">Link</button>
      <button class="button icon" type="button" aria-label="Close">×</button>
      <button class="button primary large" type="button">Large primary</button>
    `);
  },
};

export const States: StoryObj<ButtonArgs> = {
  render: () => {
    return framed(html`
      <button class="button" type="button" disabled>Disabled</button>
      <button class="button primary" type="button" disabled>Disabled primary</button>
      <button class="button" type="button" aria-pressed="true">Pressed</button>
      <button class="button quiet" type="button" aria-expanded="true">Menu open</button>
    `);
  },
};
