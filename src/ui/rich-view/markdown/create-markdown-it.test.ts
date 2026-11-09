import { describe } from 'vitest';

import { test } from '../../testing/test.ts';

import { createMarkdownIt } from './create-markdown-it.ts';

describe('createMarkdownIt', () => {
  test.for<[string, string, string]>([
    [
      'source lines on blocks, trailing blank lines left out',
      '# Title\n\nOne\ntwo\n\n- a\n- b\n\n',
      '<h1 data-source-lines="1-1">Title</h1>\n<p data-source-lines="3-4">One\ntwo</p>\n<ul data-source-lines="6-7">\n<li data-source-lines="6-6">a</li>\n<li data-source-lines="7-7">b</li>\n</ul>\n',
    ],
    [
      'table rows, with alignment as an attribute',
      '| a | b |\n|:-:|--:|\n| 1 | 2 |\n',
      '<table data-source-lines="1-3">\n<thead>\n<tr data-source-lines="1-1">\n<th align="center">a</th>\n<th align="right">b</th>\n</tr>\n</thead>\n<tbody>\n<tr data-source-lines="3-3">\n<td align="center">1</td>\n<td align="right">2</td>\n</tr>\n</tbody>\n</table>\n',
    ],
    [
      'task list items',
      '- [ ] open\n- [x] done\n- [link](x)\n',
      '<ul data-source-lines="1-3">\n<li data-task="open" data-source-lines="1-1">open</li>\n<li data-task="done" data-source-lines="2-2">done</li>\n<li data-source-lines="3-3"><a href="x">link</a></li>\n</ul>\n',
    ],
    [
      'a GitHub alert',
      '> [!WARNING]\n> Careful.\n',
      '<blockquote data-alert="warning" data-source-lines="1-2">\n<p data-source-lines="1-2">Careful.</p>\n</blockquote>\n',
    ],
    [
      'front matter as a YAML block',
      '---\ntitle: x\n---\nBody\n',
      '<pre><code data-source-lines="1-3" class="language-yaml">title: x\n</code></pre>\n<p data-source-lines="4-4">Body</p>\n',
    ],
    [
      'a raw HTML block after its line marker',
      '<details>\n<summary>More</summary>\n\nHidden\n\n</details>\n',
      '<span data-html-lines="1-2"></span><details>\n<summary>More</summary>\n<p data-source-lines="4-4">Hidden</p>\n<span data-html-lines="6-6"></span></details>\n',
    ],
    [
      'raw HTML handlers renamed for the sanitizer to drop',
      '<div onclick="a()" title="on=1">x <img/onerror=b()></div>\n\nText <span onmouseover="c">i</span>\n',
      '<span data-html-lines="1-1"></span><div data-dropped-onclick="a()" title="on=1">x <img/data-dropped-onerror=b()></div>\n<p data-source-lines="3-3">Text <span data-dropped-onmouseover="c">i</span></p>\n',
    ],
    [
      'GitHub emoji shortcodes, not emoticons',
      'Ship :tada: :) :shipit:\n',
      '<p data-source-lines="1-1">Ship 🎉 :) :shipit:</p>\n',
    ],
    [
      'footnotes',
      'Text[^1]\n\n[^1]: Note.\n',
      '<p data-source-lines="1-1">Text<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup></p>\n<hr class="footnotes-sep">\n<section class="footnotes">\n<ol class="footnotes-list">\n<li id="fn1" class="footnote-item"><p data-source-lines="3-3">Note. <a href="#fnref1" class="footnote-backref">↩︎</a></p>\n</li>\n</ol>\n</section>\n',
    ],
  ])('%s', ([, source, expected], { expect }) => {
    expect(createMarkdownIt().render(source)).toBe(expected);
  });
});
