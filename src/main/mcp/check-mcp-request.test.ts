import { describe, expect, it } from 'vitest';

import { checkMcpRequest } from './check-mcp-request.ts';

const expected = { port: 4000, token: 'secret' };
const authorization = 'Bearer secret';

describe('checkMcpRequest', () => {
  it('admits loopback hosts with the token', () => {
    expect(checkMcpRequest({ host: '127.0.0.1:4000', authorization }, expected).ok).toBe(true);
    expect(
      checkMcpRequest(
        { host: 'LOCALHOST:4000', origin: 'http://localhost:4000', authorization },
        expected,
      ).ok,
    ).toBe(true);
  });

  it.each([
    [{ authorization }, 403],
    [{ host: '127.0.0.1:4001', authorization }, 403],
    [{ host: 'rebound.example:4000', authorization }, 403],
    [{ host: '127.0.0.1:4000', origin: 'null', authorization }, 403],
    [{ host: '127.0.0.1:4000', origin: 'http://127.0.0.1:4000.evil', authorization }, 403],
    [{ host: '127.0.0.1:4000' }, 401],
    [{ host: '127.0.0.1:4000', authorization: 'secret' }, 401],
    [{ host: '127.0.0.1:4000', authorization: 'Bearer secret2' }, 401],
  ])('rejects %o with %i', (headers, status) => {
    const checked = checkMcpRequest(headers, expected);
    expect(checked.ok ? undefined : checked.error.status).toBe(status);
  });
});
