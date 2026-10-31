import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { deriveUraVerdict } from './derive-ura-verdict.ts';
import type { LineMapping } from './line-mapping.ts';
import { reanchorUraAnchor } from './reanchor-ura-anchor.ts';
import type {
  UraArtifact,
  UraArtifactError,
  UraArtifactVerdict,
  UraPlacement,
  UraSummary,
  UraVerdict,
} from './ura-artifact.ts';
import type { UraItem } from './ura-item.ts';

export interface UraArtifactInput {
  readonly summary: UraSummary;
  /** The session's items in dock order, every status; only `staged` ones are compiled. */
  readonly items: readonly UraItem[];
  /**
   * One mapping from each older head an item was written against to `summary.headSha`. Mappings
   * to any other head are ignored; items without one are `outdated` (`no-line-mapping`).
   */
  readonly lineMappings: readonly LineMapping[];
  /** The reviewer's verdict, when they chose one over the derived default. */
  readonly verdict?: UraVerdict;
}

/**
 * Compiles the staged items into the artifact every exporter reads: each item is placed on the
 * summary's head (re-anchored if it was written against an older one) and the verdict is derived
 * from the severities unless the reviewer chose one. Approving over a staged blocker is refused.
 */
export function compileUraArtifact(input: UraArtifactInput): Result<UraArtifact, UraArtifactError> {
  const { summary } = input;
  const foreign = input.items.find((item) => item.sessionId !== summary.sessionId);
  if (foreign !== undefined) {
    return err({ kind: 'foreign-item', itemId: foreign.id });
  }
  const staged = input.items.filter((item) => item.status.kind === 'staged');
  const mappings = new Map(
    input.lineMappings
      .filter((mapping) => mapping.toHeadSha === summary.headSha)
      .map((mapping) => {
        return [mapping.fromHeadSha, mapping] as const;
      }),
  );
  const place = (item: UraItem): UraPlacement => {
    if (item.headSha === summary.headSha) {
      return { kind: 'current', anchor: item.anchor };
    }
    const mapping = mappings.get(item.headSha);
    if (mapping === undefined) {
      return { kind: 'outdated', reason: 'no-line-mapping' };
    }
    return reanchorUraAnchor(item.anchor, mapping.files);
  };
  const derived = deriveUraVerdict(staged.map((item) => item.severity));
  const blockers = staged.filter((item) => item.severity === 'blocker').map((item) => item.id);
  if (input.verdict === 'approve' && blockers.length > 0) {
    return err({ kind: 'approve-with-blockers', itemIds: blockers });
  }
  let verdict: UraArtifactVerdict = { value: derived, source: 'derived' };
  if (input.verdict !== undefined && input.verdict !== derived) {
    verdict = { value: input.verdict, source: 'chosen', derived };
  }
  return ok({
    summary,
    entries: staged.map((item) => {
      return { item, placement: place(item) };
    }),
    verdict,
  });
}
