import { noStringTailSlice } from './no-string-tail-slice.ts';
import { createTypedRuleTester } from './testing/create-typed-rule-tester.ts';

createTypedRuleTester().run('no-string-tail-slice', noStringTailSlice, {
  valid: [
    'declare const text: string; const head = text.slice(0, 5);',
    'declare const text: string; const rest = text.slice(5);',
    'declare const parts: string[]; const last = parts.slice(-2);',
    'declare const bytes: Uint8Array; const tail = bytes.slice(-4);',
    'declare const text: string; const last = text.at(-1);',
    'declare const text: string; const cut = text.slice(-2, -1);',
    'declare const value: string | string[]; const tail = value.slice(-2);',
  ],
  invalid: [
    {
      code: 'declare const text: string; const tail = text.slice(-4096);',
      errors: [{ messageId: 'useTailOf' }],
    },
    {
      code: 'declare const text: string; declare const limit: number; const tail = (text + "x").slice(-limit);',
      errors: [{ messageId: 'useTailOf' }],
    },
    {
      code: 'const tail = `${1}`.trim().slice(-2);',
      errors: [{ messageId: 'useTailOf' }],
    },
    {
      code: 'declare const text: "a" | "b"; const tail = text.slice(-1);',
      errors: [{ messageId: 'useTailOf' }],
    },
  ],
});
