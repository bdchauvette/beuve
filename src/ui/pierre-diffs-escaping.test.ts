import { describe } from 'vitest';

import { extraMarkup } from './testing/extra-markup.ts';
import { hostileCorpus } from './testing/hostile-corpus.ts';
import { htmlStructureFrom } from './testing/html-structure-from.ts';
import { inParsedText } from './testing/in-parsed-text.ts';
import { renderDiffHtml } from './testing/render-diff-html.ts';
import type { DiffHtmlOptions } from './testing/render-diff-html.ts';
import { renderFileHtml } from './testing/render-file-html.ts';
import { test } from './testing/test.ts';
import { visibleText } from './testing/visible-text.ts';

// ADR 0077: hostile file names, contents, languages and hunk headers go through the code paths
// `@pierre/diffs` builds its `innerHTML` strings with, and must produce no element or attribute
// that the same input with benign text does not, while the hostile text stays visible as text.
// `scripts/check-hostile-render.ts` renders the same corpus (`testing/hostile-corpus.ts`) in the
// built app, with the production CSP and the Trusted Types policy.

describe('@pierre/diffs escapes hostile input', () => {
  test.for(hostileCorpus().fileNames)(
    'file name $label ($options.diffStyle, $options.hunkSeparators)',
    async ({ text: name, options, hostile, benign, visible }, { expect }) => {
      const rendered = await renderDiffHtml(hostile, options);
      const twin = await renderDiffHtml(benign, options);
      expect(extraMarkup(rendered.html, twin.html)).toStrictEqual([]);
      expect(rendered.name).toBe(name);
      expect(missingFrom(visibleText(rendered.html), visible)).toStrictEqual([]);
    },
  );

  test.for(hostileCorpus().renames)(
    'rename from and to $label',
    async ({ text: name, options, hostile, benign, visible }, { expect }) => {
      const rendered = await renderDiffHtml(hostile, options);
      const twin = await renderDiffHtml(benign, options);
      expect(extraMarkup(rendered.html, twin.html)).toStrictEqual([]);
      expect([rendered.previousName, rendered.name]).toStrictEqual([`${name}.old.ts`, name]);
      expect(missingFrom(visibleText(rendered.html), visible)).toStrictEqual([]);
    },
  );

  test.for(hostileCorpus().lines)(
    'contents $label ($options.diffStyle, $options.hunkSeparators)',
    async ({ options, hostile, benign, visible }, { expect }) => {
      const rendered = await renderDiffHtml(hostile, options);
      const twin = await renderDiffHtml(benign, options);
      expect(extraMarkup(rendered.html, twin.html)).toStrictEqual([]);
      expect(missingFrom(visibleText(rendered.html), visible)).toStrictEqual([]);
    },
  );

  test.for(hostileCorpus().hunkContexts)(
    'hunk header context $label ($options.diffStyle, $options.hunkSeparators)',
    async ({ options, hostile, benign }, { expect }) => {
      const rendered = await renderDiffHtml(hostile, options);
      const twin = await renderDiffHtml(benign, options);
      expect(extraMarkup(rendered.html, twin.html)).toStrictEqual([]);
    },
  );

  test.for(hostileCorpus().shownHunkContexts)(
    'hunk header context $label is visible as text',
    async ({ options, hostile, visible }, { expect }) => {
      const rendered = await renderDiffHtml(hostile, options);
      expect(missingFrom(visibleText(rendered.html), visible)).toStrictEqual([]);
    },
  );

  test.for(hostileCorpus().diffLanguages)(
    'language override $label renders nothing',
    async ({ options, patch }, { expect }) => {
      await expect(renderDiffHtml(patch, options)).rejects.toThrow(
        'not found in bundled or custom languages',
      );
    },
  );

  test.for(hostileCorpus().sheets)(
    'sheet of a file named $label',
    async ({ hostile, benign, visible }, { expect }) => {
      const rendered = await renderFileHtml(hostile);
      const twin = await renderFileHtml(benign);
      expect(extraMarkup(rendered, twin)).toStrictEqual([]);
      expect(missingFrom(visibleText(rendered), visible)).toStrictEqual([]);
    },
  );

  test.for(hostileCorpus().codeBlocks)(
    'chat code block with info string $label',
    async ({ hostile, benign, visible }, { expect }) => {
      const rendered = await renderFileHtml(hostile);
      const twin = await renderFileHtml(benign);
      expect(extraMarkup(rendered, twin)).toStrictEqual([]);
      expect(missingFrom(visibleText(rendered), visible)).toStrictEqual([]);
    },
  );

  test.for(hostileCorpus().sheetLanguages)(
    'sheet with language $label renders nothing',
    async ({ file }, { expect }) => {
      await expect(renderFileHtml(file)).rejects.toThrow(
        'not found in bundled or custom languages',
      );
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

  test.for(hostileCorpus().names)(
    'would catch $label spliced unescaped into text or an attribute',
    async ({ text: name }, { expect }) => {
      const options: DiffHtmlOptions = { diffStyle: 'unified', hunkSeparators: 'line-info' };
      const benign = await renderDiffHtml(hostileCorpus().fileNames.at(0)?.benign ?? '', options);
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

/** The entries of `expected` that `text` does not hold. */
function missingFrom(text: string, expected: readonly string[]): readonly string[] {
  return expected.filter((entry) => !text.includes(entry));
}
