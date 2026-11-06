import css from '@eslint/css';
import path from 'node:path';

import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { litCssProcessor } from './lit-css-processor.ts';

describe('litCssProcessor', () => {
  test('reports a css template’s problem at its line and column in the file', async ({
    expect,
  }) => {
    const messages = await lint(
      ['const styles = css`', '  .a {', '    colour: red;', '  }', '`;'].join('\n'),
    );
    expect(messages).toMatchObject([
      { ruleId: 'css/no-invalid-properties', line: 3, column: 5, endLine: 3 },
    ]);
  });

  test('counts the first line’s column from the template’s backtick', async ({ expect }) => {
    const messages = await lint('const styles = css`.a { overflow-x: auto; }`;');
    expect(messages).toMatchObject([
      { ruleId: 'css/prefer-logical-properties', line: 1, column: 25 },
    ]);
  });

  test('reads a composed module as a comment and a value as var(), keeping lines', async ({
    expect,
  }) => {
    const messages = await lint(
      [
        'const styles = css`',
        '  ${focusRing}',
        '  .a {',
        '    inline-size: ${size(',
        '      2,',
        '    )};',
        '    overflow-y: auto;',
        '  }',
        '`;',
      ].join('\n'),
    );
    expect(messages).toMatchObject([
      { ruleId: 'css/prefer-logical-properties', line: 7, column: 5 },
    ]);
  });

  test('leaves templates in comments and other tags alone, and reports no fix', async ({
    expect,
  }) => {
    const messages = await lint(
      [
        '// css`.a { colour: red; }`',
        'const page = html`<p style="colour: red"></p>`;',
        'const styles = css`.a { overflow-x: auto; }`;',
      ].join('\n'),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toHaveProperty('fix');
    expect(messages[0]).not.toHaveProperty('suggestions');
  });
});

/** Lints `code` as a file under the repository, as the CLI would, with the processor and @eslint/css. */
async function lint(code: string): Promise<Linter.LintMessage[]> {
  const root = path.resolve(import.meta.dirname, '..');
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.js'], processor: litCssProcessor },
      {
        files: ['**/*.css'],
        plugins: { css },
        language: 'css/css',
        rules: {
          'css/no-invalid-properties': ['error', { allowUnknownVariables: true }],
          'css/prefer-logical-properties': 'error',
        },
      },
    ],
  });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, 'eslint-local-rules/testing/styles.js'),
  });
  return result?.messages ?? [];
}
