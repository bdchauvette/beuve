import { createRuleTester } from './create-rule-tester.ts';
import { enforceSingleNamedExport } from './enforce-single-named-export.ts';

createRuleTester().run('enforce-single-named-export', enforceSingleNamedExport, {
  valid: [
    'export function createLogger(): void {}',
    'export class LruCache {}',
    'export const ok = 1;',
    'const a = 1; export { a };',
    'export type A = string; export interface B { b: number } export function c(): void {}',
    'export type A = string;',
    'interface A { a: string } export type { A }; export function f(): void {}',
    'type A = string; export { type A }; export const f = 1;',
    'export declare const x: number; export function f(): void {}',
    { code: 'console.log(1);', options: [{ allowNoExports: true }] },
  ],
  invalid: [
    {
      code: 'export default function f(): void {}',
      errors: [{ messageId: 'noDefaultExport' }],
    },
    {
      code: 'const a = 1; export default a;',
      errors: [{ messageId: 'noDefaultExport' }],
    },
    {
      code: 'export function a(): void {} export function b(): void {}',
      errors: [{ messageId: 'tooManyExports', data: { name: 'b' } }],
    },
    {
      code: 'export const a = 1, b = 2;',
      errors: [{ messageId: 'tooManyExports', data: { name: 'b' } }],
    },
    {
      code: 'const a = 1; const b = 2; export { a, b };',
      errors: [{ messageId: 'tooManyExports', data: { name: 'b' } }],
    },
    {
      code: "export function a(): void {} export * from './b.ts';",
      errors: [{ messageId: 'tooManyExports', data: { name: '*' } }],
    },
    {
      code: 'console.log(1);',
      errors: [{ messageId: 'missingExport' }],
    },
  ],
});
