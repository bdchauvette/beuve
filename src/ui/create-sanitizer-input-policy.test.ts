import { describe } from 'vitest';

import { createSanitizerInputPolicy } from './create-sanitizer-input-policy.ts';
import type { PolicyFactory } from './create-sanitizer-input-policy.ts';
import { test } from './testing/test.ts';

interface FakeFactory {
  readonly factory: PolicyFactory;
  readonly created: Map<string, TrustedTypePolicyOptions>;
}

interface AdmittedOptions extends TrustedHTMLParserOptions {
  readonly admitted: SetHTMLOptions;
}

type PolicyShape = (
  policy: TrustedTypePolicy,
  options: TrustedTypePolicyOptions,
) => TrustedTypePolicy;

/** A `trustedTypes` that records each policy's options, and gives its policies `shape`. */
function fakeFactory(shape: PolicyShape): FakeFactory {
  const created = new Map<string, TrustedTypePolicyOptions>();
  const factory: PolicyFactory = {
    createPolicy: (name: string, options: TrustedTypePolicyOptions): TrustedTypePolicy => {
      created.set(name, options);
      return shape(
        {
          name,
          createHTML: (input: string): TrustedHTML => {
            return {
              toString: (): string => {
                return `admitted ${options.createHTML?.(input, '', '') ?? ''}`;
              },
            };
          },
          createScriptURL: (): TrustedScriptURL => {
            throw new TypeError('no createScriptURL');
          },
        },
        options,
      );
    },
  };
  return { factory, created };
}

/** Chromium 158's policies admit parser options through `createParserOptions`. */
function chromium158(
  policy: TrustedTypePolicy,
  options: TrustedTypePolicyOptions,
): TrustedTypePolicy {
  return {
    ...policy,
    createParserOptions: (input: SetHTMLOptions): AdmittedOptions => {
      return {
        [Symbol.toStringTag]: 'TrustedHTMLParserOptions',
        admitted: options.createParserOptions?.(input) ?? {},
      };
    },
  };
}

/** Chromium 156's policies lack the method, and its factory ignores the unknown option. */
function chromium156(policy: TrustedTypePolicy): TrustedTypePolicy {
  return policy;
}

describe('createSanitizerInputPolicy', () => {
  test('creates one pass-through policy named beuve-sanitizer-input', ({ expect }) => {
    const { factory, created } = fakeFactory(chromium158);
    const input = createSanitizerInputPolicy(factory);
    expect(created.keys().toArray()).toStrictEqual(['beuve-sanitizer-input']);
    expect(String(input.createHTML('<b>b</b>'))).toBe('admitted <b>b</b>');
    const options = { sanitizer: { removeElements: ['b'] } };
    expect(created.get('beuve-sanitizer-input')?.createParserOptions?.(options)).toBe(options);
  });

  test('admits the parser options where they are a sink (Chromium 158)', ({ expect }) => {
    const { factory } = fakeFactory(chromium158);
    const options = { sanitizer: { removeElements: ['b'] } };
    expect(createSanitizerInputPolicy(factory).createParserOptions(options)).toStrictEqual({
      [Symbol.toStringTag]: 'TrustedHTMLParserOptions',
      admitted: options,
    });
  });

  test('passes the parser options as they are where they are not (Chromium 156)', ({ expect }) => {
    const { factory } = fakeFactory(chromium156);
    const input = createSanitizerInputPolicy(factory);
    const options = { sanitizer: { removeElements: ['b'] } };
    expect(input.createParserOptions(options)).toBe(options);
    expect(String(input.createHTML('<i>i</i>'))).toBe('admitted <i>i</i>');
  });
});
