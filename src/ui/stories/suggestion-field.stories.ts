import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '../beuve-suggestion-field.ts';
import type { SuggestionFieldView } from '../suggestion-field-view.ts';
import { framed } from './framed.ts';

const meta: Meta = { title: 'Components/Suggestion field' };

export default meta;

function sampleField(overrides: Partial<SuggestionFieldView> = {}): SuggestionFieldView {
  return {
    key: 's1',
    headSha: 'a'.repeat(40),
    path: 'src/retry.ts',
    startLine: 10,
    endLine: 12,
    replacement: [
      'export function retry(budget: number): number {',
      '  // one fewer attempt left',
      '  return budget - 1;',
    ].join('\n'),
    ...overrides,
  };
}

/**
 * A note's suggestion as the composer and the notes list's editor show it (ADR 0162): its lines,
 * Remove, and a CodeMirror field highlighted by beuve's own highlighter.
 */
export const SuggestionField: StoryObj = {
  render: () => {
    return framed(html`<beuve-suggestion-field .field=${sampleField()}></beuve-suggestion-field>`);
  },
};

/** A stored suggestion whose lines changed since it was written: kept, and saying so. */
export const Outdated: StoryObj = {
  render: () => {
    return framed(
      html`<beuve-suggestion-field
        .field=${sampleField({ outdated: 'Outdated: the lines changed since' })}
      ></beuve-suggestion-field>`,
    );
  },
};

/** New lines before line 4, one line, and a file beuve has no grammar for. */
export const InsertionAndPlainText: StoryObj = {
  render: () => {
    return framed(html`
      <beuve-suggestion-field
        .field=${sampleField({ key: 'i', startLine: 4, endLine: 3, replacement: 'import x;' })}
      ></beuve-suggestion-field>
      <beuve-suggestion-field
        .field=${sampleField({ key: 't', path: 'notes.txt', startLine: 2, endLine: 2, replacement: 'plain text' })}
      ></beuve-suggestion-field>
    `);
  },
};
