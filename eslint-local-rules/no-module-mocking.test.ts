import { createRuleTester } from './create-rule-tester.ts';
import { noModuleMocking } from './no-module-mocking.ts';

createRuleTester().run('no-module-mocking', noModuleMocking, {
  valid: [
    "const service = { run: (): number => 1 }; vi.spyOn(service, 'run');",
    'const listener = vi.fn();',
    "test('a', ({ logger }) => { vi.spyOn(logger, 'info'); });",
  ],
  invalid: [
    {
      code: "vi.mock('node:fs');",
      errors: [{ messageId: 'noModuleMock', data: { method: 'mock' } }],
    },
    {
      code: "vi['doMock']('node:fs');",
      errors: [{ messageId: 'noModuleMock', data: { method: 'doMock' } }],
    },
    { code: 'const mocks = vi.hoisted(() => ({}));', errors: [{ messageId: 'noModuleMock' }] },
    { code: "vitest.mock('./a.ts');", errors: [{ messageId: 'noModuleMock' }] },
    {
      code: "import fs from 'node:fs'; vi.spyOn(fs, 'readFileSync');",
      errors: [{ messageId: 'noSpyOnImport', data: { name: 'fs' } }],
    },
    {
      code: "import * as fs from 'node:fs'; vi.spyOn(fs.promises, 'readFile');",
      errors: [{ messageId: 'noSpyOnImport', data: { name: 'fs' } }],
    },
    {
      code: "import process from 'node:process'; vi.spyOn(process, 'cwd');",
      errors: [{ messageId: 'noSpyOnImport', data: { name: 'process' } }],
    },
  ],
});
