import { describe, expect, it } from 'vitest';

import { parseServerCapabilities } from './parse-server-capabilities.ts';
import { positionEncodings } from './position-encodings.ts';

describe('parseServerCapabilities', () => {
  it('reads providers and the negotiated encoding, defaulting to UTF-16', () => {
    expect(
      parseServerCapabilities({
        capabilities: {
          positionEncoding: positionEncodings.utf8,
          callHierarchyProvider: {},
          hoverProvider: true,
          definitionProvider: false,
        },
      }),
    ).toMatchObject({
      positionEncoding: positionEncodings.utf8,
      callHierarchy: true,
      hover: true,
      definition: false,
      pullDiagnostics: false,
    });
    expect(
      parseServerCapabilities({ capabilities: { positionEncoding: 'ucs-2' } })?.positionEncoding,
    ).toBe(positionEncodings.utf16);
    expect(parseServerCapabilities({})).toBeUndefined();
  });
});
