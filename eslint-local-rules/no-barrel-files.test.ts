import { createRuleTester } from './create-rule-tester.ts';
import { noBarrelFiles } from './no-barrel-files.ts';

createRuleTester().run('no-barrel-files', noBarrelFiles, {
  valid: [
    'export function a(): void {}',
    'const a = 1; export { a };',
    "import { b } from './b.ts'; export function a(): number { return b; }",
    "import { b } from './b.ts'; export function a(): number { const b2 = b; return b2; }",
  ],
  invalid: [
    { code: "export * from './a.ts';", errors: [{ messageId: 'noExportAll' }] },
    { code: "export * as a from './a.ts';", errors: [{ messageId: 'noExportAll' }] },
    {
      code: "export { a } from './a.ts';",
      errors: [{ messageId: 'noReExport', data: { source: './a.ts' } }],
    },
    {
      code: "export type { A } from './a.ts';",
      errors: [{ messageId: 'noReExport', data: { source: './a.ts' } }],
    },
    {
      code: "import { a } from './a.ts'; export { a };",
      errors: [{ messageId: 'noImportedReExport', data: { name: 'a' } }],
    },
  ],
});
