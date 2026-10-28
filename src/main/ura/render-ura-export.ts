import type { UraExportTarget, UraExportView } from '#contract/ipc-contract.ts';
import { buildAgentReview } from '#internal/ura/build-agent-review.ts';
import { buildGithubReview } from '#internal/ura/build-github-review.ts';
import { renderAgentReviewXml } from '#internal/ura/render-agent-review-xml.ts';
import { renderUraMarkdown } from '#internal/ura/render-ura-markdown.ts';
import type { UraArtifact } from '#internal/ura/ura-artifact.ts';

/**
 * One exporter's output for a compiled artifact, as text: JSON is pretty-printed with two spaces
 * so it pastes readably. The GitHub payload is built without `commentableRanges`, since local
 * sessions have no pull request diff; pull request sessions post through `github:post-review`
 * (ADR 0039) instead.
 */
export function renderUraExport(artifact: UraArtifact, target: UraExportTarget): UraExportView {
  const { summary, verdict, entries } = artifact;
  const rendered = render(artifact, target);
  return {
    sessionId: summary.sessionId,
    headSha: summary.headSha,
    target,
    ...rendered,
    verdict: verdict.value,
    verdictSource: verdict.source,
    derivedVerdict: verdict.source === 'chosen' ? verdict.derived : verdict.value,
    itemCount: entries.length,
    outdatedCount: entries.filter((entry) => entry.placement.kind === 'outdated').length,
  };
}

function render(
  artifact: UraArtifact,
  target: UraExportTarget,
): Pick<UraExportView, 'mediaType' | 'text'> {
  switch (target) {
    case 'agent-json': {
      return { mediaType: 'application/json', text: json(buildAgentReview(artifact)) };
    }
    case 'agent-xml': {
      return { mediaType: 'application/xml', text: renderAgentReviewXml(artifact) };
    }
    case 'github': {
      return { mediaType: 'application/json', text: json(buildGithubReview(artifact)) };
    }
    case 'markdown': {
      return { mediaType: 'text/markdown', text: renderUraMarkdown(artifact) };
    }
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}
