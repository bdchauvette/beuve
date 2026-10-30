import type { ModelEntryInput, ModelRole } from '#contract/ipc-contract.ts';

/**
 * One configured model as main stores it in `settings.json` (ADR 0070). `apiKeyRef` names its
 * key in the encrypted secret store; the key itself is never stored here.
 */
export type ModelEntry = ModelEntryInput & {
  readonly id: string;
  readonly apiKeyRef?: string;
};

/** The configured models and which one each role uses. */
export interface ModelRegistry {
  readonly entries: readonly ModelEntry[];
  readonly roles: Readonly<Record<ModelRole, string>>;
}
