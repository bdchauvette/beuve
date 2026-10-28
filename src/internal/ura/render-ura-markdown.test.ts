import { describe, expect, it } from 'vitest';

import { renderUraMarkdown } from './render-ura-markdown.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';

describe('renderUraMarkdown', () => {
  it('matches the snapshot', () => {
    expect(renderUraMarkdown(createSampleArtifact())).toMatchInlineSnapshot(`
      "# Review of acme/widgets#42

      - **Verdict:** Request changes
      - **Reviewed:** changes since \`aaaaaaaaaaaa\`, up to \`bbbbbbbbbbbb\`
      - **Items:** 1 blocker, 1 issue, 1 question, 1 nit, 1 praise

      ## 1. Blocker: Guard against an empty list

      \`src/app.ts:10-12\`

      Calling \`first()\` on \`[]\` throws.

      \`\`\`diff
      --- a/src/app.ts
      +++ b/src/app.ts
      @@ -10,3 +10,4 @@
       const items = load();
      -const first = items[0];
      +if (items.length === 0) return;
      +const first = items[0];
       use(first);
      \`\`\`

      ## 2. Issue: Cognitive complexity 22 exceeds 15 in parseAll

      \`src/parse.ts:30\`, from ImpactGate

      ImpactGate: cognitive complexity 22 in \`parseAll\` (limit 15, 98th percentile).

      ## 3. Question: Is this file meant to ship?

      \`docs/notes.md\`

      It reads like scratch notes.

      \`\`\`diff
      --- a/docs/notes.md
      +++ b/docs/notes.md
      @@ -1,2 +1 @@
      -# Scratch
       Notes
      \`\`\`

      ## 4. Praise: Clear commit history

      The whole change

      ## 5. Nit: Prefer &lt;const> & "readonly"

      \`src/app.ts:10-12\` (outdated, the lines changed since \`aaaaaaaaaaaa\`), from an agent insight

      Use \`as const\` here.
      A CDATA terminator: ]]> stays text.
      "
    `);
  });

  it('names a local change and an empty review', () => {
    const artifact = createSampleArtifact({ value: 'approve', source: 'derived' });
    const local = {
      ...artifact,
      summary: {
        ...artifact.summary,
        change: { kind: 'local', repoPath: '/r', baseRef: 'main', headRef: 'topic' },
        scope: { kind: 'full' },
      },
      entries: [],
    } as const;
    expect(renderUraMarkdown(local)).toBe(
      [
        '# Review of `topic` into `main`',
        '',
        '- **Verdict:** Approve',
        `- **Reviewed:** from \`${'c'.repeat(12)}\` to \`${'b'.repeat(12)}\``,
        '- **Items:** none',
        '',
      ].join('\n'),
    );
  });
});
