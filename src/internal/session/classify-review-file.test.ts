import { describe } from 'vitest';

import { classifyReviewFile } from './classify-review-file.ts';
import type { FileFacts } from './mechanical-rules.ts';
import { test } from './testing/test.ts';

function ordinary(): FileFacts {
  return { isGenerated: false, isWhitespaceOnly: false, isPureRename: false };
}

describe('classifyReviewFile', () => {
  test.for<[string, string]>([
    ['package-lock.json', 'lockfile'],
    ['web/yarn.lock', 'lockfile'],
    ['pnpm-lock.yaml', 'lockfile'],
    ['Cargo.lock', 'lockfile'],
    ['go.sum', 'lockfile'],
    ['dist/app.min.js', 'generated'],
    ['dist/app.js.map', 'generated'],
    ['api/service.pb.go', 'generated'],
    ['package.json', 'config'],
    ['packages/a/package.json', 'config'],
    ['tsconfig.json', 'config'],
    ['src/ui/tsconfig.build.json', 'config'],
    ['vitest.config.ts', 'config'],
    ['apps/web/vite.config.mjs', 'config'],
    ['eslint.config.js', 'config'],
    ['.eslintrc.cjs', 'config'],
    ['.prettierrc', 'config'],
    ['.prettierignore', 'config'],
    ['.github/workflows/ci.yml', 'config'],
    ['.github/CODEOWNERS', 'config'],
    ['electron-builder.yml', 'config'],
    ['Cargo.toml', 'config'],
    ['.node-version', 'config'],
  ])('puts %s in the group for %s', ([path, reason], { expect }) => {
    expect(classifyReviewFile(path, ordinary())).toBe(reason);
  });

  test.for<[string]>([
    ['src/main/index.ts'],
    ['src/config.ts'],
    ['docs/config.md'],
    ['src/deploy/values.yaml'],
    ['README.md'],
    ['src/package.json.ts'],
    ['src/lockfile.ts'],
  ])('leaves %s as an ordinary file', ([path], { expect }) => {
    expect(classifyReviewFile(path, ordinary())).toBeUndefined();
  });

  test('uses what git says about the file', ({ expect }) => {
    expect(classifyReviewFile('src/a.ts', { ...ordinary(), isGenerated: true })).toBe('generated');
    expect(classifyReviewFile('src/a.ts', { ...ordinary(), isPureRename: true })).toBe(
      'pure-rename',
    );
    expect(classifyReviewFile('src/a.ts', { ...ordinary(), isWhitespaceOnly: true })).toBe(
      'formatting-only',
    );
  });

  test('takes the most specific reason first', ({ expect }) => {
    const everything: FileFacts = { isGenerated: true, isWhitespaceOnly: true, isPureRename: true };
    expect(classifyReviewFile('package-lock.json', everything)).toBe('lockfile');
    expect(classifyReviewFile('package.json', everything)).toBe('generated');
    expect(classifyReviewFile('package.json', { ...ordinary(), isWhitespaceOnly: true })).toBe(
      'formatting-only',
    );
  });

  test('applies rules given as data', ({ expect }) => {
    const rules = [{ reason: 'config', kind: 'path', pattern: /^vendor\// }] as const;
    expect(classifyReviewFile('vendor/x.js', ordinary(), rules)).toBe('config');
    expect(classifyReviewFile('package.json', ordinary(), rules)).toBeUndefined();
  });
});
