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
      <beuve-review schema="beuve.ura/2" verdict="request-changes" verdict-source="derived">
        <change scope="interdiff" base-sha="cccccccccccccccccccccccccccccccccccccccc" head-sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" from-head-sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
          <repository kind="github-pull-request" path="/work/beuve" base-ref="main" owner="acme" repo="widgets" number="42"/>
        </change>
        <counts issue="2" suggestion="0" question="1" nitpick="1" thought="0" smell="0" praise="1" note="0" todo="0" chore="0" blocking="1"/>
        <items>
          <item id="00000000-0000-4000-8000-000000000001" severity="issue" blocking="true" origin="human">
            <anchor kind="lines" path="src/app.ts" start-line="10" end-line="12"/>
            <title>Guard against an empty list</title>
            <body><![CDATA[Calling \`first()\` on \`[]\` throws.]]></body>
            <suggestions>
              <suggestion path="src/app.ts" start-line="10" end-line="12">
                <replacement><![CDATA[const items = load();
      if (items.length === 0) return;
      const first = items[0];
      use(first);]]></replacement>
                <patch format="unified-diff" against-sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"><![CDATA[--- a/src/app.ts
      +++ b/src/app.ts
      @@ -10,3 +10,4 @@
       const items = load();
      -const first = items[0];
      +if (items.length === 0) return;
      +const first = items[0];
       use(first);
      ]]></patch>
              </suggestion>
            </suggestions>
          </item>
          <item id="00000000-0000-4000-8000-000000000002" severity="issue" blocking="false" origin="chat-answer" message-id="msg-1" finding="0" confidence="0.5">
            <anchor kind="lines" path="src/parse.ts" start-line="30" end-line="30"/>
            <title>parseAll never checks for an empty list</title>
            <body/>
            <suggestions/>
          </item>
          <item id="00000000-0000-4000-8000-000000000003" severity="question" blocking="false" origin="human">
            <anchor kind="file" path="docs/notes.md"/>
            <title>Is this file meant to ship?</title>
            <body><![CDATA[It reads like scratch notes.]]></body>
            <suggestions>
              <suggestion path="docs/notes.md" start-line="1" end-line="2">
                <replacement><![CDATA[Notes]]></replacement>
                <patch format="unified-diff" against-sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"><![CDATA[--- a/docs/notes.md
      +++ b/docs/notes.md
      @@ -1,2 +1 @@
      -# Scratch
       Notes
      ]]></patch>
              </suggestion>
            </suggestions>
          </item>
          <item id="00000000-0000-4000-8000-000000000004" severity="praise" blocking="false" origin="human">
            <anchor kind="change"/>
            <title>Clear commit history</title>
            <body/>
            <suggestions/>
          </item>
          <item id="00000000-0000-4000-8000-000000000005" severity="nitpick" blocking="false" origin="chat-answer" message-id="33333333-3333-4333-8333-333333333333" finding="0">
            <outdated reason="lines-changed" written-against-sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
              <original-anchor kind="lines" path="src/app.ts" start-line="10" end-line="12"/>
            </outdated>
            <title>Prefer &lt;const&gt; &amp; "readonly"</title>
            <body><![CDATA[Use \`as const\` here.
      A CDATA terminator: ]]]]><![CDATA[> stays text.]]></body>
            <suggestions>
              <suggestion>
                <outdated reason="lines-changed" written-against-sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" path="src/app.ts" start-line="11" end-line="11"/>
                <replacement><![CDATA[const x = [[1]]]]><![CDATA[> as const;]]></replacement>
                <patch format="unified-diff" against-sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><![CDATA[--- a/src/app.ts
      +++ b/src/app.ts
      @@ -11 +11 @@
      -const x = [1];
      +const x = [[1]]]]><![CDATA[> as const;
      ]]></patch>
              </suggestion>
            </suggestions>
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
      entries: [{ item, placement: { kind: 'current', anchor: item.anchor }, suggestions: [] }],
    } as const;
    const xml = renderAgentReviewXml(artifact);
    expect(xml).toContain('<title>a &amp; b &lt;c&gt;</title>');
    expect(xml).toContain(
      '<body><![CDATA[x ]]]]><![CDATA[> y \u{FFFD} z \u{FFFD} w <tag/>]]></body>',
    );
    expect(xml).toContain('path="src/&quot;quoted&quot;.ts"');
    expect(xml.split('<![CDATA[')).toHaveLength(3);
  });

  test('puts the review summary after the change, in CDATA, and leaves a blank one out', ({
    expect,
  }) => {
    const xml = renderAgentReviewXml(createSampleArtifact(), { summary: '\nShip it ]]> now.\n' });
    expect(xml).toContain(
      '  </change>\n  <summary><![CDATA[Ship it ]]]]><![CDATA[> now.]]></summary>\n  <counts',
    );
    expect(renderAgentReviewXml(createSampleArtifact(), { summary: '  ' })).toBe(
      renderAgentReviewXml(createSampleArtifact()),
    );
  });

  test('writes a deletion as an empty replacement and leaves out a patch it could not derive', ({
    expect,
  }) => {
    const suggestion = {
      id: testUraIds.suggestionId(1),
      path: 'lib/b.ts',
      startLine: 4,
      endLine: 5,
      replacement: '',
    };
    const item = createTestUraItem({ headSha: testUraIds.laterHeadSha, suggestions: [suggestion] });
    const artifact = {
      ...createSampleArtifact(),
      entries: [
        {
          item,
          placement: { kind: 'current', anchor: item.anchor },
          suggestions: [{ suggestion, placement: { kind: 'current', suggestion } }],
        },
      ],
    } as const;
    expect(renderAgentReviewXml(artifact)).toContain(
      [
        '      <suggestions>',
        '        <suggestion path="lib/b.ts" start-line="4" end-line="5">',
        '          <replacement/>',
        '        </suggestion>',
        '      </suggestions>',
      ].join('\n'),
    );
  });

  test('renders an empty review', ({ expect }) => {
    const artifact = {
      ...createSampleArtifact({ value: 'approve', source: 'derived' }),
      entries: [],
    };
    expect(renderAgentReviewXml(artifact)).toContain('  <items/>\n</beuve-review>\n');
  });
});
