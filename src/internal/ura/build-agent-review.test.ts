import { describe } from 'vitest';

import { buildAgentReview } from './build-agent-review.ts';
import { renderAgentReviewXml } from './render-agent-review-xml.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { test } from './testing/test.ts';

describe('buildAgentReview', () => {
  test('is plain JSON data that survives a round trip', ({ expect }) => {
    const review = buildAgentReview(createSampleArtifact());
    const json: unknown = JSON.parse(JSON.stringify(review, undefined, 2));
    expect(json).toStrictEqual(review);
    expect(structuredClone(review)).toStrictEqual(review);
  });

  test('matches the snapshot', ({ expect }) => {
    expect(buildAgentReview(createSampleArtifact())).toMatchInlineSnapshot(`
      {
        "change": {
          "baseSha": "cccccccccccccccccccccccccccccccccccccccc",
          "fromHeadSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "headSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "repository": {
            "baseRef": "main",
            "kind": "github-pull-request",
            "number": 42,
            "owner": "acme",
            "path": "/work/beuve",
            "repo": "widgets",
          },
          "scope": "interdiff",
        },
        "counts": {
          "blocking": 1,
          "chore": 0,
          "issue": 2,
          "nitpick": 1,
          "note": 0,
          "polish": 0,
          "praise": 1,
          "question": 1,
          "quibble": 0,
          "smell": 0,
          "suggestion": 0,
          "thought": 0,
          "todo": 0,
          "typo": 0,
        },
        "items": [
          {
            "anchor": {
              "endLine": 12,
              "kind": "lines",
              "path": "src/app.ts",
              "startLine": 10,
            },
            "blocking": true,
            "body": "Calling \`first()\` on \`[]\` throws.",
            "id": "00000000-0000-4000-8000-000000000001",
            "origin": {
              "kind": "human",
            },
            "severity": "issue",
            "suggestedPatch": "--- a/src/app.ts
      +++ b/src/app.ts
      @@ -10,3 +10,4 @@
       const items = load();
      -const first = items[0];
      +if (items.length === 0) return;
      +const first = items[0];
       use(first);
      ",
            "title": "Guard against an empty list",
          },
          {
            "anchor": {
              "endLine": 30,
              "kind": "lines",
              "path": "src/parse.ts",
              "startLine": 30,
            },
            "blocking": false,
            "body": "",
            "id": "00000000-0000-4000-8000-000000000002",
            "origin": {
              "finding": 0,
              "kind": "chat-answer",
              "messageId": "msg-1",
            },
            "severity": "issue",
            "title": "parseAll never checks for an empty list",
          },
          {
            "anchor": {
              "kind": "file",
              "path": "docs/notes.md",
            },
            "blocking": false,
            "body": "It reads like scratch notes.",
            "id": "00000000-0000-4000-8000-000000000003",
            "origin": {
              "kind": "human",
            },
            "severity": "question",
            "suggestedPatch": "--- a/docs/notes.md
      +++ b/docs/notes.md
      @@ -1,2 +1 @@
      -# Scratch
       Notes
      ",
            "title": "Is this file meant to ship?",
          },
          {
            "anchor": {
              "kind": "change",
            },
            "blocking": false,
            "body": "",
            "id": "00000000-0000-4000-8000-000000000004",
            "origin": {
              "kind": "human",
            },
            "severity": "praise",
            "title": "Clear commit history",
          },
          {
            "blocking": false,
            "body": "Use \`as const\` here.
      A CDATA terminator: ]]> stays text.",
            "id": "00000000-0000-4000-8000-000000000005",
            "origin": {
              "finding": 0,
              "kind": "chat-answer",
              "messageId": "33333333-3333-4333-8333-333333333333",
            },
            "outdated": {
              "originalAnchor": {
                "endLine": 12,
                "kind": "lines",
                "path": "src/app.ts",
                "startLine": 10,
              },
              "reason": "lines-changed",
              "writtenAgainstSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            "severity": "nitpick",
            "title": "Prefer <const> & "readonly"",
          },
        ],
        "schema": "beuve.ura/1",
        "verdict": "request-changes",
        "verdictSource": "derived",
      }
    `);
  });

  test('describes a local change and a chosen verdict', ({ expect }) => {
    const artifact = createSampleArtifact({
      value: 'comment',
      source: 'chosen',
      derived: 'approve',
    });
    const local = {
      ...artifact,
      summary: {
        ...artifact.summary,
        change: { kind: 'local', repoPath: '/r', baseRef: 'main', headRef: 'topic' },
        scope: { kind: 'full' },
      },
      entries: [],
    } as const;
    expect(buildAgentReview(local)).toMatchObject({
      change: {
        repository: { kind: 'local', path: '/r', baseRef: 'main', headRef: 'topic' },
        scope: 'full',
      },
      verdict: 'comment',
      verdictSource: 'chosen',
      counts: { issue: 0, nitpick: 0, praise: 0, blocking: 0 },
      items: [],
    });
    expect('fromHeadSha' in buildAgentReview(local).change).toBe(false);
  });

  test('describes a followed branch without a pull request (ADR 0112)', ({ expect }) => {
    const artifact = createSampleArtifact();
    const branch = {
      ...artifact,
      summary: {
        ...artifact.summary,
        change: {
          kind: 'remote-branch',
          repoPath: '/r',
          baseRef: 'refs/beuve/branch/0123/base',
          host: 'github.com',
          owner: 'o',
          repo: 'r',
          branch: 'claude/x',
        },
      },
    } as const;
    expect(buildAgentReview(branch).change.repository).toStrictEqual({
      kind: 'remote-branch',
      path: '/r',
      baseRef: 'refs/beuve/branch/0123/base',
      host: 'github.com',
      owner: 'o',
      repo: 'r',
      branch: 'claude/x',
    });
    expect(renderAgentReviewXml(branch)).toContain(
      '<repository kind="remote-branch" path="/r" base-ref="refs/beuve/branch/0123/base" host="github.com" owner="o" repo="r" branch="claude/x"/>',
    );
  });
});
