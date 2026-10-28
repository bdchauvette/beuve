import { describe, expect, it } from 'vitest';

import { classifyGithubResponse } from './classify-github-response.ts';

const now = new Date('2026-10-28T12:00:00Z');

function head(
  status: number,
  headers: Record<string, string> = {},
): Parameters<typeof classifyGithubResponse>[0] {
  return { status, headers: new Headers(headers) };
}

describe('classifyGithubResponse', () => {
  it('maps 401 to unauthorized', () => {
    expect(classifyGithubResponse(head(401), { message: 'Bad credentials' }, now)).toEqual({
      kind: 'unauthorized',
      message: 'Bad credentials',
    });
  });

  it('maps an exhausted primary rate limit to its reset time', () => {
    const error = classifyGithubResponse(
      head(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793188800' }),
      { message: 'API rate limit exceeded for user ID 1.' },
      now,
    );
    expect(error).toEqual({
      kind: 'rate-limited',
      message: 'API rate limit exceeded for user ID 1.',
      resetAt: '2026-10-28T12:00:00.000Z',
    });
  });

  it('maps a secondary rate limit with Retry-After', () => {
    const error = classifyGithubResponse(
      head(403, { 'retry-after': '60', 'x-ratelimit-remaining': '4000' }),
      { message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' },
      now,
    );
    expect(error).toMatchObject({ kind: 'rate-limited', resetAt: '2026-10-28T12:01:00.000Z' });
    expect(classifyGithubResponse(head(429), {}, now)).toMatchObject({ kind: 'rate-limited' });
  });

  it('keeps other 403s as forbidden, with the SAML authorization URL', () => {
    const error = classifyGithubResponse(
      head(403, {
        'x-github-sso': 'required; url=https://github.com/orgs/o/sso?authorization_request=x',
      }),
      { message: 'Resource protected by organization SAML enforcement.' },
      now,
    );
    expect(error).toEqual({
      kind: 'forbidden',
      message: 'Resource protected by organization SAML enforcement.',
      ssoUrl: 'https://github.com/orgs/o/sso?authorization_request=x',
    });
  });

  it('maps 404 and 410 to not-found', () => {
    expect(classifyGithubResponse(head(404), { message: 'Not Found' }, now)).toEqual({
      kind: 'not-found',
      message: 'Not Found',
    });
    expect(classifyGithubResponse(head(410), undefined, now)).toEqual({
      kind: 'not-found',
      message: 'HTTP 410',
    });
  });

  it('keeps 422 details whether GitHub sends strings or objects', () => {
    const error = classifyGithubResponse(
      head(422),
      {
        message: 'Validation Failed',
        errors: [
          'Pull request review thread line must be part of the diff',
          { resource: 'PullRequest', field: 'base', code: 'invalid', extra: 1 },
          7,
        ],
        documentation_url: 'https://docs.github.com/rest',
      },
      now,
    );
    expect(error).toEqual({
      kind: 'validation-failed',
      message: 'Validation Failed',
      errors: [
        { message: 'Pull request review thread line must be part of the diff' },
        { resource: 'PullRequest', field: 'base', code: 'invalid' },
      ],
    });
  });

  it('reports other statuses as unexpected', () => {
    expect(classifyGithubResponse(head(502), 'Bad gateway', now)).toEqual({
      kind: 'unexpected-status',
      status: 502,
      message: 'HTTP 502',
    });
  });
});
