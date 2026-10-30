# Writing tests

How beuve's tests are written (ADR 0058 for tests, ADR 0059 for time). Every test follows these rules and lint enforces them. `src/internal/git` and `src/internal/session` are the reference examples; `src/main` shows services, fake CLIs and per-directory `testing/test.ts` files.

## The rules

1. Import `test` from the nearest `testing/test.ts`, never from `vitest`. Take everything, `expect` included, from the test context: `test('…', ({ expect, db }) => …)`.
2. No hooks. Setup and cleanup are fixtures (`test.extend` with `onCleanup`) in a `testing/test.ts`.
3. Nothing at the top of a test file but imports, types and `function` declarations: no `const`/`let`. Per-test data goes in the test or in a small function; shared helpers go in `testing/`.
4. Tests run concurrently. Opt out with `test('…', { concurrent: false }, …)` when a test fakes time (the `clock` fixture, `vi.useFakeTimers`, `vi.setSystemTime`) or touches process-wide state such as `process.env`.
5. Never mock modules (`vi.mock`, `vi.hoisted`, `vi.spyOn` on an import). Inject the dependency. Time is the exception: code reads `Temporal.Now`, and tests fake it with the `clock` fixture.
6. No `if` in tests. Assert a `Result` directly, or unwrap one with `okValueFrom(result)` (`#testing/ok-value-from.ts`) when the test needs its value to go on.
7. Prefer `toStrictEqual` and `expect(promise).resolves`. Use `test.for` (not `test.each`) for tables: it passes the context as the second argument.
8. No `Date`, and no arithmetic on time numbers (ADR 0059): use `Temporal` values and `Temporal.Duration`.
9. Never block the worker: no `execFileSync`, `execSync` or `spawnSync` in tests or `testing/` (lint enforces it). `repo.git(…)` and `repo.commit(…)` return promises, so `await` them; a synchronous call would make concurrent tests run back to back with every timeout ticking (ADR 0058 amendment).
10. Forward the test's `signal` to everything that takes one (ADR 0075, `local/forward-abort-signal`), and through fixtures that start processes or servers: Vitest aborts it when the test times out, which kills what the test started.

## Fixtures

| Fixture               | From                                | What                                                                          |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `tempRoot` (worker)   | `#testing/test.ts`                  | a real temporary directory for the worker                                     |
| `tempDir`             | `#testing/test.ts`                  | a fresh empty directory, removed after the test                               |
| `db`                  | `#testing/test.ts`                  | an empty in-memory SQLite database; domains add their migrations              |
| `logger`              | `#testing/test.ts`                  | `{ logger, lines }`: a debug-level logger that records parsed lines           |
| `clock`               | `#testing/test.ts`                  | fakes `Temporal.Now` and `Date` from `2026-10-28T12:00:00Z`; `set`, `advance` |
| `repositoryTemplates` | `#internal/git/testing/test.ts`     | builds each repository template once per worker                               |
| `repositories`        | `#internal/git/testing/test.ts`     | `create()` an empty repository, `fromTemplate(template)` a copy               |
| `repo`                | `#internal/git/testing/test.ts`     | an empty repository on `main` (a `TestRepository`)                            |
| `repository`          | `#internal/git/testing/test.ts`     | `repo` opened as a `GitRepository`                                            |
| `deps`                | `#internal/session/testing/test.ts` | `SessionDeps` with counting ids                                               |

A layer's `testing/test.ts` extends the one below it and can refine a fixture with its parent's value:

```ts
export const test = baseTest
  .extend('db', ({ db }) => {
    runMigrations(db, sessionMigrations);
    return db;
  })
  .extend('deps', (): SessionDeps => countingSessionDeps());
```

A repository with history that several tests start from is a template. It is built once per worker and copied (copy-on-write where the file system can) into each test that asks for it. `build` returns plain data:

```ts
function reworkedSeries(): RepositoryTemplate<{ readonly previous: Range; readonly next: Range }> {
  return {
    name: 'compute-commit-pairs: reworked series',
    build: async (repo): Promise<{ readonly previous: Range; readonly next: Range }> => {
      // … commits, rebases …
      return { previous: { base, head: oldHead }, next: { base: newBase, head: newHead } };
    },
  };
}

test('caps the per-pair interdiffs', async ({ expect, repositories }) => {
  const { repo, value: series } = await repositories.fromTemplate(reworkedSeries());
  // …
});
```

## Before and after

A git test, before:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('diffRange', () => {
  let repo: TestRepository;
  let git: GitRepository;
  beforeEach(async () => {
    repo = createTestRepository();
    const opened = await openRepository(repo.directory);
    if (!opened.ok) {
      throw new Error(opened.error.kind);
    }
    git = opened.value;
  });
  afterEach(() => {
    repo.cleanup();
  });

  it('shows only the branch’s changes since its fork point', async () => {
    // … uses repo and git …
    if (result.ok) {
      expect(result.value.files).toHaveLength(1);
    }
  });
});
```

After:

```ts
import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

describe('diffRange', () => {
  test('shows only the branch’s changes since its fork point', async ({
    expect,
    repo,
    repository: git,
  }) => {
    // … uses repo and git …
    expect(okValueFrom(result).files).toHaveLength(1);
  });
});
```

A time-dependent test, before (an injected clock):

```ts
const later = { now: (): Date => new Date('2026-10-28T13:00:00Z') };

it('moves the head and touches updatedAt', () => {
  expect(advanceHead(session, next, later)).toEqual({ ...session, headSha: next, updatedAt: '…' });
});
```

After (the code reads `Temporal.Now.instant()`; the test fakes it and runs alone):

```ts
test(
  'advanceHead moves the head and touches updatedAt',
  { concurrent: false },
  ({ expect, clock }) => {
    clock.set('2026-10-28T13:00:00Z');
    expect(advanceHead(session(), next)).toStrictEqual({
      ...session(),
      headSha: next,
      updatedAt: '2026-10-28T13:00:00.000Z',
    });
  },
);
```

Elapsed time is different from wall time. Code measures it with `new Stopwatch()` (`#x/time/stopwatch.ts`; ADR 0059, amended 2026-10-30), a monotonic clock that the `clock` fixture and `vi.useFakeTimers` do not fake. Use `clock` only for wall time. To control elapsed time, pass a fake clock to the stopwatch: `new Stopwatch({ now: () => fake.nanoseconds })` where `now` returns monotonic nanoseconds as a bigint, or pass the measured `Temporal.Duration` into a function that decides from it. Code that creates its own stopwatch is tested with real, short durations and margins (a 4 s budget against a 5 s minimum for the "spent" branch). Options that take durations are `Temporal.Duration` values: `{ timeout: Temporal.Duration.from({ milliseconds: 50 }) }`.

## Writing a new test directory

1. Move shared setup into fixtures in the directory's `testing/test.ts` (or reuse the ones above). File-specific setup with state becomes a top-level function the test calls with its fixtures (see `attribute-hunks.test.ts`, `find-stack-fork-point.test.ts`).
2. Use functions instead of module-level constants, `test` (not `it`), `test.for` (not `test.each`), `toStrictEqual`, and `okValueFrom` instead of `if (!x.ok) throw`.
3. Mark tests that fake time or set `process.env` `{ concurrent: false }`; the code reads `Temporal.Now`, and tests use the `clock` fixture.
4. Run `npm run check`, and the directory's tests a few times (`npx vitest run --project concurrent <dir>`): concurrency finds shared state that a single run misses. Process-heavy tests (a language server or a Vitest process each) give their `describe` a generous `timeout` and, if they still starve each other, `{ concurrent: false }`.
