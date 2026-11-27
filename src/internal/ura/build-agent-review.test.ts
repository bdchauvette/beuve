import { describe } from 'vitest';

import { buildAgentReview } from './build-agent-review.ts';
import { renderAgentReviewXml } from './render-agent-review-xml.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
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
          "praise": 1,
          "question": 1,
          "smell": 0,
          "suggestion": 0,
          "thought": 0,
          "todo": 0,
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
            "suggestions": [
              {
                "endLine": 12,
                "patch": "--- a/src/app.ts
      +++ b/src/app.ts
      @@ -10,3 +10,4 @@
       const items = load();
      -const first = items[0];
      +if (items.length === 0) return;
      +const first = items[0];
       use(first);
      ",
                "patchAgainstSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "path": "src/app.ts",
                "replacement": "const items = load();
      if (items.length === 0) return;
      const first = items[0];
      use(first);",
                "startLine": 10,
              },
            ],
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
              "confidence": 0.5,
              "finding": 0,
              "kind": "chat-answer",
              "messageId": "msg-1",
            },
            "severity": "issue",
            "suggestions": [],
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
            "suggestions": [
              {
                "endLine": 2,
                "patch": "--- a/docs/notes.md
      +++ b/docs/notes.md
      @@ -1,2 +1 @@
      -# Scratch
       Notes
      ",
                "patchAgainstSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "path": "docs/notes.md",
                "replacement": "Notes",
                "startLine": 1,
              },
            ],
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
            "suggestions": [],
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
            "suggestions": [
              {
                "outdated": {
                  "endLine": 11,
                  "path": "src/app.ts",
                  "reason": "lines-changed",
                  "startLine": 11,
                  "writtenAgainstSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                },
                "patch": "--- a/src/app.ts
      +++ b/src/app.ts
      @@ -11 +11 @@
      -const x = [1];
      +const x = [[1]]> as const;
      ",
                "patchAgainstSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "replacement": "const x = [[1]]> as const;",
              },
            ],
            "title": "Prefer <const> & "readonly"",
          },
        ],
        "schema": "beuve.ura/2",
        "verdict": "request-changes",
        "verdictSource": "derived",
      }
    `);
  });

  test('places each suggestion on its own: moved lines on the head, the patch on its own head', ({
    expect,
  }) => {
    const written = { path: 'src/app.ts', startLine: 8, endLine: 7, replacement: 'inserted' };
    const moved = { ...written, startLine: 12, endLine: 11 };
    const item = createTestUraItem({ suggestions: [written] });
    const artifact = {
      ...createSampleArtifact(),
      entries: [
        {
          item,
          placement: { kind: 'current', anchor: item.anchor },
          suggestions: [
            {
              suggestion: written,
              placement: { kind: 'current', suggestion: moved },
              patch: 'p\n',
            },
          ],
        },
      ],
    } as const;
    expect(buildAgentReview(artifact).items[0]?.suggestions).toStrictEqual([
      {
        path: 'src/app.ts',
        startLine: 12,
        endLine: 11,
        replacement: 'inserted',
        patch: 'p\n',
        patchAgainstSha: testUraIds.headSha,
      },
    ]);
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

  test('carries the review summary, trimmed, and leaves a blank one out', ({ expect }) => {
    const artifact = createSampleArtifact();
    expect(buildAgentReview(artifact, { summary: '  Looks *good*.\n' }).summary).toBe(
      'Looks *good*.',
    );
    expect('summary' in buildAgentReview(artifact, { summary: ' \n' })).toBe(false);
    expect('summary' in buildAgentReview(artifact)).toBe(false);
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
