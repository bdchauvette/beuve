import { FileRenderer, hastToHtml } from '@pierre/diffs';
import type { FileContents } from '@pierre/diffs';

/**
 * Renders `file` through the code paths `File` (a sheet, peek or chat code block) takes to build
 * the HTML it assigns to `innerHTML` (`applyHeaderToDOM`, `applyFullRender`): `FileRenderer`
 * builds the hast and `hastToHtml` serializes the header and the code column. No DOM is needed.
 */
export async function renderFileHtml(file: FileContents): Promise<readonly string[]> {
  const renderer = new FileRenderer({
    theme: 'pierre-light',
    preferredHighlighter: 'shiki-js',
    overflow: 'scroll',
  });
  try {
    const result = await renderer.asyncRender(file);
    const header = result.headerAST === undefined ? [] : [hastToHtml(result.headerAST)];
    return [...header, hastToHtml(renderer.renderCodeAST(result))];
  } finally {
    renderer.cleanUp();
  }
}
