import { parseSessionSource } from './parse-session-source.ts';
import type { SessionSource } from './session.ts';
import { test } from './testing/test.ts';

test('parseSessionSource accepts well-formed sources', ({ expect }) => {
  expect(parseSessionSource(local())).toStrictEqual({ ok: true, value: local() });
  expect(parseSessionSource(pull())).toStrictEqual({ ok: true, value: pull() });
  expect(parseSessionSource(branch())).toStrictEqual({ ok: true, value: branch() });
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
  ['blank branch', { ...branch(), branch: ' ' }],
  ['branch with a blank repo', { ...branch(), repo: '' }],
  ['branch with an uppercase host', { ...branch(), host: 'GitHub.com' }],
  ['branch on an unknown forge', { ...branch(), forge: 'gitlab' as 'github' }],
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

function branch(): BranchSource {
  return {
    kind: 'remote-branch',
    repoPath: '/repos/beuve',
    baseRef: 'refs/beuve/branch/0123/base',
    forge: 'github',
    host: 'github.com',
    owner: 'acme',
    repo: 'beuve',
    branch: 'claude/fix',
  };
}

type BranchSource = Extract<SessionSource, { readonly kind: 'remote-branch' }>;

type LocalSource = Extract<SessionSource, { readonly kind: 'local' }>;

type PullRequestSource = Extract<SessionSource, { readonly kind: 'github-pull-request' }>;
