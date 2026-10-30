import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseServerCapabilities } from './parse-server-capabilities.ts';
import { positionEncodings } from './position-encodings.ts';

describe('parseServerCapabilities', () => {
  test('reads providers and the negotiated encoding, defaulting to UTF-16', ({ expect }) => {
    expect(
      parseServerCapabilities({
        capabilities: {
          positionEncoding: positionEncodings.utf8,
          callHierarchyProvider: {},
          hoverProvider: true,
          definitionProvider: false,
          typeDefinitionProvider: true,
        },
      }),
    ).toMatchObject({
      positionEncoding: positionEncodings.utf8,
      callHierarchy: true,
      hover: true,
      definition: false,
      typeDefinition: true,
      pullDiagnostics: false,
    });
    expect(
      parseServerCapabilities({ capabilities: { positionEncoding: 'ucs-2' } })?.positionEncoding,
    ).toBe(positionEncodings.utf16);
    expect(parseServerCapabilities({})).toBeUndefined();
  });
});
