import type { ImpactSourceFile } from '#internal/impact/impact-input.ts';
import type { ImpactReport } from '#internal/impact/impact-report.ts';

/** `workerData` of the ImpactGate worker. */
export interface ImpactWorkerData {
  readonly wasmDirectory: string | undefined;
  readonly maxSourceLength: number | undefined;
}

/** One ImpactGate computation, with blob texts and changed ranges. */
export interface ImpactWorkerRequest {
  readonly id: number;
  readonly sources: readonly ImpactSourceFile[];
}

export type ImpactWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly report: ImpactReport }
  | { readonly id: number; readonly ok: false; readonly message: string };
