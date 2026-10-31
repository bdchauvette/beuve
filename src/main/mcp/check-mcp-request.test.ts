import { describe } from 'vitest';

import { checkMcpRequest } from './check-mcp-request.ts';
import type { McpRequestHeaders, McpServerSecret } from './check-mcp-request.ts';
import { test } from '../testing/test.ts';

function expected(): McpServerSecret {
  return { port: 4000, token: 'secret' };
}

function authorization(): string {
  return 'Bearer secret';
}

describe('checkMcpRequest', () => {
  test('admits loopback hosts with the token', ({ expect }) => {
    expect(
      checkMcpRequest({ host: '127.0.0.1:4000', authorization: authorization() }, expected()).ok,
    ).toBe(true);
    expect(
      checkMcpRequest(
        { host: 'LOCALHOST:4000', origin: 'http://localhost:4000', authorization: authorization() },
        expected(),
      ).ok,
    ).toBe(true);
  });

  test.for<[McpRequestHeaders, number]>([
    [{ authorization: authorization() }, 403],
    [{ host: '127.0.0.1:4001', authorization: authorization() }, 403],
    [{ host: 'rebound.example:4000', authorization: authorization() }, 403],
    [{ host: '127.0.0.1:4000', origin: 'null', authorization: authorization() }, 403],
    [
      {
        host: '127.0.0.1:4000',
        origin: 'http://127.0.0.1:4000.evil',
        authorization: authorization(),
      },
      403,
    ],
    [{ host: '127.0.0.1:4000' }, 401],
    [{ host: '127.0.0.1:4000', authorization: 'secret' }, 401],
    [{ host: '127.0.0.1:4000', authorization: 'Bearer secret2' }, 401],
  ])('rejects %o with %i', ([headers, status], { expect }) => {
    const checked = checkMcpRequest(headers, expected());
    expect(checked).toMatchObject({ ok: false, error: { status } });
  });
});
