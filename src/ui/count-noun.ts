import { nounFor } from './noun-for.ts';
import type { NounForms } from './noun-for.ts';

/** `1 file`, `3 files`: `count` and the form of `noun` that goes with it. Pure. */
export function countNoun(count: number, noun: string | NounForms): string {
  return `${String(count)} ${nounFor(count, noun)}`;
}
