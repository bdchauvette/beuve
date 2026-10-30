import { describe } from 'vitest';

import { renderAgentReviewXml } from './render-agent-review-xml.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('renderAgentReviewXml', () => {
  test('matches the snapshot', ({ expect }) => {
    expect(renderAgentReviewXml(createSampleArtifact())).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <beuve-review schema="beuve.ura/1" verdict="request-changes" verdict-source="derived">
        <change scope="interdiff" base-sha="cccccccccccccccccccccccccccccccccccccccc" head-sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" from-head-sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
          <repository kind="github-pull-request" path="/work/beuve" base-ref="main" owner="acme" repo="widgets" number="42"/>
        </change>
        <counts blocker="1" issue="1" question="1" nit="1" praise="1"/>
        <items>
          <item id="00000000-0000-4000-8000-000000000001" severity="blocker" origin="human">
            <anchor kind="lines" path="src/app.ts" start-line="10" end-line="12"/>
            <title>Guard against an empty list</title>
            <body><![CDATA[Calling \`first()\` on \`[]\` throws.]]></body>
            <suggested-patch format="unified-diff"><![CDATA[--- a/src/app.ts
      +++ b/src/app.ts
      @@ -10,3 +10,4 @@
       const items = load();
      -const first = items[0];
      +if (items.length === 0) return;
      +const first = items[0];
       use(first);
      ]]></suggested-patch>
          </item>
          <item id="00000000-0000-4000-8000-000000000002" severity="issue" origin="impact-finding">
            <anchor kind="lines" path="src/parse.ts" start-line="30" end-line="30"/>
            <title>Cognitive complexity 22 exceeds 15 in parseAll</title>
            <body/>
            <impact metric="cognitive-complexity" function="parseAll" value="22" threshold="15" percentile="97.5"/>
          </item>
          <item id="00000000-0000-4000-8000-000000000003" severity="question" origin="human">
            <anchor kind="file" path="docs/notes.md"/>
            <title>Is this file meant to ship?</title>
            <body><![CDATA[It reads like scratch notes.]]></body>
            <suggested-patch format="unified-diff"><![CDATA[--- a/docs/notes.md
      +++ b/docs/notes.md
      @@ -1,2 +1 @@
      -# Scratch
       Notes
      ]]></suggested-patch>
          </item>
          <item id="00000000-0000-4000-8000-000000000004" severity="praise" origin="human">
            <anchor kind="change"/>
            <title>Clear commit history</title>
            <body/>
          </item>
          <item id="00000000-0000-4000-8000-000000000005" severity="nit" origin="chat-answer" message-id="33333333-3333-4333-8333-333333333333" finding="0">
            <outdated reason="lines-changed" written-against-sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
              <original-anchor kind="lines" path="src/app.ts" start-line="10" end-line="12"/>
            </outdated>
            <title>Prefer &lt;const&gt; &amp; "readonly"</title>
            <body><![CDATA[Use \`as const\` here.
      A CDATA terminator: ]]]]><![CDATA[> stays text.]]></body>
          </item>
        </items>
      </beuve-review>
      "
    `);
  });

  test('is deterministic', ({ expect }) => {
    expect(renderAgentReviewXml(createSampleArtifact())).toBe(
      renderAgentReviewXml(createSampleArtifact()),
    );
  });

  test('keeps CDATA terminators, markup and characters XML cannot carry out of the structure', ({
    expect,
  }) => {
    const item = createTestUraItem({
      headSha: testUraIds.laterHeadSha,
      title: 'a & b <c>',
      body: 'x ]]> y \u{1} z \u{D800} w <tag/>',
      anchor: { kind: 'file', path: 'src/"quoted".ts' },
    });
    const artifact = {
      ...createSampleArtifact(),
      entries: [{ item, placement: { kind: 'current', anchor: item.anchor } }],
    } as const;
    const xml = renderAgentReviewXml(artifact);
    expect(xml).toContain('<title>a &amp; b &lt;c&gt;</title>');
    expect(xml).toContain(
      '<body><![CDATA[x ]]]]><![CDATA[> y \u{FFFD} z \u{FFFD} w <tag/>]]></body>',
    );
    expect(xml).toContain('path="src/&quot;quoted&quot;.ts"');
    expect(xml.split('<![CDATA[')).toHaveLength(3);
  });

  test('renders an empty review', ({ expect }) => {
    const artifact = {
      ...createSampleArtifact({ value: 'approve', source: 'derived' }),
      entries: [],
    };
    expect(renderAgentReviewXml(artifact)).toContain('  <items/>\n</beuve-review>\n');
  });
});
