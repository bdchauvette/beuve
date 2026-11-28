import type { UraExportTarget, UraExportView } from '#contract/ipc-contract.ts';
import { buildAgentReview } from '#internal/ura/build-agent-review.ts';
import { buildGithubReview } from '#internal/ura/build-github-review.ts';
import { renderAgentReviewXml } from '#internal/ura/render-agent-review-xml.ts';
import type { UraArtifact } from '#internal/ura/ura-artifact.ts';

/** Which export, and the review summary the reviewer typed, if any. */
export interface UraExportOptions {
  readonly target: UraExportTarget;
  readonly summary?: string;
}

/**
 * One exporter's output for a compiled artifact, as text: JSON is pretty-printed with two spaces
 * so it pastes readably. The reviewer's `summary` (the one typed for posting) goes into each: the
 * agent forms' `summary`, the GitHub review's body. The GitHub payload is built without `commentableRanges`, since local
 * sessions have no pull request diff; pull request sessions post through `github:post-review`
 * (ADR 0039) instead.
 */
export function renderUraExport(artifact: UraArtifact, request: UraExportOptions): UraExportView {
  const { summary, verdict, entries } = artifact;
  const { target } = request;
  const rendered = render(artifact, request);
  return {
    sessionId: summary.sessionId,
    headSha: summary.headSha,
    target,
    ...rendered,
    verdict: verdict.value,
    verdictSource: verdict.source,
    derivedVerdict: derivedVerdictOf(verdict),
    itemCount: entries.length,
    outdatedCount: entries.filter((entry) => entry.placement.kind === 'outdated').length,
  };
}

function render(
  artifact: UraArtifact,
  { target, summary }: UraExportOptions,
): Pick<UraExportView, 'mediaType' | 'text'> {
  const options = { ...(summary !== undefined && { summary }) };
  switch (target) {
    case 'agent-json': {
      return { mediaType: 'application/json', text: json(buildAgentReview(artifact, options)) };
    }
    case 'agent-xml': {
      return { mediaType: 'application/xml', text: renderAgentReviewXml(artifact, options) };
    }
    case 'github': {
      return {
        mediaType: 'application/json',
        text: json(buildGithubReview(artifact, options).payload),
      };
    }
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

/** The verdict the staged items alone give: a chosen verdict keeps it beside the choice. */
function derivedVerdictOf(verdict: UraArtifact['verdict']): UraArtifact['verdict']['value'] {
  if (verdict.source === 'chosen') {
    return verdict.derived;
  }
  return verdict.value;
}
