import type { MarkdownRenderers } from './create-markdown-nodes.ts';

/**
 * The renderers for Markdown that cites nothing and needs no highlighting (a pull request body,
 * a finding's body): a `[[…]]` marker stays text and a fenced block is a plain `<pre>`.
 */
export function createPlainMarkdownRenderers(): MarkdownRenderers {
  return {
    marker: (text): Node => {
      return document.createTextNode(text);
    },
    code: (block): Element => {
      const pre = document.createElement('pre');
      pre.textContent = block.text;
      return pre;
    },
  };
}
