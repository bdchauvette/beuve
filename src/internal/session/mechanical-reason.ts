/**
 * Why a file belongs in the config and mechanical group at the end of a review order (ADR 0065),
 * most specific first: a lockfile, a generated file, a pure rename, a formatting-only change, or a
 * config file.
 */
export type MechanicalReason =
  'lockfile' | 'generated' | 'pure-rename' | 'formatting-only' | 'config';
