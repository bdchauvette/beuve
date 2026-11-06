import { listViewerTeams } from '#internal/github/list-viewer-teams.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';

import type { QueueCache } from './create-queue-cache.ts';
import type { QueueRun } from './queue-run.ts';

/** Where to read the viewer's teams, and what remembers them. */
export interface ViewerTeamsLookup {
  readonly host: string;
  readonly cache: QueueCache;
}

/** Teams change rarely; they are read again after this long. */
const teamsLifetime = Temporal.Duration.from({ hours: 1 });

/**
 * The teams the viewer is on, as lowercase `org/slug` (ADR 0113 amendment), read at most once an
 * hour per host. `undefined` when GitHub would not list them (a classic token without `read:org`);
 * that is remembered for the hour too, and not reported: the search's scope warning already says
 * team requests may be missing.
 */
export async function readViewerTeams(
  run: QueueRun,
  { host, cache }: ViewerTeamsLookup,
): Promise<ReadonlySet<string> | undefined> {
  const cached = cache.teams.get(host);
  if (cached !== undefined && Temporal.Duration.compare(cached.age.elapsed(), teamsLifetime) < 0) {
    return cached.teams;
  }
  const answer = await run.withClient(host, async (client) => {
    return listViewerTeams(client, { signal: run.signal });
  });
  let teams: ReadonlySet<string> | undefined;
  if (answer.ok) {
    teams = new Set(answer.value.map((team) => `${team.organization}/${team.slug}`.toLowerCase()));
  }
  cache.teams.set(host, { age: new Stopwatch(), teams });
  return teams;
}
