/** A noun's singular and plural, for one that doesn't just add `s`. */
export interface NounForms {
  readonly one: string;
  readonly other: string;
}

/** The form of `noun` that goes with `count`: `file` for 1, `files` otherwise. Pure. */
export function nounFor(count: number, noun: string | NounForms): string {
  const forms = formsOf(noun);
  if (count === 1) {
    return forms.one;
  }
  return forms.other;
}

function formsOf(noun: string | NounForms): NounForms {
  if (typeof noun === 'string') {
    return { one: noun, other: `${noun}s` };
  }
  return noun;
}
