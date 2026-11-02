import { describe } from 'vitest';

import { buildAgentReview } from './build-agent-review.ts';
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
          "blocker": 1,
          "issue": 1,
          "nit": 1,
          "praise": 1,
          "question": 1,
        },
        "items": [
          {
            "anchor": {
              "endLine": 12,
              "kind": "lines",
              "path": "src/app.ts",
              "startLine": 10,
            },
            "body": "Calling \`first()\` on \`[]\` throws.",
            "id": "00000000-0000-4000-8000-000000000001",
            "origin": {
              "kind": "human",
            },
            "severity": "blocker",
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
            "body": "",
            "id": "00000000-0000-4000-8000-000000000004",
            "origin": {
              "kind": "human",
            },
            "severity": "praise",
            "title": "Clear commit history",
          },
          {
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
            "severity": "nit",
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
      counts: { blocker: 0, issue: 0, question: 0, nit: 0, praise: 0 },
      items: [],
    });
    expect('fromHeadSha' in buildAgentReview(local).change).toBe(false);
  });
});
