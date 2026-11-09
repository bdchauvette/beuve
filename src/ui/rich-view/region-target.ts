import type { LineRange } from './line-range.ts';

/** Lines of one side that a rendered view points at: head regions, or a removed base region. */
export interface RegionTarget {
  readonly side: 'head' | 'base';
  readonly lines: LineRange;
}
