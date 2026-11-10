import type { UraArtifact, UraArtifactVerdict, UraEntry, UraSummary } from '../ura-artifact.ts';

import { createTestUraItem } from './create-test-ura-item.ts';
import { testUraIds } from './test-ura-ids.ts';

const { itemId: id, headSha, laterHeadSha } = testUraIds;

/** A pull request review at `laterHeadSha`, an interdiff since `headSha`. */
const sampleSummary: UraSummary = {
  sessionId: testUraIds.sessionId,
  change: {
    kind: 'github-pull-request',
    repoPath: '/work/beuve',
    baseRef: 'main',
    owner: 'acme',
    repo: 'widgets',
    number: 42,
  },
  baseSha: testUraIds.baseSha,
  headSha: laterHeadSha,
  scope: { kind: 'interdiff', fromHeadSha: headSha },
};

/**
 * A sample pull request artifact (an interdiff from `headSha` to `laterHeadSha`) under the given
 * verdict, derived `request-changes` by default.
 */
export function createSampleArtifact(verdict?: UraArtifactVerdict): UraArtifact {
  return {
    summary: sampleSummary,
    entries: sampleEntries(),
    verdict: verdict ?? { value: 'request-changes', source: 'derived' },
  };
}

/**
 * One entry of each interesting shape: a multi-line blocking issue with a pure-replacement patch, a
 * single-line review finding, a file-level question with a non-replacement patch, a
 * whole-change praise, and an outdated review finding with text that needs escaping.
 */
function sampleEntries(): UraEntry[] {
  const blocking = createTestUraItem({
    id: id(1),
    headSha: laterHeadSha,
    blocking: true,
    title: 'Guard against an empty list',
    body: 'Calling `first()` on `[]` throws.',
    suggestion: [
      '@@ -10,3 +10,4 @@',
      ' const items = load();',
      '-const first = items[0];',
      '+if (items.length === 0) return;',
      '+const first = items[0];',
      ' use(first);',
      '',
    ].join('\n'),
  });
  const finding = createTestUraItem({
    id: id(2),
    headSha: laterHeadSha,
    anchor: { kind: 'lines', path: 'src/parse.ts', startLine: 30, endLine: 30 },
    origin: { kind: 'chat-answer', messageId: 'msg-1', finding: 0 },
    title: 'parseAll never checks for an empty list',
    body: '',
  });
  const question = createTestUraItem({
    id: id(3),
    headSha: laterHeadSha,
    anchor: { kind: 'file', path: 'docs/notes.md' },
    severity: 'question',
    title: 'Is this file meant to ship?',
    body: 'It reads like scratch notes.',
    suggestion: ['@@ -1,2 +1 @@', '-# Scratch', ' Notes', ''].join('\n'),
  });
  const praise = createTestUraItem({
    id: id(4),
    headSha: laterHeadSha,
    anchor: { kind: 'change' },
    severity: 'praise',
    title: 'Clear commit history',
    body: '',
  });
  const outdated = createTestUraItem({
    id: id(5),
    severity: 'nitpick',
    origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 0 },
    title: 'Prefer <const> & "readonly"',
    body: 'Use `as const` here.\nA CDATA terminator: ]]> stays text.',
  });
  return [
    { item: blocking, placement: { kind: 'current', anchor: blocking.anchor } },
    { item: finding, placement: { kind: 'current', anchor: finding.anchor } },
    { item: question, placement: { kind: 'current', anchor: question.anchor } },
    { item: praise, placement: { kind: 'current', anchor: praise.anchor } },
    { item: outdated, placement: { kind: 'outdated', reason: 'lines-changed' } },
  ];
}
