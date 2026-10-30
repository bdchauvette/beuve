import { createRuleTester } from './create-rule-tester.ts';
import { exportNameMatchesFilename } from './export-name-matches-filename.ts';

createRuleTester().run('export-name-matches-filename', exportNameMatchesFilename, {
  valid: [
    { code: 'export function createLogger(): void {}', filename: 'src/x/create-logger.ts' },
    { code: 'export class LruCache {}', filename: 'src/x/lru-cache.ts' },
    { code: 'export const LruCache = class {};', filename: 'src/x/lru-cache.ts' },
    { code: 'export const ok = 1;', filename: 'src/x/ok.ts' },
    { code: 'const isOk = 1; export { isOk };', filename: 'src/x/is-ok.ts' },
    { code: 'export type Anything = string;', filename: 'src/x/result.ts' },
    { code: 'export interface Whatever { a: 1 }', filename: 'src/x/brand.ts' },
    { code: 'export function openDatabase(): void {}', filename: 'open-database.test.ts' },
  ],
  invalid: [
    {
      code: 'export function makeLogger(): void {}',
      filename: 'src/x/create-logger.ts',
      errors: [{ messageId: 'mismatch', data: { actual: 'makeLogger', expected: 'createLogger' } }],
    },
    {
      code: 'export class lruCache {}',
      filename: 'src/x/lru-cache.ts',
      errors: [{ messageId: 'mismatch', data: { actual: 'lruCache', expected: 'LruCache' } }],
    },
    {
      code: 'export const CreateLogger = 1;',
      filename: 'src/x/create-logger.ts',
      errors: [
        { messageId: 'mismatch', data: { actual: 'CreateLogger', expected: 'createLogger' } },
      ],
    },
    {
      code: 'const a = 1; export { a as b };',
      filename: 'src/x/a.ts',
      errors: [{ messageId: 'mismatch', data: { actual: 'b', expected: 'a' } }],
    },
  ],
});
