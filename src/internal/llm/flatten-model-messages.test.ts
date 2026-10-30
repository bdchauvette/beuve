import { describe } from 'vitest';

import { flattenModelMessages } from './flatten-model-messages.ts';
import { test } from './testing/test.ts';

describe('flattenModelMessages', () => {
  test('joins user messages as they are, the cache marker aside', ({ expect }) => {
    expect(
      flattenModelMessages([
        { role: 'user', content: '# Change\n', cache: true },
        { role: 'user', content: '## Question' },
      ]),
    ).toBe('# Change\n\n## Question');
  });

  test('heads every turn by its speaker once the conversation holds an answer', ({ expect }) => {
    expect(
      flattenModelMessages([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ]),
    ).toBe('## User\n\na\n\n## Assistant\n\nb\n\n## User\n\nc');
  });
});
