import { describe, expect, it } from 'vitest';

import { buildGithubReview } from './build-github-review.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraArtifact } from './ura-artifact.ts';
import type { UraItemCandidate } from './validate-ura-item.ts';

function withItem(overrides: Partial<UraItemCandidate>): UraArtifact {
  const item = createTestUraItem({ headSha: testUraIds.laterHeadSha, ...overrides });
  return {
    ...createSampleArtifact({ value: 'comment', source: 'derived' }),
    entries: [{ item, placement: { kind: 'current', anchor: item.anchor } }],
  };
}

function event(value: 'approve' | 'comment' | 'request-changes'): string {
  return buildGithubReview(createSampleArtifact({ value, source: 'derived' })).event;
}

describe('buildGithubReview', () => {
  it('matches the snapshot', () => {
    expect(buildGithubReview(createSampleArtifact())).toMatchInlineSnapshot(`
      {
        "body": "**beuve review: changes requested**

      1 blocker, 1 issue, 1 question, 1 nit, 1 praise.

      ### Not attached to a line

      #### Question: Is this file meant to ship?

      On \`docs/notes.md\`.

      It reads like scratch notes.

      \`\`\`diff
      --- a/docs/notes.md
      +++ b/docs/notes.md
      @@ -1,2 +1 @@
      -# Scratch
       Notes
      \`\`\`

      #### Praise: Clear commit history

      On the whole change.

      #### Nit: Prefer &lt;const> & "readonly"

      \`src/app.ts:10-12\` (outdated: the lines changed since aaaaaaaaaaaa)

      Use \`as const\` here.
      A CDATA terminator: ]]> stays text.",
        "comments": [
          {
            "body": "**Blocker:** Guard against an empty list

      Calling \`first()\` on \`[]\` throws.

      \`\`\`suggestion
      const items = load();
      if (items.length === 0) return;
      const first = items[0];
      use(first);
      \`\`\`",
            "line": 12,
            "path": "src/app.ts",
            "side": "RIGHT",
            "start_line": 10,
            "start_side": "RIGHT",
          },
          {
            "body": "**Issue:** Cognitive complexity 22 exceeds 15 in parseAll

      ImpactGate: cognitive complexity 22 in \`parseAll\` (limit 15, 98th percentile).",
            "line": 30,
            "path": "src/parse.ts",
            "side": "RIGHT",
          },
        ],
        "commit_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "event": "REQUEST_CHANGES",
      }
    `);
  });

  it('maps verdicts to events', () => {
    expect([event('approve'), event('comment'), event('request-changes')]).toEqual([
      'APPROVE',
      'COMMENT',
      'REQUEST_CHANGES',
    ]);
  });

  it('turns a patch inside a larger hunk into a suggestion for just the anchored lines', () => {
    const review = buildGithubReview(
      withItem({
        anchor: { kind: 'lines', path: 'src/app.ts', startLine: 11, endLine: 11 },
        suggestion: '@@ -10,3 +10,4 @@\n a\n-b\n+B\n+B2\n c\n',
      }),
    );
    expect(review.comments).toEqual([
      expect.objectContaining({ path: 'src/app.ts', line: 11, side: 'RIGHT' }),
    ]);
    expect(review.comments[0]?.body).toContain('```suggestion\nB\nB2\n```');
    expect(review.comments[0]).not.toHaveProperty('start_line');
  });

  it('suggests a deletion as an empty block, and insertions at the edges', () => {
    const deletion = buildGithubReview(withItem({ suggestion: '@@ -10,3 +9,0 @@\n-a\n-b\n-c\n' }));
    expect(deletion.comments[0]?.body).toContain('```suggestion\n```');
    const inserted = buildGithubReview(
      withItem({ suggestion: '@@ -9,5 +9,6 @@\n z\n+top\n a\n b\n c\n y\n' }),
    );
    expect(inserted.comments[0]?.body).toContain('```suggestion\ntop\na\nb\nc\n```');
  });

  it('falls back to a diff block when the patch does not show every anchored line', () => {
    const review = buildGithubReview(withItem({ suggestion: '@@ -11 +11 @@\n-b\n+B\n' }));
    expect(review.comments[0]?.body).toContain(
      '```diff\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -11 +11 @@\n-b\n+B\n```',
    );
    expect(review.comments[0]?.body).not.toContain('suggestion');
  });

  it('uses a longer fence when the replacement contains backticks', () => {
    const review = buildGithubReview(
      withItem({
        anchor: { kind: 'lines', path: 'src/app.ts', startLine: 10, endLine: 10 },
        suggestion: '@@ -10 +10 @@\n-a\n+const s = ```;\n',
      }),
    );
    expect(review.comments[0]?.body).toContain('````suggestion\nconst s = ```;\n````');
  });

  it('moves lines outside the pull request diff into the body', () => {
    const artifact = withItem({});
    const inside = buildGithubReview(artifact, {
      commentableRanges: new Map([['src/app.ts', [{ start: 5, end: 20 }]]]),
    });
    expect(inside.comments).toHaveLength(1);
    const outside = buildGithubReview(artifact, {
      commentableRanges: new Map([['src/app.ts', [{ start: 5, end: 11 }]]]),
    });
    expect(outside.comments).toEqual([]);
    expect(outside.body).toContain("On `src/app.ts:10-12` (outside the pull request's diff).");
  });

  it('notes a chosen verdict and always has a body', () => {
    const artifact = {
      ...createSampleArtifact({ value: 'comment', source: 'chosen', derived: 'approve' }),
      entries: [],
    };
    expect(buildGithubReview(artifact).body).toBe(
      "**beuve review: comments** (the reviewer's verdict; the items alone suggest approved)",
    );
  });
});
