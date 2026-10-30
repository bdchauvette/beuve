// The parts of Trusted Types and the HTML Sanitizer API that TypeScript 6.0's DOM lib lacks (ADR
// 0077). Only the renderer's project (`src/ui/tsconfig.json`) includes this file.

/** A string that a Trusted Types policy admitted as HTML. */
interface TrustedHTML {
  toString(): string;
}

/** A string that a Trusted Types policy admitted as a script URL. */
interface TrustedScriptURL {
  toString(): string;
}

/** The conversions a policy offers; a sink whose conversion is missing throws. */
interface TrustedTypePolicyOptions {
  createHTML?: (input: string, type: string, sink: string) => string;
  createScriptURL?: (input: string, type: string, sink: string) => string;
}

/** A named policy, created once per document unless the CSP says `'allow-duplicates'`. */
interface TrustedTypePolicy {
  readonly name: string;
  createHTML(input: string): TrustedHTML;
  createScriptURL(input: string): TrustedScriptURL;
}

/** `globalThis.trustedTypes`. */
interface TrustedTypePolicyFactory {
  readonly defaultPolicy: TrustedTypePolicy | null;
  createPolicy(name: string, options: TrustedTypePolicyOptions): TrustedTypePolicy;
}

// Absent where Trusted Types is not implemented, so read it as `globalThis.trustedTypes`.
// eslint-disable-next-line no-var -- a global property is declared with `var`.
declare var trustedTypes: TrustedTypePolicyFactory | undefined;

/** The `sanitizer` option of `setHTML`, `Document.parseHTML` and `Document.parseHTMLUnsafe`. */
interface SetHTMLOptions {
  sanitizer?: Sanitizer | SanitizerConfig | SanitizerPresets;
}

interface Element {
  /** Parses `html`, removes everything unsafe and what the sanitizer removes, and replaces the children. */
  setHTML(html: string, options?: SetHTMLOptions): void;
}

interface ShadowRoot {
  /** Parses `html`, removes everything unsafe and what the sanitizer removes, and replaces the children. */
  setHTML(html: string, options?: SetHTMLOptions): void;
}

/** The static parsers on `Document`, which the DOM lib declares without their options. */
interface DocumentParsers {
  /** Parses into an inert document, always removing unsafe markup. */
  parseHTML(html: string, options?: SetHTMLOptions): Document;
  /** Parses into an inert document, removing only what the sanitizer removes. A Trusted Types sink. */
  parseHTMLUnsafe(html: TrustedHTML | string, options?: SetHTMLOptions): Document;
}
