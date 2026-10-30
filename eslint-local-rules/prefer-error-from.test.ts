import { createRuleTester } from './create-rule-tester.ts';
import { preferErrorFrom } from './prefer-error-from.ts';

createRuleTester().run('prefer-error-from', preferErrorFrom, {
  valid: [
    'const errorFrom = (e: unknown): Error => new Error("x"); const message = errorFrom(e).message;',
    // The fallback is a fixed message, not String(value).
    "const text = Error.isError(error) ? error.message : 'The editor could not start.';",
    // Strings of a value that is not the tested one.
    'const text = Error.isError(error) ? error.message : String(other);',
    // The same text compared with something other than Error.
    'const text = error instanceof Foo ? error.message : String(error);',
    'const text = Error.isError(error) ? 1 : 2;',
    // Not a catch parameter.
    'function f(count: number): string { return String(count); }',
    'function f(): string { const error = 1; try { g(); } catch { return String(error); } return ""; } declare function g(): void;',
    // Shadowed by an ordinary variable inside the catch.
    'try { g(); } catch (error) { const error2 = 1; String(error2); } declare function g(): void;',
    // Strings the caught error's message, not the error.
    'try { g(); } catch (error: unknown) { if (Error.isError(error)) { String(error.message); } } declare function g(): void;',
  ],
  invalid: [
    {
      code: 'const text = Error.isError(error) ? error.message : String(error);',
      errors: [{ messageId: 'conditional', data: { value: 'error' } }],
    },
    {
      code: 'const text = error instanceof Error ? error.message : String(error);',
      errors: [{ messageId: 'conditional', data: { value: 'error' } }],
    },
    {
      code: 'const text = !Error.isError(error) ? String(error) : error.message;',
      errors: [{ messageId: 'conditional', data: { value: 'error' } }],
    },
    {
      code: 'const wrapped = Error.isError(cause) ? cause : new Error(String(cause));',
      errors: [{ messageId: 'conditional', data: { value: 'cause' } }],
    },
    {
      code: 'const text = Error.isError(failure) && failure.name !== "AbortError" ? failure.message : `failed: ${String(failure)}`;',
      errors: [{ messageId: 'conditional', data: { value: 'failure' } }],
    },
    {
      code: 'const text = Error.isError(result.error) ? result.error.message : String(result.error);',
      errors: [{ messageId: 'conditional', data: { value: 'result.error' } }],
    },
    // One report for a conditional inside a catch, not two.
    {
      code: 'try { g(); } catch (error: unknown) { log(Error.isError(error) ? error.message : String(error)); } declare function g(): void; declare function log(text: string): void;',
      errors: [{ messageId: 'conditional', data: { value: 'error' } }],
    },
    {
      code: 'try { g(); } catch (error: unknown) { log(`failed: ${String(error)}`); } declare function g(): void; declare function log(text: string): void;',
      errors: [{ messageId: 'caught', data: { value: 'error' } }],
    },
    {
      code: 'async function f(): Promise<string> { try { await g(); return ""; } catch (cause) { return String(cause); } } declare function g(): Promise<void>;',
      errors: [{ messageId: 'caught', data: { value: 'cause' } }],
    },
  ],
});
