import { parseSessionSource } from './parse-session-source.ts';
import type { SessionSource } from './session.ts';
import { test } from './testing/test.ts';

test('parseSessionSource accepts well-formed sources', ({ expect }) => {
  expect(parseSessionSource(local())).toStrictEqual({ ok: true, value: local() });
  expect(parseSessionSource(pull())).toStrictEqual({ ok: true, value: pull() });
});

test.for<[string, SessionSource]>([
  ['relative repo path', { ...local(), repoPath: 'repos/beuve' }],
  ['blank base ref', { ...local(), baseRef: ' ' }],
  ['blank head ref', { ...local(), headRef: '' }],
  ['blank owner', { ...pull(), owner: '' }],
  ['zero number', { ...pull(), number: 0 }],
  ['uppercase host', { ...pull(), host: 'GitHub.com' }],
  ['host with a port', { ...pull(), host: 'ghe.example.com:8443' }],
  ['fractional number', { ...pull(), number: 1.5 }],
])('parseSessionSource rejects a %s', ([, source], { expect }) => {
  expect(parseSessionSource(source)).toMatchObject({
    ok: false,
    error: { kind: 'invalid-source' },
  });
});

function local(): LocalSource {
  return { kind: 'local', repoPath: '/repos/beuve', baseRef: 'main', headRef: 'agent/fix' };
}

function pull(): PullRequestSource {
  return {
    kind: 'github-pull-request',
    repoPath: '/repos/beuve',
    baseRef: 'main',
    host: 'github.com',
    owner: 'acme',
    repo: 'beuve',
    number: 42,
  };
}

type LocalSource = Extract<SessionSource, { readonly kind: 'local' }>;

type PullRequestSource = Extract<SessionSource, { readonly kind: 'github-pull-request' }>;
