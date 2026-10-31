import { describe } from 'vitest';

import { buildGithubReview } from './build-github-review.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraArtifact } from './ura-artifact.ts';
import type { UraItemCandidate } from './validate-ura-item.ts';
import { test } from './testing/test.ts';

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
  test('matches the snapshot', ({ expect }) => {
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

  test('maps verdicts to events', ({ expect }) => {
    expect([event('approve'), event('comment'), event('request-changes')]).toStrictEqual([
      'APPROVE',
      'COMMENT',
      'REQUEST_CHANGES',
    ]);
  });

  test('turns a patch inside a larger hunk into a suggestion for just the anchored lines', ({
    expect,
  }) => {
    const review = buildGithubReview(
      withItem({
        anchor: { kind: 'lines', path: 'src/app.ts', startLine: 11, endLine: 11 },
        suggestion: '@@ -10,3 +10,4 @@\n a\n-b\n+B\n+B2\n c\n',
      }),
    );
    expect(review.comments).toStrictEqual([
      expect.objectContaining({ path: 'src/app.ts', line: 11, side: 'RIGHT' }),
    ]);
    expect(review.comments[0]?.body).toContain('```suggestion\nB\nB2\n```');
    expect(review.comments[0]).not.toHaveProperty('start_line');
  });

  test('shows a path’s bidi controls as escapes in the body, and keeps the inline path exact', ({
    expect,
  }) => {
    const path = `invoice${character(0x20_2e)}gpj.ts`;
    const onFile = buildGithubReview(withItem({ anchor: { kind: 'file', path } }));
    expect(onFile.body).toContain('On `invoice⟨U+202E⟩gpj.ts`.');
    expect(onFile.body).not.toContain(path);
    const inline = buildGithubReview(
      withItem({ anchor: { kind: 'lines', path, startLine: 10, endLine: 12 } }),
    );
    expect(inline.comments).toStrictEqual([expect.objectContaining({ path })]);
  });

  test('posts an inline edit (every anchored line replaced, context around) as a ranged suggestion', ({
    expect,
  }) => {
    const review = buildGithubReview(
      withItem({
        anchor: { kind: 'lines', path: 'src/app.ts', startLine: 10, endLine: 12 },
        suggestion:
          '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -9,5 +9,4 @@\n z\n-a\n-b\n-c\n+a\n+B\n y\n',
      }),
    );
    expect(review.comments).toStrictEqual([
      expect.objectContaining({ line: 12, start_line: 10, side: 'RIGHT', start_side: 'RIGHT' }),
    ]);
    expect(review.comments[0]?.body).toContain('```suggestion\na\nB\n```');
  });

  test('suggests a deletion as an empty block, and insertions at the edges', ({ expect }) => {
    const deletion = buildGithubReview(withItem({ suggestion: '@@ -10,3 +9,0 @@\n-a\n-b\n-c\n' }));
    expect(deletion.comments[0]?.body).toContain('```suggestion\n```');
    const inserted = buildGithubReview(
      withItem({ suggestion: '@@ -9,5 +9,6 @@\n z\n+top\n a\n b\n c\n y\n' }),
    );
    expect(inserted.comments[0]?.body).toContain('```suggestion\ntop\na\nb\nc\n```');
  });

  test('falls back to a diff block when the patch does not show every anchored line', ({
    expect,
  }) => {
    const review = buildGithubReview(withItem({ suggestion: '@@ -11 +11 @@\n-b\n+B\n' }));
    expect(review.comments[0]?.body).toContain(
      '```diff\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -11 +11 @@\n-b\n+B\n```',
    );
    expect(review.comments[0]?.body).not.toContain('suggestion');
  });

  test('uses a longer fence when the replacement contains backticks', ({ expect }) => {
    const review = buildGithubReview(
      withItem({
        anchor: { kind: 'lines', path: 'src/app.ts', startLine: 10, endLine: 10 },
        suggestion: '@@ -10 +10 @@\n-a\n+const s = ```;\n',
      }),
    );
    expect(review.comments[0]?.body).toContain('````suggestion\nconst s = ```;\n````');
  });

  test('moves lines outside the pull request diff into the body', ({ expect }) => {
    const artifact = withItem({});
    const inside = buildGithubReview(artifact, {
      commentableRanges: new Map([['src/app.ts', [{ start: 5, end: 20 }]]]),
    });
    expect(inside.comments).toHaveLength(1);
    const outside = buildGithubReview(artifact, {
      commentableRanges: new Map([['src/app.ts', [{ start: 5, end: 11 }]]]),
    });
    expect(outside.comments).toStrictEqual([]);
    expect(outside.body).toContain("On `src/app.ts:10-12` (outside the pull request's diff).");
  });

  test('notes a chosen verdict and always has a body', ({ expect }) => {
    const artifact = {
      ...createSampleArtifact({ value: 'comment', source: 'chosen', derived: 'approve' }),
      entries: [],
    };
    expect(buildGithubReview(artifact).body).toBe(
      "**beuve review: comments** (the reviewer's verdict; the items alone suggest approved)",
    );
  });
});

/** A character by code point, so this file holds none of the characters it tests. */
function character(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}
