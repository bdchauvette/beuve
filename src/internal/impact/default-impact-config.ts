/** ImpactGate thresholds, mirroring the `--cognitive-max` flag of Sonar-style tools. */
export interface ImpactConfig {
  /** A changed function whose cognitive complexity exceeds this is a finding. */
  readonly cognitiveMax: number;
}

/** Sonar's default cognitive complexity limit for TypeScript and JavaScript. */
export const defaultImpactConfig: ImpactConfig = Object.freeze({ cognitiveMax: 15 });
