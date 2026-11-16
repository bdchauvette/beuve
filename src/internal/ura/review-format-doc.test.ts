import { readFile } from 'node:fs/promises';

import { describe } from 'vitest';

import { buildAgentReview } from './build-agent-review.ts';
import { renderAgentReviewXml } from './render-agent-review-xml.ts';
import { createSampleArtifact } from './testing/create-sample-artifact.ts';
import { test } from './testing/test.ts';
import { uraSeverities } from './ura-severities.ts';

async function readDocument(): Promise<string> {
  return readFile(new URL('../../../docs/review-format.md', import.meta.url), 'utf8');
}

describe('docs/review-format.md', () => {
  test('names every element, attribute, label and verdict the XML export can carry', async ({
    expect,
  }) => {
    const names = /(?<=<)[a-z][a-z-]*|[a-z][a-z-]*(?==")/gu;
    const document = await readDocument();
    const xml = renderAgentReviewXml(createSampleArtifact()).split('\n').slice(1).join('\n');
    const used = new Set([
      ...(xml.match(names) ?? []),
      ...uraSeverities,
      'approve',
      'comment',
      'request-changes',
      'full',
      'interdiff',
      'local',
      'github-pull-request',
      'remote-branch',
      'lines-changed',
      'file-deleted',
      'no-line-mapping',
    ]);
    const missing = [...used].filter((name) => !document.includes(`\`${name}\``));
    expect(missing).toStrictEqual([]);
  });

  test('says which schema it describes', async ({ expect }) => {
    const document = await readDocument();
    expect(document).toContain(`\`${buildAgentReview(createSampleArtifact()).schema}\``);
  });
});
