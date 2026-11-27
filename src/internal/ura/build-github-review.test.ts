import { describe } from 'vitest';

import { buildGithubReview } from './build-github-review.ts';
import type { GithubPermalinkTarget, GithubReview, LineSpan } from './build-github-review.ts';
import { suggestedPatchFrom } from './suggested-patch-from.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type {
  UraArtifact,
  UraEntry,
  UraPlacement,
  UraPlacedSuggestion,
  UraSuggestionPlacement,
} from './ura-artifact.ts';
import type { UraSuggestion } from './ura-item.ts';
import type { UraItemCandidate } from './validate-ura-item.ts';
import { test } from './testing/test.ts';

/**
 * A suggestion of a test entry: its `path:start-end` (`new` replacing them unless given), where it
 * sits (current on its own lines by default) and its file.
 */
interface SuggestionSource {
  readonly at: string;
  readonly replacement?: string;
  readonly placement?: UraSuggestionPlacement;
  /** The file at the item's head, to derive the patch from; no patch without it. */
  readonly file?: string;
}

/** A test entry: item overrides, where it sits (current by default) and its suggestions. */
interface EntrySource extends Partial<Omit<UraItemCandidate, 'suggestions'>> {
  readonly placement?: UraPlacement;
  readonly suggestions?: readonly SuggestionSource[];
}

/** One case of where each piece of a note goes. */
interface PlacementCase {
  readonly entry: EntrySource;
  readonly ranges?: ReadonlyMap<string, readonly LineSpan[]>;
  /** `piece:placement` for each piece, as `placements` lists them. */
  readonly placed: readonly string[];
}

/** Twenty lines, `line 1` to `line 20`, newline-terminated. */
function twentyLines(): string {
  return `${Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join('\n')}\n`;
}

/** The suggestion of `new` over `path:start-end`. */
function at(spec: string): UraSuggestion {
  const match = /^(?<path>.+):(?<start>\d+)-(?<end>\d+)$/u.exec(spec);
  if (match?.groups === undefined) {
    throw new Error(`not a test range: ${spec}`);
  }
  const { path = '', start = '', end = '' } = match.groups;
  return { path, startLine: Number(start), endLine: Number(end), replacement: 'new' };
}

function entryFrom({ placement, suggestions = [], ...overrides }: EntrySource): UraEntry {
  const item = createTestUraItem({
    headSha: testUraIds.laterHeadSha,
    ...overrides,
    suggestions: suggestions.map((source) => suggestionFrom(source)),
  });
  return {
    item,
    placement: placement ?? { kind: 'current', anchor: item.anchor },
    suggestions: suggestions.map((source) => placedFrom(source)),
  };
}

function suggestionFrom({ at: spec, replacement = 'new' }: SuggestionSource): UraSuggestion {
  return { ...at(spec), replacement };
}

function placedFrom(source: SuggestionSource): UraPlacedSuggestion {
  const { placement, file } = source;
  const suggestion = suggestionFrom(source);
  const placed = { suggestion, placement: placement ?? { kind: 'current', suggestion } } as const;
  if (file === undefined) {
    return placed;
  }
  const patch = suggestedPatchFrom(file, suggestion);
  if (!patch.ok) {
    throw new Error(`no patch for the test suggestion: ${patch.error.kind}`);
  }
  return { ...placed, patch: patch.value };
}

function artifactOf(...entries: EntrySource[]): UraArtifact {
  return {
    ...createSampleArtifact({ value: 'comment', source: 'derived' }),
    entries: entries.map((source) => entryFrom(source)),
  };
}

function placedPieces(review: GithubReview): string[] {
  return review.placements.map(({ piece, placement }) => {
    if (piece.kind === 'note') {
      return `note:${placement}`;
    }
    return `s${String(piece.position)}:${placement}`;
  });
}

function link({ sha, path, startLine, endLine }: GithubPermalinkTarget): string {
  const file = `https://github.example/acme/widgets/blob/${sha.slice(0, 4)}/${path}`;
  if (startLine === undefined) {
    return file;
  }
  return `${file}#L${String(startLine)}-L${String(endLine)}`;
}

function event(value: 'approve' | 'comment' | 'request-changes'): string {
  return buildGithubReview(createSampleArtifact({ value, source: 'derived' })).payload.event;
}

