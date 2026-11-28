import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseAutoeditAnswer } from './parse-autoedit-answer.ts';

describe('parseAutoeditAnswer', () => {
  test('reads the body and the suggestions, unwrapping a fenced answer', ({ expect }) => {
    const answer = JSON.stringify({
      body: '```markdown\nUse the constant.\n```',
      suggestions: [
        { id: 's1', path: 'src/a.ts', startLine: 2, endLine: 2, replacement: 'x', why: 'extra' },
        { path: 'src/a.ts', startLine: 5, endLine: 4, replacement: 'y' },
      ],
    });
    expect(parseAutoeditAnswer(`\`\`\`json\n${answer}\n\`\`\``)).toStrictEqual({
      ok: true,
      value: {
        body: 'Use the constant.',
        suggestions: [
          { id: 's1', path: 'src/a.ts', startLine: 2, endLine: 2, replacement: 'x' },
          { path: 'src/a.ts', startLine: 5, endLine: 4, replacement: 'y' },
        ],
        malformed: 0,
      },
    });
  });

  test('counts malformed suggestions apart and keeps the rest', ({ expect }) => {
    const answer = JSON.stringify({
      body: 'Text.',
      suggestions: [
        { path: 'src/a.ts', startLine: 0, endLine: 0, replacement: 'x' },
        { path: 'src/a.ts', startLine: 5, endLine: 2, replacement: 'x' },
        { path: '', startLine: 1, endLine: 1, replacement: 'x' },
        { path: 'src/a.ts', startLine: 1.5, endLine: 2, replacement: 'x' },
        'not an object',
        { path: 'src/a.ts', startLine: 1, endLine: 1, replacement: 'kept' },
      ],
    });
    expect(parseAutoeditAnswer(answer)).toStrictEqual({
      ok: true,
      value: {
        body: 'Text.',
        suggestions: [{ path: 'src/a.ts', startLine: 1, endLine: 1, replacement: 'kept' }],
        malformed: 5,
      },
    });
  });

  test.for([
    ['Here is the note: Use the constant.', 'the answer was not JSON'],
    ['{"body": "x", ', 'the answer was not JSON'],
    ['{"suggestions": []}', 'the answer had no note body'],
    ['[1, 2]', 'the answer had no note body'],
    ['{"body": "  ", "suggestions": []}', 'the answer was empty'],
  ] as const)('refuses %j: %s', ([answer, reason], { expect }) => {
    expect(parseAutoeditAnswer(answer)).toStrictEqual({ ok: false, error: reason });
  });

  test('a body without suggestions has none', ({ expect }) => {
    expect(parseAutoeditAnswer('{"body": "Only text."}')).toStrictEqual({
      ok: true,
      value: { body: 'Only text.', suggestions: [], malformed: 0 },
    });
  });
});
