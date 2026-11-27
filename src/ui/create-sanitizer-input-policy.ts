/** The part of `trustedTypes` the policy is created with. */
export type PolicyFactory = Pick<TrustedTypePolicyFactory, 'createPolicy'>;

/** What the sanitizing parse hands `parseHTMLUnsafe`: its HTML, and its options. */
export interface SanitizerInputPolicy {
  readonly createHTML: (html: string) => TrustedHTML;
  readonly createParserOptions: (
    options: SetHTMLOptions,
  ) => SetHTMLOptions | TrustedHTMLParserOptions;
}

/**
 * Creates `beuve-sanitizer-input`, the pass-through policy through which the sanitizing parse
 * hands `parseHTMLUnsafe` its input (ADR 0077). From Chromium 158 the parse's options are a
 * Trusted Types sink as well, so the policy admits them too. Chromium 156 (Electron 45) ignores
 * the policy's `createParserOptions` and its policies have no such method, so there the options
 * go as they are. The caller keeps the result in a closure; the CSP lets the name be created once.
 */
export function createSanitizerInputPolicy(factory: PolicyFactory): SanitizerInputPolicy {
  const policy = factory.createPolicy('beuve-sanitizer-input', {
    createHTML: (html: string): string => {
      return html;
    },
    createParserOptions: (options: SetHTMLOptions): SetHTMLOptions => {
      return options;
    },
  });
  const { createParserOptions } = policy;
  return {
    createHTML: (html: string): TrustedHTML => {
      return policy.createHTML(html);
    },
    createParserOptions: (options: SetHTMLOptions): SetHTMLOptions | TrustedHTMLParserOptions => {
      if (createParserOptions === undefined) {
        return options;
      }
      return createParserOptions.call(policy, options);
    },
  };
}