/** `src/app.ts` 5–20 is in the diff; nothing else is. */
function appDiff(): ReadonlyMap<string, readonly LineSpan[]> {
  return new Map([['src/app.ts', [{ start: 5, end: 20 }]]]);
}

/** Item overrides for a note written against an older head. */
function older(): Pick<EntrySource, 'headSha'> {
  return { headSha: testUraIds.headSha };
}

describe('buildGithubReview', () => {
  test('matches the snapshot', ({ expect }) => {
    expect(buildGithubReview(createSampleArtifact()).payload).toMatchInlineSnapshot(`
      {
        "body": "<details>
      <summary>❓ question: Is this file meant to ship?</summary>

      On \`docs/notes.md\`.

      It reads like scratch notes.

      </details>

      <details>
      <summary>🎉 praise: Clear commit history</summary>

      On the whole change.

      </details>

      <details>
      <summary>⛏️ nitpick: Prefer &lt;const> & "readonly"</summary>

      \`src/app.ts:10-12\` (outdated: the lines changed since aaaaaaaaaaaa).

      Use \`as const\` here.
      A CDATA terminator: ]]> stays text.

      Suggestion on \`src/app.ts:11\` (outdated: the lines changed since aaaaaaaaaaaa):

      \`\`\`diff
      --- a/src/app.ts
      +++ b/src/app.ts
      @@ -11 +11 @@
      -const x = [1];
      +const x = [[1]]> as const;
      \`\`\`

      ---

      _Generated by agent review._

      </details>",
        "comments": [
          {
            "body": "⚠️ **issue (blocking):** Guard against an empty list

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
            "body": "⚠️ **issue:** parseAll never checks for an empty list

      ---

      _Generated by agent review. Confidence: 50%_",
            "line": 30,
            "path": "src/parse.ts",
            "side": "RIGHT",
          },
          {
            "body": "Suggestion for **Is this file meant to ship?**

      \`\`\`suggestion
      Notes
      \`\`\`",
            "line": 2,
            "path": "docs/notes.md",
            "side": "RIGHT",
            "start_line": 1,
            "start_side": "RIGHT",
          },
        ],
        "commit_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "event": "REQUEST_CHANGES",
      }
    `);
  });

  test('matches the snapshot with the diff and permalinks of a pull request', ({ expect }) => {
    const review = buildGithubReview(createSampleArtifact(), {
      commentableRanges: new Map([
        ['src/app.ts', [{ start: 1, end: 40 }]],
        ['src/parse.ts', [{ start: 1, end: 40 }]],
      ]),
      permalinkFor: link,
      summary: 'Two things to fix.',
    });
    expect(review.payload.body).toMatchInlineSnapshot(`
      "Two things to fix.

      <details>
      <summary>❓ question: Is this file meant to ship?</summary>

      https://github.example/acme/widgets/blob/bbbb/docs/notes.md

      On \`docs/notes.md\`.

      It reads like scratch notes.

      https://github.example/acme/widgets/blob/bbbb/docs/notes.md#L1-L2

      Suggestion on \`docs/notes.md:1-2\` (outside the pull request's diff):

      \`\`\`diff
      --- a/docs/notes.md
      +++ b/docs/notes.md
      @@ -1,2 +1 @@
      -# Scratch
       Notes
      \`\`\`

      </details>

      <details>
      <summary>🎉 praise: Clear commit history</summary>

      On the whole change.

      </details>

      <details>
      <summary>⛏️ nitpick: Prefer &lt;const> & "readonly"</summary>

      https://github.example/acme/widgets/blob/aaaa/src/app.ts#L10-L12

      \`src/app.ts:10-12\` (outdated: the lines changed since aaaaaaaaaaaa).

      Use \`as const\` here.
      A CDATA terminator: ]]> stays text.

      https://github.example/acme/widgets/blob/aaaa/src/app.ts#L11-L11

      Suggestion on \`src/app.ts:11\` (outdated: the lines changed since aaaaaaaaaaaa):

      \`\`\`diff
      --- a/src/app.ts
      +++ b/src/app.ts
      @@ -11 +11 @@
      -const x = [1];
      +const x = [[1]]> as const;
      \`\`\`

      ---

      _Generated by agent review._

      </details>"
    `);
    expect(placedPieces(review)).toMatchInlineSnapshot(`
      [
        "note:comment",
        "s0:comment",
        "note:comment",
        "note:body",
        "s0:body",
        "note:body",
        "note:body",
        "s0:body",
      ]
    `);
  });

  test('maps verdicts to events', ({ expect }) => {
    expect([event('approve'), event('comment'), event('request-changes')]).toStrictEqual([
      'APPROVE',
      'COMMENT',
      'REQUEST_CHANGES',
    ]);
  });

  test.for<[string, PlacementCase]>([
    [
      'condenses a suggestion over exactly the note’s lines into its comment',
      {
        entry: { suggestions: [{ at: 'src/app.ts:10-12' }] },
        placed: ['note:comment', 's0:comment'],
      },
    ],
    [
      'gives a suggestion on other lines of the diff a comment of its own',
      {
        entry: { suggestions: [{ at: 'src/app.ts:15-15' }] },
        placed: ['note:comment', 's0:suggestion-comment'],
      },
    ],
    [
      'puts a suggestion outside the diff in the body',
      {
        entry: { suggestions: [{ at: 'src/other.ts:1-1' }] },
        placed: ['note:comment', 's0:body'],
      },
    ],
    [
      'puts a note outside the diff, and its suggestion, in the body',
      {
        entry: {
          anchor: { kind: 'lines', path: 'src/app.ts', startLine: 1, endLine: 2 },
          suggestions: [{ at: 'src/app.ts:1-2' }],
        },
        placed: ['note:body', 's0:body'],
      },
    ],
    [
      'keeps a file note’s suggestion in the diff inline',
      {
        entry: {
          anchor: { kind: 'file', path: 'src/app.ts' },
          suggestions: [{ at: 'src/app.ts:6-7' }],
        },
        placed: ['s0:suggestion-comment', 'note:body'],
      },
    ],
    [
      'keeps a whole-change note’s suggestion in the diff inline',
      {
        entry: {
          anchor: { kind: 'change' },
          suggestions: [{ at: 'src/app.ts:6-6' }],
        },
        placed: ['s0:suggestion-comment', 'note:body'],
      },
    ],
    [
      'puts an outdated note and its outdated suggestion in the body',
      {
        entry: {
          ...older(),
          placement: { kind: 'outdated', reason: 'lines-changed' },
          suggestions: [
            {
              at: 'src/app.ts:10-12',
              placement: { kind: 'outdated', reason: 'lines-changed' },
            },
          ],
        },
        placed: ['note:body', 's0:body'],
      },
    ],
    [
      'puts an outdated suggestion of a current note in the body',
      {
        entry: {
          suggestions: [
            {
              at: 'src/app.ts:10-12',
              placement: { kind: 'outdated', reason: 'file-deleted' },
            },
          ],
        },
        placed: ['note:comment', 's0:body'],
      },
    ],
    [
      'hangs an insertion on the line before it',
      {
        entry: { suggestions: [{ at: 'src/app.ts:15-14', file: twentyLines() }] },
        placed: ['note:comment', 's0:suggestion-comment'],
      },
    ],
    [
      'hangs a re-anchored insertion on the line before it, which re-anchoring kept',
      {
        entry: {
          ...older(),
          suggestions: [
            {
              at: 'src/app.ts:15-14',
              placement: { kind: 'current', suggestion: at('src/app.ts:17-16') },
              file: twentyLines(),
            },
          ],
        },
        placed: ['note:comment', 's0:suggestion-comment'],
      },
    ],
    [
      'puts an insertion whose neighbors are unknown in the body',
      {
        entry: { suggestions: [{ at: 'src/app.ts:15-14' }] },
        placed: ['note:comment', 's0:body'],
      },
    ],
    [
      'hangs an insertion at the top of a file on its first line, on the head it was written on',
      {
        entry: { suggestions: [{ at: 'src/app.ts:1-0', file: twentyLines() }] },
        ranges: new Map([['src/app.ts', [{ start: 1, end: 20 }]]]),
        placed: ['note:comment', 's0:suggestion-comment'],
      },
    ],
    [
      'puts a re-anchored insertion at the top of a file in the body',
      {
        entry: {
          ...older(),
          suggestions: [{ at: 'src/app.ts:1-0', file: twentyLines() }],
        },
        ranges: new Map([['src/app.ts', [{ start: 1, end: 20 }]]]),
        placed: ['note:comment', 's0:body'],
      },
    ],
  ])('%s', ([, { entry, ranges, placed }], { expect }) => {
    const review = buildGithubReview(artifactOf(entry), { commentableRanges: ranges ?? appDiff() });
    expect(placedPieces(review)).toStrictEqual(placed);
  });

  test('takes every current line inline without the pull request’s diff (a local copy)', ({
    expect,
  }) => {
    const review = buildGithubReview(
      artifactOf({
        suggestions: [{ at: 'src/app.ts:10-12' }, { at: 'lib/far.ts:300-301' }],
      }),
    );
    expect(placedPieces(review)).toStrictEqual([
      'note:comment',
      's0:comment',
      's1:suggestion-comment',
    ]);
    expect(review.payload.body).toBe('');
  });

  test('writes the condensed suggestion as a ranged comment of just the new lines', ({
    expect,
  }) => {
    const { payload } = buildGithubReview(
      artifactOf({ suggestions: [{ at: 'src/app.ts:10-12', replacement: 'a\nB' }] }),
    );
    expect(payload.comments).toStrictEqual([
      {
        path: 'src/app.ts',
        start_line: 10,
        start_side: 'RIGHT',
        line: 12,
        side: 'RIGHT',
        body: [
          '⚠️ **issue:** Handle the empty list',
          'An empty `items` array makes `first` undefined.',
          '```suggestion\na\nB\n```',
        ].join('\n\n'),
      },
    ]);
  });

  test('names the note in each suggestion comment of its own, counting when there are several', ({
    expect,
  }) => {
    const many = buildGithubReview(
      artifactOf({
        title: 'Rename `retries` to <budget>',
        suggestions: [
          { at: 'src/app.ts:10-12' },
          { at: 'src/app.ts:15-15', replacement: '' },
          { at: 'src/app.ts:17-18', replacement: 'x ``` y' },
        ],
      }),
      { commentableRanges: appDiff() },
    );
    expect(many.payload.comments.slice(1)).toStrictEqual([
      {
        path: 'src/app.ts',
        line: 15,
        side: 'RIGHT',
        body: 'Suggestion 2 of 3 for **Rename `retries` to &lt;budget>**\n\n```suggestion\n```',
      },
      {
        path: 'src/app.ts',
        start_line: 17,
        start_side: 'RIGHT',
        line: 18,
        side: 'RIGHT',
        body: 'Suggestion 3 of 3 for **Rename `retries` to &lt;budget>**\n\n````suggestion\nx ``` y\n````',
      },
    ]);
    const one = buildGithubReview(
      artifactOf({
        title: '',
        blocking: true,
        suggestions: [{ at: 'src/app.ts:15-15' }],
      }),
    );
    expect(one.payload.comments[1]?.body).toBe(
      'Suggestion for **issue (blocking)**\n\n```suggestion\nnew\n```',
    );
  });

  test('suggests an insertion as the line it hangs on and the new lines', ({ expect }) => {
    const review = buildGithubReview(
      artifactOf({
        suggestions: [
          { at: 'src/app.ts:15-14', replacement: 'one\ntwo', file: twentyLines() },
          { at: 'src/app.ts:1-0', replacement: 'top', file: twentyLines() },
        ],
      }),
    );
    expect(review.payload.comments.slice(1)).toStrictEqual([
      expect.objectContaining({
        line: 14,
        body: 'Suggestion 1 of 2 for **Handle the empty list**\n\n```suggestion\nline 14\none\ntwo\n```',
      }),
      expect.objectContaining({
        line: 1,
        body: 'Suggestion 2 of 2 for **Handle the empty list**\n\n```suggestion\ntop\nline 1\n```',
      }),
    ]);
    expect(review.payload.comments[1]).not.toHaveProperty('start_line');
  });

  test('writes one <details> per note in note order, with its pieces and permalinks', ({
    expect,
  }) => {
    const review = buildGithubReview(
      artifactOf(
        {
          id: testUraIds.itemId(1),
          title: 'Rename <it>',
          body: 'Used in two files.',
          anchor: { kind: 'lines', path: 'src/app.ts', startLine: 2, endLine: 3 },
          suggestions: [
            { at: 'src/app.ts:2-3', replacement: 'renamed', file: twentyLines() },
            { at: 'lib/use.ts:4-4', replacement: 'renamed()' },
          ],
        },
        {
          id: testUraIds.itemId(2),
          anchor: { kind: 'lines', path: 'src/app.ts', startLine: 6, endLine: 6 },
        },
        {
          id: testUraIds.itemId(3),
          ...older(),
          anchor: { kind: 'file', path: 'docs/x.md' },
          severity: 'question',
          placement: { kind: 'current', anchor: { kind: 'file', path: 'docs/x.md' } },
          suggestions: [
            {
              at: 'docs/x.md:3-3',
              replacement: 'gone',
              placement: { kind: 'outdated', reason: 'lines-changed' },
              file: twentyLines(),
            },
          ],
        },
      ),
      { commentableRanges: appDiff(), permalinkFor: link, summary: 'Summary.' },
    );
    expect(review.payload.comments.map((comment) => comment.line)).toStrictEqual([6]);
    expect(review.payload.body).toBe(
      [
        'Summary.',
        '<details>\n<summary>⚠️ issue: Rename &lt;it></summary>',
        'https://github.example/acme/widgets/blob/bbbb/src/app.ts#L2-L3',
        "On `src/app.ts:2-3` (outside the pull request's diff).",
        'Used in two files.',
        'https://github.example/acme/widgets/blob/bbbb/src/app.ts#L2-L3',
        "Suggestion 1 of 2 on `src/app.ts:2-3` (outside the pull request's diff):",
        '```diff\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,6 +1,5 @@\n line 1\n-line 2\n-line 3\n+renamed\n line 4\n line 5\n line 6\n```',
        'https://github.example/acme/widgets/blob/bbbb/lib/use.ts#L4-L4',
        "Suggestion 2 of 2 on `lib/use.ts:4` (outside the pull request's diff):",
        '```\nrenamed()\n```',
        '</details>',
        '<details>\n<summary>❓ question: Handle the empty list</summary>',
        'https://github.example/acme/widgets/blob/bbbb/docs/x.md',
        'On `docs/x.md`.',
        'An empty `items` array makes `first` undefined.',
        'https://github.example/acme/widgets/blob/aaaa/docs/x.md#L3-L3',
        'Suggestion on `docs/x.md:3` (outdated: the lines changed since aaaaaaaaaaaa):',
        '```diff\n--- a/docs/x.md\n+++ b/docs/x.md\n@@ -1,6 +1,6 @@\n line 1\n line 2\n-line 3\n+gone\n line 4\n line 5\n line 6\n```',
        '</details>',
      ].join('\n\n'),
    );
    expect(placedPieces(review)).toStrictEqual([
      'note:comment',
      'note:body',
      's0:body',
      's1:body',
      'note:body',
      's0:body',
    ]);
    expect(review.bodySections).toBe(2);
  });

  test('links an outdated note to the head it was written against, and a whole change nowhere', ({
    expect,
  }) => {
    const { payload } = buildGithubReview(
      artifactOf(
        { ...older(), placement: { kind: 'outdated', reason: 'no-line-mapping' } },
        { anchor: { kind: 'change' }, title: 'Tidy' },
      ),
      { permalinkFor: link },
    );
    expect(payload.body).toContain(
      '\n\nhttps://github.example/acme/widgets/blob/aaaa/src/app.ts#L10-L12\n\n`src/app.ts:10-12` (outdated: written against aaaaaaaaaaaa).\n\n',
    );
    expect(payload.body).toContain('<summary>⚠️ issue: Tidy</summary>\n\nOn the whole change.');
    expect(payload.body.match(/https:/gu)).toHaveLength(1);
  });

  test('writes no links without permalinkFor', ({ expect }) => {
    const { payload } = buildGithubReview(createSampleArtifact(), {
      commentableRanges: new Map(),
    });
    expect(payload.body).not.toContain('https:');
    expect(payload.body).toContain("On `src/app.ts:10-12` (outside the pull request's diff).");
  });

  test('links an inserted line’s permalink to the line it follows', ({ expect }) => {
    const { payload } = buildGithubReview(
      artifactOf({
        suggestions: [{ at: 'lib/x.ts:8-7' }, { at: 'lib/x.ts:1-0' }],
      }),
      { commentableRanges: appDiff(), permalinkFor: link },
    );
    expect(payload.body).toContain(
      'https://github.example/acme/widgets/blob/bbbb/lib/x.ts#L7-L7\n\nSuggestion 1 of 2 inserting before `lib/x.ts:8`:',
    );
    expect(payload.body).toContain(
      'https://github.example/acme/widgets/blob/bbbb/lib/x.ts#L1-L1\n\nSuggestion 2 of 2 inserting before `lib/x.ts:1`:',
    );
  });

  test('leaves out pieces an earlier review posted, and a note it posted whole', ({ expect }) => {
    const id = testUraIds.itemId(1);
    const artifact = artifactOf({
      id,
      suggestions: [{ at: 'src/app.ts:10-12' }, { at: 'lib/x.ts:1-1' }],
    });
    const textOnly = buildGithubReview(artifact, {
      commentableRanges: appDiff(),
      posted: [{ itemId: id, piece: { kind: 'note' } }],
    });
    expect(placedPieces(textOnly)).toStrictEqual(['s0:suggestion-comment', 's1:body']);
    expect(textOnly.payload.comments[0]?.body.startsWith('Suggestion 1 of 2 for **')).toBe(true);
    expect(textOnly.payload.body).not.toContain('An empty `items` array');
    const all = buildGithubReview(artifact, {
      commentableRanges: appDiff(),
      posted: [
        { itemId: id, piece: { kind: 'note' } },
        { itemId: id, piece: { kind: 'suggestion', position: 0 } },
        { itemId: id, piece: { kind: 'suggestion', position: 1 } },
      ],
    });
    expect(all.placements).toStrictEqual([]);
    expect(all.payload).toMatchObject({ body: 'Comments', comments: [] });
  });

  test('moves the pieces GitHub refused into their note’s section', ({ expect }) => {
    const id = testUraIds.itemId(1);
    const artifact = artifactOf({
      id,
      suggestions: [{ at: 'src/app.ts:10-12' }, { at: 'src/app.ts:15-15' }],
    });
    const first = buildGithubReview(artifact);
    expect(first.placements).toStrictEqual([
      { itemId: id, piece: { kind: 'note' }, placement: 'comment', comment: 0 },
      { itemId: id, piece: { kind: 'suggestion', position: 0 }, placement: 'comment', comment: 0 },
      {
        itemId: id,
        piece: { kind: 'suggestion', position: 1 },
        placement: 'suggestion-comment',
        comment: 1,
      },
    ]);
    const moved = buildGithubReview(artifact, {
      moveToBody: first.placements.filter(({ comment }) => comment === 0),
    });
    expect(placedPieces(moved)).toStrictEqual(['s1:suggestion-comment', 'note:body', 's0:body']);
    expect(moved.payload.body).toContain('Suggestion 1 of 2 on `src/app.ts:10-12`:');
  });

  test('moves a comment over GitHub’s limit into the body', ({ expect }) => {
    const long = 'y'.repeat(30_000);
    const review = buildGithubReview(
      artifactOf({
        body: 'x'.repeat(40_000),
        suggestions: [{ at: 'src/app.ts:10-12', replacement: long }],
      }),
    );
    expect(placedPieces(review)).toStrictEqual(['s0:suggestion-comment', 'note:body']);
  });

  test('leaves whole sections out from the end when the body is over GitHub’s limit', ({
    expect,
  }) => {
    const long = (n: number): EntrySource => {
      return {
        id: testUraIds.itemId(n),
        anchor: { kind: 'change' },
        body: `${String(n)} ${'y'.repeat(30_000)}`,
        suggestions: [{ at: `lib/x.ts:${String(n)}-${String(n)}`, replacement: '```' }],
      };
    };
    const review = buildGithubReview(artifactOf(long(1), long(2), long(3), long(4)), {
      commentableRanges: new Map(),
      summary: 'Summary.',
    });
    const { body } = review.payload;
    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body.split('<details>')).toHaveLength(3);
    expect(body.split('</details>')).toHaveLength(3);
    expect(body.split('````')).toHaveLength(5);
    expect(body.startsWith('Summary.\n\n<details>')).toBe(true);
    expect(
      body.endsWith(
        '</details>\n\n_2 more notes and 2 more suggestions are in the exported review._',
      ),
    ).toBe(true);
    expect(review).toMatchObject({ bodySections: 2, leftOut: 4 });
    expect(review.placements.map(({ itemId }) => itemId)).toStrictEqual([
      testUraIds.itemId(1),
      testUraIds.itemId(1),
      testUraIds.itemId(2),
      testUraIds.itemId(2),
    ]);
    const one = buildGithubReview(
      artifactOf(
        long(1),
        { ...long(2), suggestions: [] },
        { anchor: { kind: 'change' }, body: 'y'.repeat(40_000) },
      ),
      { commentableRanges: new Map() },
    );
    expect(one.payload.body.endsWith('\n\n_1 more note is in the exported review._')).toBe(true);
    expect(one.leftOut).toBe(1);
  });

  test('shows a path’s bidi controls as escapes in the body, and keeps the inline path exact', ({
    expect,
  }) => {
    const path = `invoice${character(0x20_2e)}gpj.ts`;
    const onFile = buildGithubReview(artifactOf({ anchor: { kind: 'file', path } }));
    expect(onFile.payload.body).toContain('On `invoice⟨U+202E⟩gpj.ts`.');
    expect(onFile.payload.body).not.toContain(path);
    const inline = buildGithubReview(
      artifactOf({ anchor: { kind: 'lines', path, startLine: 10, endLine: 12 } }),
    );
    expect(inline.payload.comments).toStrictEqual([expect.objectContaining({ path })]);
  });

  test('names the verdict when there are no items, so the body is never empty', ({ expect }) => {
    const artifact = {
      ...createSampleArtifact({ value: 'comment', source: 'chosen', derived: 'approve' }),
      entries: [],
    };
    expect(buildGithubReview(artifact).payload.body).toBe('Comments');
  });

  test('leads with the emoji and the Conventional Comments label, leaving out a missing title', ({
    expect,
  }) => {
    expect(
      firstCommentBody({ severity: 'praise', title: '' }).startsWith('🎉 **praise**\n\n'),
    ).toBe(true);
    expect(
      firstCommentBody({ severity: 'suggestion', blocking: true }).startsWith(
        '💡 **suggestion (blocking):** Handle the empty list',
      ),
    ).toBe(true);
    expect(
      firstCommentBody({ severity: 'chore', blocking: true, title: '' }).startsWith(
        '🧹 **chore (blocking)**\n\n',
      ),
    ).toBe(true);
  });

  test('writes no summary of its own when every item is inline', ({ expect }) => {
    expect(buildGithubReview(artifactOf({})).payload.body).toBe('');
    expect(buildGithubReview(artifactOf({}), { summary: '  ' }).payload.body).toBe('');
  });

  test('signs every comment and section of a note the agent raised', ({ expect }) => {
    const review = buildGithubReview(
      artifactOf({
        origin: { kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: 0.876 },
        body: 'Edited by the reviewer.',
        suggestions: [
          { at: 'src/app.ts:10-12' },
          { at: 'src/app.ts:15-15' },
          { at: 'lib/x.ts:1-1' },
        ],
      }),
      { commentableRanges: appDiff() },
    );
    const footer = '```\n\n---\n\n_Generated by agent review. Confidence: 88%_';
    expect(review.payload.comments.map((comment) => comment.body.endsWith(footer))).toStrictEqual([
      true,
      true,
    ]);
    expect(review.payload.body.endsWith(`${footer}\n\n</details>`)).toBe(true);
    const proposal = buildGithubReview(
      artifactOf({ origin: { kind: 'chat-answer', messageId: 'm1', proposal: 0 } }),
    );
    expect(
      proposal.payload.comments[0]?.body.endsWith('\n\n---\n\n_Generated by agent review._'),
    ).toBe(true);
    expect(buildGithubReview(artifactOf({})).payload.comments[0]?.body).not.toContain(
      'Generated by',
    );
  });

  test('leaves an approval with nothing to say empty', ({ expect }) => {
    const artifact = {
      ...createSampleArtifact({ value: 'approve', source: 'derived' }),
      entries: [],
    };
    expect(buildGithubReview(artifact).payload.body).toBe('');
  });
});

function firstCommentBody(overrides: EntrySource): string {
  return buildGithubReview(artifactOf(overrides)).payload.comments[0]?.body ?? '';
}

/** A character by code point, so this file holds none of the characters it tests. */
function character(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}
