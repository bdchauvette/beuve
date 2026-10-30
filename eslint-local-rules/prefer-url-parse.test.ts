import { createRuleTester } from './create-rule-tester.ts';
import { preferUrlParse } from './prefer-url-parse.ts';

createRuleTester().run('prefer-url-parse', preferUrlParse, {
  valid: [
    'const url = URL.parse(text); const host = url?.hostname;',
    "function f(text: string): boolean { return URL.canParse(text) && new URL(text).protocol === 'https:'; }",
    // The handler rethrows: the failure is not a fallback.
    "function f(text: string): URL { try { return new URL(text); } catch (error) { throw new Error('bad url', { cause: error }); } }",
    // A `finally` means the `try` guards more than the parse.
    'function f(text: string): void { try { new URL(text); } catch { return; } finally { g(); } } declare function g(): void;',
    // The `new URL` sits in a closure the `try` only creates.
    'function f(text: string): () => URL { try { return () => new URL(text); } catch { return () => new URL("x:"); } }',
    // Only the handler parses.
    'function f(text: string): URL | undefined { try { return g(); } catch { return new URL(text); } } declare function g(): URL;',
    'function f(): void { try { g(); } catch { return; } } declare function g(): void;',
  ],
  invalid: [
    {
      code: 'function f(text: string): string | undefined { try { return new URL(text).hostname; } catch { return undefined; } }',
      errors: [{ messageId: 'preferUrlParse' }],
    },
    {
      code: 'function f(text: string): boolean { let host: string; try { host = new URL(text).hostname; } catch { return false; } return host !== ""; }',
      errors: [{ messageId: 'preferUrlParse' }],
    },
    {
      code: 'function f(text: string): string { let origin = text; try { origin = new URL(text).origin; } catch { /* shown as given */ } return origin; }',
      errors: [{ messageId: 'preferUrlParse' }],
    },
    {
      code: 'function f(text: string, base: URL): URL | undefined { try { if (text) { return new URL(text, base); } return undefined; } catch (error) { return undefined; } }',
      errors: [{ messageId: 'preferUrlParse' }],
    },
  ],
});
