/**
 * A model answer that uses every construct of the Markdown subset (ADR 0073), with the edge cases
 * a streaming split must keep: a fence holding Markdown-looking lines, a loose nested list, a
 * table, a citation with underscores, `\r\n` line breaks and no final line break.
 */
export function sampleMarkdown(): string {
  return [
    '## Review of `parse_args.ts`',
    '',
    'The change **looks right**, but see [[src/parse_args.ts:3-14]] and _why_ in',
    'the [docs](https://example.com/docs "Docs").',
    '',
    '1. First, with `code`',
    '   - nested *one*',
    '   - nested two',
    '',
    '   A second paragraph of the first item.',
    '2. Second',
    '- a bullet list after it',
    '',
    '```ts',
    '# not a heading',
    '- not a list',
    '',
    'const x = a ** b;',
    '```',
    '',
    '| Column | Right |\r',
    '| :--- | ---: |\r',
    '| a | `b|c` |\r',
    '| **d** |',
    '',
    '> A quote',
    '> with *two* lines',
    '',
    '***',
    '<script>alert(1)</script> and [bad](javascript:alert(1)) end',
    '~~~',
    'an unclosed fence',
  ].join('\n');
}
