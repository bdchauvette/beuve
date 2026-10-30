import { DiffHunksRenderer, hastToHtml, processFile, setLanguageOverride } from '@pierre/diffs';

/** How a diff is rendered: the card's options (`beuve-file-card.ts`) and the ones it leaves out. */
export interface DiffHtmlOptions {
  readonly diffStyle: 'split' | 'unified';
  /** The card uses `line-info`; `metadata` renders each hunk header's text. */
  readonly hunkSeparators: 'line-info' | 'metadata';
  /** A language override, as the card sets `text` for languages beuve does not ship. */
  readonly language?: string;
}

/** The file name `@pierre/diffs` parsed from a patch, and the HTML strings it renders for it. */
export interface DiffHtml {
  readonly name: string;
  readonly previousName: string | undefined;
  readonly html: readonly string[];
}

/**
 * Renders `patch` through the code paths `FileDiff` takes to build the HTML it assigns to
 * `innerHTML` (`applyHeaderToDOM`, `replaceCodeColumns`): `processFile` parses it as the card
 * does, `DiffHunksRenderer` builds the hast, and `hastToHtml` serializes the file header and
 * each code column's gutter and content. No DOM is needed.
 */
export async function renderDiffHtml(patch: string, options: DiffHtmlOptions): Promise<DiffHtml> {
  const parsed = processFile(patch, { cacheKey: patch, isGitDiff: true });
  if (parsed === undefined) {
    throw new TypeError(`@pierre/diffs found no file in ${JSON.stringify(patch)}`);
  }
  const metadata =
    options.language === undefined ? parsed : setLanguageOverride(parsed, options.language);
  const renderer = new DiffHunksRenderer({
    theme: 'pierre-light',
    preferredHighlighter: 'shiki-js',
    diffStyle: options.diffStyle,
    hunkSeparators: options.hunkSeparators,
    lineDiffType: 'word-alt',
    overflow: 'scroll',
  });
  try {
    const result = await renderer.asyncRender(metadata);
    const header = result.headerElement === undefined ? [] : [hastToHtml(result.headerElement)];
    const columns = (['unified', 'deletions', 'additions'] as const)
      .map((type) => ({ type, ast: renderer.renderCodeAST(type, result) }))
      .filter((column) => column.ast !== undefined)
      .map(({ type, ast = [] }) => renderer.renderPartialHTML(ast, type));
    return { name: metadata.name, previousName: metadata.prevName, html: [...header, ...columns] };
  } finally {
    renderer.cleanUp();
  }
}
