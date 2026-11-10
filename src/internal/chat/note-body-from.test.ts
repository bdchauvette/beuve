import { describe } from 'vitest';

import { noteBodyFrom } from './note-body-from.ts';
import { test } from './testing/test.ts';

describe('noteBodyFrom', () => {
  test.for([
    ['  The guard is missing.\n', 'The guard is missing.'],
    ['```markdown\nThe guard is missing.\n\n- a\n```', 'The guard is missing.\n\n- a'],
    ['~~~md\nText\n~~~\n', 'Text'],
    ['```ts\nconst a = 1;\n```', '```ts\nconst a = 1;\n```'],
    ['   \n', ''],
  ] as const)('%j becomes %j', ([answer, body], { expect }) => {
    expect(noteBodyFrom(answer)).toBe(body);
  });
});
