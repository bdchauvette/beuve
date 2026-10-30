import { describe } from 'vitest';

import { snippetPathFrom } from './snippet-path-from.ts';
import { createGitPatch } from './testing/create-git-patch.ts';
import type { GitPatchInput } from './testing/create-git-patch.ts';
import { htmlStructureFrom } from './testing/html-structure-from.ts';
import type { HtmlStructure } from './testing/html-structure-from.ts';
import { renderDiffHtml } from './testing/render-diff-html.ts';
import type { DiffHtmlOptions } from './testing/render-diff-html.ts';
import { renderFileHtml } from './testing/render-file-html.ts';
import { test } from './testing/test.ts';

// ADR 0077: hostile file names, contents, languages and hunk headers go through the code paths
// `@pierre/diffs` builds its `innerHTML` strings with, and must produce no element or attribute
// that the same input with benign text does not, while the hostile text stays visible as text.
// The real app, with the Trusted Types policy, is checked by `scripts/check-hostile-render.ts`.

describe('@pierre/diffs escapes hostile input', () => {
  test.for(diffCases(hostileNames))(
    'file name $label ($options.diffStyle, $options.hunkSeparators)',
    async ({ text: name, options }, { expect }) => {
      const hostile = await renderDiffHtml(patchNamed(name, name), options);
      const benign = await renderDiffHtml(patchNamed('benign.ts', 'benign.ts'), options);
      expect(extraMarkup(hostile.html, benign.html)).toStrictEqual([]);
      expect(hostile.name).toBe(name);
      expect(visibleText(hostile.html)).toContain(inParsedText(name));
    },
  );

  test.for(hostileNames())('rename from and to $label', async ({ text: name }, { expect }) => {
    const options: DiffHtmlOptions = { diffStyle: 'split', hunkSeparators: 'line-info' };
    const hostile = await renderDiffHtml(patchNamed(`${name}.old.ts`, name), options);
    const benign = await renderDiffHtml(patchNamed('benign.old.ts', 'benign.ts'), options);
    expect(extraMarkup(hostile.html, benign.html)).toStrictEqual([]);
    expect([hostile.previousName, hostile.name]).toStrictEqual([`${name}.old.ts`, name]);
    expect(visibleText(hostile.html)).toContain(inParsedText(name));
  });

  test.for(diffCases(hostileContents))(
    'contents $label ($options.diffStyle, $options.hunkSeparators)',
    async ({ text: payload, options }, { expect }) => {
      const hostile = await renderDiffHtml(patchWithLine(payload), options);
      const benign = await renderDiffHtml(patchWithLine('benign'), options);
      expect(extraMarkup(hostile.html, benign.html)).toStrictEqual([]);
      expect(visibleText(hostile.html)).toContain(inParsedText(payload));
    },
  );

  test.for(diffCases(hostileContents))(
    'hunk header context $label ($options.diffStyle, $options.hunkSeparators)',
    async ({ text: payload, options }, { expect }) => {
      const hostile = await renderDiffHtml(patchWithContext(payload), options);
      const benign = await renderDiffHtml(patchWithContext('benign'), options);
      expect(extraMarkup(hostile.html, benign.html)).toStrictEqual([]);
    },
  );

  test.for(hostileContents())(
    'hunk header context $label is visible as text',
    async ({ text: payload }, { expect }) => {
      const options: DiffHtmlOptions = { diffStyle: 'unified', hunkSeparators: 'metadata' };
      const hostile = await renderDiffHtml(patchWithContext(payload), options);
      expect(visibleText(hostile.html)).toContain(`function f() { ${inParsedText(payload)}`);
    },
  );

  test.for(hostileContents())(
    'language override $label renders nothing',
    async ({ text: language }, { expect }) => {
      const options: DiffHtmlOptions = {
        diffStyle: 'unified',
        hunkSeparators: 'line-info',
        language,
      };
      await expect(renderDiffHtml(patchWithLine('const a = 1;'), options)).rejects.toThrow(
        'not found in bundled or custom languages',
      );
    },
  );

  test.for(hostileNames())('sheet of a file named $label', async ({ text: name }, { expect }) => {
    const hostile = await renderFileHtml({ name, contents: allHostileContents() });
    const benign = await renderFileHtml({ name: 'benign.ts', contents: 'benign\n'.repeat(20) });
    expect(extraMarkup(hostile, benign)).toStrictEqual([]);
    expect(visibleText(hostile)).toContain(inParsedText(name));
    expect(visibleText(hostile)).toContain(inParsedText(allHostileContents().replaceAll('\n', '')));
  });

  test.for(hostileContents())(
    'chat code block with info string $label',
    async ({ text: info }, { expect }) => {
      const hostile = await renderFileHtml({ name: snippetPathFrom(info), contents: info });
      const benign = await renderFileHtml({ name: snippetPathFrom('ts'), contents: 'benign' });
      expect(extraMarkup(hostile, benign)).toStrictEqual([]);
      expect(visibleText(hostile)).toContain(inParsedText(info));
    },
  );

  test.for(hostileContents())(
    'sheet with language $label renders nothing',
    async ({ text: lang }, { expect }) => {
      await expect(
        renderFileHtml({ name: 'a.ts', contents: 'const a = 1;', lang }),
      ).rejects.toThrow('not found in bundled or custom languages');
    },
  );
});

