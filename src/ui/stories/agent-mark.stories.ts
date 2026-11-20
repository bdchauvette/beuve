import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '../primitives/beuve-agent-mark.ts';
import { framed } from './framed.ts';

const meta: Meta = { title: 'Primitives/Agent mark' };

export default meta;

/** Hover or focus ✨ to see where the note came from; a note you wrote shows nothing. */
export const AgentMark: StoryObj = {
  render: () => {
    return framed(
      html`<p>
          A finding
          <beuve-agent-mark
            focusable
            .origin=${{ kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: 0.82 }}
          ></beuve-agent-mark>
        </p>
        <p>
          A proposal
          <beuve-agent-mark
            focusable
            .origin=${{ kind: 'chat-answer', messageId: 'm2', proposal: 1 }}
          ></beuve-agent-mark>
        </p>
        <p>
          Your own note
          <beuve-agent-mark .origin=${{ kind: 'human' }}></beuve-agent-mark>
        </p>`,
    );
  },
};
