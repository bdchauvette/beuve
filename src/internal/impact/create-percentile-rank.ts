/**
 * Ranks values against a population: the mid-rank percentile, 100 × (below + equal / 2) / size,
 * to one decimal (0 for an empty population). Sorts once; each lookup is two binary searches.
 */
export function createPercentileRank(population: readonly number[]): (value: number) => number {
  const sorted = population.toSorted((left, right) => left - right);
  return (value: number): number => {
    if (sorted.length === 0) {
      return 0;
    }
    const below = firstIndex(sorted, (candidate) => candidate >= value);
    const atOrBelow = firstIndex(sorted, (candidate) => candidate > value);
    return Math.round((1000 * (below + (atOrBelow - below) / 2)) / sorted.length) / 10;
  };
}

function firstIndex(sorted: readonly number[], isAtOrAfter: (value: number) => boolean): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (isAtOrAfter(sorted[middle] ?? 0)) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}
