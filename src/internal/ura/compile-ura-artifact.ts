import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { deriveUraVerdict } from './derive-ura-verdict.ts';
import type { LineMapping } from './line-mapping.ts';
import { reanchorUraAnchor } from './reanchor-ura-anchor.ts';
import { reanchorUraSuggestion } from './reanchor-ura-suggestion.ts';
import { suggestedPatchFrom } from './suggested-patch-from.ts';
import type {
  UraArtifact,
  UraArtifactError,
  UraArtifactVerdict,
  UraPlacedSuggestion,
  UraPlacement,
  UraSuggestionPlacement,
  UraSummary,
  UraVerdict,
} from './ura-artifact.ts';
import type { UraItem, UraSuggestion } from './ura-item.ts';

/** File texts by head, then by path. */
export type UraHeadTexts = ReadonlyMap<string, ReadonlyMap<string, string>>;

export interface UraArtifactInput {
  readonly summary: UraSummary;
  /** The session's items in note order, every status; only `staged` ones are compiled. */
  readonly items: readonly UraItem[];
  /**
   * One mapping from each older head an item was written against to `summary.headSha`. Mappings
   * to any other head are ignored; items without one are `outdated` (`no-line-mapping`).
   */
  readonly lineMappings: readonly LineMapping[];
  /** The reviewer's verdict, when they chose one over the derived default. */
  readonly verdict?: UraVerdict;
  /**
   * The text of each file a staged item's suggestions name, at the head the item was written
   * against, to derive their patches from. A suggestion whose file is missing has no patch.
   */
  readonly headTexts?: UraHeadTexts;
}

/**
 * Compiles the staged items into the artifact every exporter reads: each item and each of its
 * suggestions is placed on the summary's head (re-anchored if it was written against an older
 * one), each suggestion's patch is derived from `headTexts`, and the verdict is derived
 * from the labels unless the reviewer chose one. Approving over a staged blocking note is refused.
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
  const placeSuggestion = (item: UraItem, suggestion: UraSuggestion): UraSuggestionPlacement => {
    if (item.headSha === summary.headSha) {
      return { kind: 'current', suggestion };
    }
    const mapping = mappings.get(item.headSha);
    if (mapping === undefined) {
      return { kind: 'outdated', reason: 'no-line-mapping' };
    }
    return reanchorUraSuggestion(suggestion, mapping.files);
  };
  const suggestionsOf = (item: UraItem): UraPlacedSuggestion[] => {
    const texts = input.headTexts?.get(item.headSha);
    return item.suggestions.map((suggestion): UraPlacedSuggestion => {
      const text = texts?.get(suggestion.path);
      let patch: string | undefined;
      if (text !== undefined) {
        const derived = suggestedPatchFrom(text, suggestion);
        if (derived.ok) {
          patch = derived.value;
        }
      }
      return {
        suggestion,
        placement: placeSuggestion(item, suggestion),
        ...(patch !== undefined && { patch }),
      };
    });
  };
  const derived = deriveUraVerdict(staged);
  const blocking = staged.filter((item) => item.blocking).map((item) => item.id);
  if (input.verdict === 'approve' && blocking.length > 0) {
    return err({ kind: 'approve-over-blocking', itemIds: blocking });
  }
  let verdict: UraArtifactVerdict = { value: derived, source: 'derived' };
  if (input.verdict !== undefined && input.verdict !== derived) {
    verdict = { value: input.verdict, source: 'chosen', derived };
  }
  return ok({
    summary,
    entries: staged.map((item) => {
      return { item, placement: place(item), suggestions: suggestionsOf(item) };
    }),
    verdict,
  });
}
