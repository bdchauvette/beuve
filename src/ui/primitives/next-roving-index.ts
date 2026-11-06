/** Which keys move along a list of items, and which way reading goes. */
export interface RovingKey {
  readonly key: string;
  /** The item that has focus now, or -1 when none does. */
  readonly index: number;
  readonly count: number;
  /** A menu moves with ↑ ↓, a tab list with ← →. */
  readonly orientation: 'vertical' | 'horizontal';
  /** In right-to-left text ← moves forward. */
  readonly direction?: 'ltr' | 'rtl';
}

/**
 * The item a key moves focus to in a menu or tab list (ADR 0115): forward and back wrap around,
 * Home and End go to the first and last item. `undefined` when the key does not move (another
 * key, the other orientation's arrows, or an empty list). Pure.
 */
export function nextRovingIndex({
  key,
  index,
  count,
  orientation,
  direction = 'ltr',
}: RovingKey): number | undefined {
  if (count === 0) {
    return undefined;
  }
  const step = stepOf({ key, orientation, direction });
  if (step === 'first') {
    return 0;
  }
  if (step === 'last') {
    return count - 1;
  }
  if (step === undefined) {
    return undefined;
  }
  if (step === 1 && index < 0) {
    return 0;
  }
  if (index < 0) {
    return count - 1;
  }
  return (index + step + count) % count;
}

type Step = 1 | -1 | 'first' | 'last' | undefined;

interface StepKey {
  readonly key: string;
  readonly orientation: 'vertical' | 'horizontal';
  readonly direction: 'ltr' | 'rtl';
}

function stepOf({ key, orientation, direction }: StepKey): Step {
  if (key === 'Home') {
    return 'first';
  }
  if (key === 'End') {
    return 'last';
  }
  if (orientation === 'vertical') {
    return verticalSteps[key];
  }
  const step = horizontalSteps[key];
  if (step === undefined || direction === 'ltr') {
    return step;
  }
  if (step === 1) {
    return -1;
  }
  return 1;
}

const verticalSteps: Readonly<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };
const horizontalSteps: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowLeft: -1 };