describe('the structural oracle', () => {
  test('lists each element and attribute once, and decodes the text', ({ expect }) => {
    const html =
      '<div data-line="1" style="a"><span style="b">&#x3C;b>x&amp;&quot;&#60;</span></div><DIV DATA-LINE=2>y</div>';
    expect(htmlStructureFrom(html)).toStrictEqual({
      markup: ['div', 'div[data-line]', 'div[style]', 'span', 'span[style]'],
      text: '<b>x&"<y',
    });
  });

  test.for([
    {
      label: 'an unescaped double quote',
      html: '<bdi title="a"><img src=x onerror=alert(1)>">t</bdi>',
      markup: ['bdi', 'bdi[title]', 'img', 'img[onerror]', 'img[src]'],
    },
    {
      label: 'an unescaped single quote',
      html: "<bdi title='a' onmouseover=alert(1) x='y'>t</bdi>",
      markup: ['bdi', 'bdi[onmouseover]', 'bdi[title]', 'bdi[x]'],
    },
    {
      label: 'an unquoted value',
      html: '<bdi title=a onclick=alert(1)>t</bdi>',
      markup: ['bdi', 'bdi[onclick]', 'bdi[title]'],
    },
    {
      label: 'an attribute name starting with =',
      html: '<b =x/onclick=1>t</b>',
      markup: ['b', 'b[=x]', 'b[onclick]'],
    },
    {
      label: 'comments, declarations and processing instructions',
      html: '<b>a<!-- x --></b><!DOCTYPE x><?php ?></x y>',
      markup: ['<!…>', '<?…>', 'b'],
    },
    { label: 'a malformed end tag', html: '</ x>t', markup: ['</…>'] },
  ])('finds the markup $label adds', ({ html, markup }, { expect }) => {
    expect(htmlStructureFrom(html).markup).toStrictEqual(markup);
  });

  test('reads a raw-text element as text up to its end tag', ({ expect }) => {
    expect(htmlStructureFrom('<style>a<img src=x onerror=1></style><b>t</b>')).toStrictEqual({
      markup: ['b', 'style'],
      text: 't',
    });
  });

  test('keeps a < that starts no tag as text', ({ expect }) => {
    expect(htmlStructureFrom('a < b <3 <')).toStrictEqual({ markup: [], text: 'a < b <3 <' });
  });

  test.for(hostileNames())(
    'would catch $label spliced unescaped into text or an attribute',
    async ({ text: name }, { expect }) => {
      const options: DiffHtmlOptions = { diffStyle: 'unified', hunkSeparators: 'line-info' };
      const benign = await renderDiffHtml(patchNamed('benign.ts', 'benign.ts'), options);
      const inText = benign.html.map((html) => html.replace('benign.ts', () => name));
      const inAttribute = benign.html.map((html) =>
        html.replace('data-title=""', () => `data-title="${name}"`),
      );
      const hasExtraMarkup = (broken: readonly string[]): boolean =>
        extraMarkup(broken, benign.html).length > 0;
      const isCaughtInText =
        hasExtraMarkup(inText) || !visibleText(inText).includes(inParsedText(name));
      // Raw `<` starting a tag, or a reference that decodes, in text; a raw `"` in an attribute.
      expect([isCaughtInText, hasExtraMarkup(inAttribute)]).toStrictEqual([
        /<[!/?a-z]|&/iu.test(name),
        name.includes('"'),
      ]);
    },
  );
});

interface HostileInput {
  readonly label: string;
  readonly text: string;
}

interface DiffCase extends HostileInput {
  readonly options: DiffHtmlOptions;
}

