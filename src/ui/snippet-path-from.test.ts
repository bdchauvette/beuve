import { describe } from 'vitest';

import { snippetPathFrom } from './snippet-path-from.ts';
import { test } from './testing/test.ts';

describe('snippetPathFrom', () => {
  test.for<[string, string]>([
    ['ts', 'snippet.ts'],
    ['TypeScript', 'snippet.ts'],
    ['bash', 'snippet.bash'],
    ['console', 'snippet.sh'],
    ['diff', 'snippet.diff'],
    ['', 'snippet.txt'],
    ['../../etc/passwd', 'snippet.txt'],
    ['a b', 'snippet.txt'],
  ])('%j', ([info, expected], { expect }) => {
    expect(snippetPathFrom(info)).toBe(expected);
  });
});
