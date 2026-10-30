import { describe } from 'vitest';

import { splitMarkdownBlocks } from './split-markdown-blocks.ts';
import { sampleMarkdown } from './testing/sample-markdown.ts';
import { test } from './testing/test.ts';

describe('splitMarkdownBlocks', () => {
  test.for<[string, string, string[], string]>([
    ['a heading is done at its line break', '# A\nb', ['# A\n'], 'b'],
    ['a paragraph is done at a blank line', 'a\nb\n\nc', ['a\nb\n'], 'c'],
    ['a paragraph waits: the next line may continue it', 'a\nb\n', [], 'a\nb\n'],
    ['the unfinished last line is never split', 'a\n\n# Hea', ['a\n'], '# Hea'],
    [
      'a fence is done at its closing fence',
      '```\n# x\n\n```\nnext',
      ['```\n# x\n\n```\n'],
      'next',
    ],
    ['an open fence stays open', '```\na\n\nb\n', [], '```\na\n\nb\n'],
    [
      'a list survives blank lines until an unindented line',
      '- a\n\n  b\n\n- c\n\nd\n',
      ['- a\n\n  b\n\n- c\n'],
      'd\n',
    ],
    [
      'a table starts from a one-line pipe paragraph',
      '| a |\n|---|\n| 1 |\n\n',
      ['| a |\n|---|\n| 1 |\n'],
      '',
    ],
    ['a quote is done at a line without >', '> a\n> b\nc\n', ['> a\n> b\n'], 'c\n'],
    ['a rule is done at once', '---\n***\n', ['---\n', '***\n'], ''],
  ])('%s', ([, source, blocks, rest], { expect }) => {
    expect(splitMarkdownBlocks(source, { isFinal: false })).toStrictEqual({ blocks, rest });
  });

  test('a final split ends every block, a list without its trailing blank lines', ({ expect }) => {
    expect(splitMarkdownBlocks('- a\n\n\n', { isFinal: true })).toStrictEqual({
      blocks: ['- a\n'],
      rest: '',
    });
    expect(splitMarkdownBlocks('para\n```\nopen', { isFinal: true })).toStrictEqual({
      blocks: ['para\n', '```\nopen'],
      rest: '',
    });
  });

  test('splitting the rest of any prefix again gives the blocks of the whole text', ({
    expect,
  }) => {
    const source = sampleMarkdown();
    const whole = splitMarkdownBlocks(source, { isFinal: true }).blocks;
    const mismatches = Array.from({ length: source.length + 1 }, (_offset, offset) => {
      const prefix = splitMarkdownBlocks(source.slice(0, offset), { isFinal: false });
      const after = splitMarkdownBlocks(prefix.rest + source.slice(offset), { isFinal: true });
      return [...prefix.blocks, ...after.blocks];
    }).filter((blocks) => JSON.stringify(blocks) !== JSON.stringify(whole));
    expect(mismatches).toStrictEqual([]);
  });
});