/** File names a repository can hold on Linux and macOS, plus NUL, which only a patch can. */
function hostileNames(): readonly HostileInput[] {
  return [
    { label: 'script tag', text: '<script>alert(1)</script>.ts' },
    { label: 'attribute breakout', text: '"><img src=x onerror=alert(1)>.ts' },
    { label: 'single-quote breakout', text: "'><svg onload=alert(1)>.ts" },
    { label: 'closing tags', text: '</span></bdi></div><b>bold</b>.ts' },
    { label: 'quotes and backticks', text: `'single' "double" \`tick\` \${x}.ts` },
    { label: 'javascript URL', text: 'javascript:alert(1).ts' },
    { label: 'bidi overrides', text: 'invoice\u{202E}gpj.ts\u{202C}\u{2066}x\u{2069}.ts' },
    { label: 'NUL', text: 'nul\0name.ts' },
    { label: 'newline and tab', text: 'line\nbreak\there.ts' },
    { label: 'backslash', text: String.raw`back\slash\".ts` },
    { label: 'entities', text: '&amp;&lt;&#x3C;script&gt;.ts' },
    { label: 'use reference', text: '<svg><use href="//evil.example/#x"/></svg>.ts' },
    { label: 'very long', text: `${'<b>'.repeat(80)}${'x'.repeat(4000)}.ts` },
    { label: 'deep path', text: `${'d<i>r/'.repeat(60)}f.ts` },
  ];
}

/** Lines of code (or a language, or an info string) that would be markup if not escaped. */
function hostileContents(): readonly HostileInput[] {
  return [
    { label: 'script tag', text: '<script>alert(1)</script>' },
    { label: 'attribute breakout', text: '"><img src=x onerror=alert(1)>' },
    { label: 'closing tags', text: '</span></div></pre></code><b>bold</b>' },
    { label: 'comment open', text: '<!-- <img src=x onerror=alert(1)>' },
    { label: 'comment close', text: '--> <img src=x onerror=alert(1)>' },
    { label: 'CDATA', text: '<![CDATA[ <script>alert(1)</script> ]]>' },
    { label: 'CDATA close', text: ']]> <img src=x onerror=alert(1)>' },
    { label: 'svg use', text: '<svg><use href="//evil.example/sprite.svg#x"/></svg>' },
    { label: 'template literal', text: '`${alert(document.domain)}`' },
    { label: 'javascript URL', text: '<a href="javascript:alert(1)">x</a>' },
    { label: 'raw-text openers', text: '<style>*{}</style><textarea><title><xmp>' },
    { label: 'entities', text: '&lt;img src=x onerror=alert(1)&gt; &amp;amp;' },
    { label: 'bidi and NUL', text: 'a\u{202E}b\0c\u{2067}d' },
    { label: 'processing instruction', text: '<?xml version="1.0"?><!DOCTYPE x>' },
  ];
}

function allHostileContents(): string {
  return hostileContents()
    .map((input) => input.text)
    .join('\n');
}

/** Each of `inputs` in split and unified views, with the card's separators and with hunk headers. */
function diffCases(inputs: () => readonly HostileInput[]): readonly DiffCase[] {
  return inputs().flatMap((input) =>
    (['split', 'unified'] as const).flatMap((diffStyle) =>
      (['line-info', 'metadata'] as const).map((hunkSeparators) => ({
        ...input,
        options: { diffStyle, hunkSeparators },
      })),
    ),
  );
}

function patchNamed(oldPath: string, newPath: string): string {
  return createGitPatch({ ...benignChange(), oldPath, newPath });
}

function patchWithLine(payload: string): string {
  return createGitPatch({
    ...benignChange(),
    lines: [` ${payload}`, `-const a = '${payload}';`, `+const a = "${payload}";`, `+${payload}`],
  });
}

function patchWithContext(payload: string): string {
  return createGitPatch({ ...benignChange(), context: `function f() { ${payload}` });
}

function benignChange(): GitPatchInput {
  return {
    oldPath: 'a.ts',
    newPath: 'a.ts',
    lines: [' const kept = 1;', '-const a = 1;', '+const a = 2;'],
    context: 'function f() {',
  };
}

/** Markup in `hostile` that `benign` has none of. */
function extraMarkup(hostile: readonly string[], benign: readonly string[]): readonly string[] {
  const allowed = new Set(structureOf(benign).markup);
  return structureOf(hostile).markup.filter((entry) => !allowed.has(entry));
}

/** The text a browser shows for `html`. */
function visibleText(html: readonly string[]): string {
  return inParsedText(structureOf(html).text);
}

function structureOf(html: readonly string[]): HtmlStructure {
  return htmlStructureFrom(html.join(''));
}

/** `text` as the HTML parser leaves it in an element: without NUL, which it drops. */
function inParsedText(text: string): string {
  return text.replaceAll('\0', '');
}
