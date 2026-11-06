import type { Linter } from 'eslint';
import ts from 'typescript';

/** A `css` template's text as CSS, and where its first character sits in the source. */
interface CssBlock {
  readonly text: string;
  /** Zero-based line of the character after the opening backtick. */
  readonly line: number;
  /** Zero-based column of that character. */
  readonly column: number;
}

const sourceFiles = new Map<string, readonly CssBlock[]>();

/**
 * Hands each Lit `css` template of a TypeScript file to `@eslint/css` as a virtual `N.css` block
 * (ADR 0118), so its rules check the components' CSS as they check `index.css`. The file itself
 * is linted as it was. Every template keeps its lines: a `${…}` alone on its line, a composed
 * style module, becomes a comment, and one inside a value becomes `var(--interpolated)`, padded
 * with the newlines the expression spanned. Messages map back by the template's line and, on its
 * first line, column. Fixes in a block are dropped: their ranges are the block's, not the file's.
 */
export const litCssProcessor: Linter.Processor = {
  meta: { name: 'lit-css' },
  supportsAutofix: true,
  preprocess(text: string, filename: string): (string | Linter.ProcessorFile)[] {
    const blocks = cssBlocksFrom({ text, filename });
    sourceFiles.set(filename, blocks);
    return [
      text,
      ...blocks.map((block, index) => {
        return { text: block.text, filename: `${String(index)}.css` };
      }),
    ];
  },
  postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
    const blocks = sourceFiles.get(filename) ?? [];
    sourceFiles.delete(filename);
    const [own = [], ...fromBlocks] = messages;
    return [
      ...own,
      ...fromBlocks.flatMap((blockMessages, index) => {
        const block = blocks[index];
        if (block === undefined) {
          return [];
        }
        return blockMessages.map((message) => messageInSource(message, block));
      }),
    ];
  },
};

/** A file to find `css` templates in. */
interface SourceText {
  readonly text: string;
  readonly filename: string;
}

function cssBlocksFrom({ text, filename }: SourceText): CssBlock[] {
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const blocks: CssBlock[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === 'css'
    ) {
      blocks.push(cssBlockFrom(source, node.template));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return blocks;
}

function cssBlockFrom(source: ts.SourceFile, template: ts.TemplateLiteral): CssBlock {
  const start = template.getStart(source) + 1;
  const end = template.getEnd() - 1;
  const { line, character } = source.getLineAndCharacterOfPosition(start);
  let text = source.text.slice(start, end);
  if (ts.isTemplateExpression(template)) {
    for (const span of template.templateSpans.toReversed()) {
      const from = span.expression.getStart(source) - 2 - start;
      const to = span.expression.getEnd() + 1 - start;
      const original = text.slice(from, to);
      text = text.slice(0, from) + placeholderFor({ text, from, original }) + text.slice(to);
    }
  }
  return { text, line, column: character };
}

/** Where a `${…}` sits in a template, and what it says. */
interface Substitution {
  readonly text: string;
  readonly from: number;
  readonly original: string;
}

/** A comment for a `${…}` alone on its line, else a value; either keeps the newlines it spanned. */
function placeholderFor({ text, from, original }: Substitution): string {
  const newlines = '\n'.repeat(original.split('\n').length - 1);
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', from + original.length);
  const before = text.slice(lineStart, from);
  let afterEnd = lineEnd;
  if (afterEnd === -1) {
    afterEnd = text.length;
  }
  const after = text.slice(from + original.length, afterEnd);
  if (before.trim() === '' && after.trim() === '') {
    return `/* composed */${newlines}`;
  }
  return `var(--interpolated)${newlines}`;
}

function messageInSource(message: Linter.LintMessage, block: CssBlock): Linter.LintMessage {
  const mapped: Linter.LintMessage = {
    ...message,
    line: message.line + block.line,
    column: sourceColumn({ position: message, block }),
  };
  if (message.endLine !== undefined && message.endColumn !== undefined) {
    mapped.endLine = message.endLine + block.line;
    mapped.endColumn = sourceColumn({
      position: { line: message.endLine, column: message.endColumn },
      block,
    });
  }
  delete mapped.fix;
  delete mapped.suggestions;
  return mapped;
}

/** A line and column in a block, one-based as ESLint reports them. */
interface BlockPosition {
  readonly line: number;
  readonly column: number;
}

/** A block position's column in the file. */
interface ColumnInBlock {
  readonly position: BlockPosition;
  readonly block: CssBlock;
}

/** Only a block's first line is indented by where the template starts; the rest keep the file's columns. */
function sourceColumn({ position, block }: ColumnInBlock): number {
  if (position.line === 1) {
    return position.column + block.column;
  }
  return position.column;
}
