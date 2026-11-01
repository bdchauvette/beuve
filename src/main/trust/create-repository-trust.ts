import { realpath } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';

import type { TrustEntryView, TrustView } from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import type { RemoteUrl } from '#internal/git/parse-remote-urls.ts';
import { deleteTrustGrant } from '#internal/trust/delete-trust-grant.ts';
import { findTrustGrant } from '#internal/trust/find-trust-grant.ts';
import { listTrustGrants } from '#internal/trust/list-trust-grants.ts';
import { saveTrustGrant } from '#internal/trust/save-trust-grant.ts';
import type { TrustGrant, TrustSubject } from '#internal/trust/trust-scope.ts';
import type { Logger } from '#x/log/create-logger.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

/**
 * The reviewer's one trust grant per repository (ADR 0036, 0041, 0090): it covers running the
 * repository's tests (trace probes) and installing its dependencies, install scripts included.
 */
export interface RepositoryTrust {
  readonly status: (repository: GitRepository) => Promise<TrustView>;
  readonly grant: (repository: GitRepository) => Promise<TrustView>;
  readonly revoke: (repository: GitRepository) => Promise<TrustView>;
  /** Every stored repository grant, by path (the Settings window, ADR 0068). */
  readonly list: () => Promise<readonly TrustEntryView[]>;
  /** Withdraws the grant stored under `repositoryPath`, whether or not the folder still exists. */
  readonly remove: (repositoryPath: string) => Promise<readonly TrustEntryView[]>;
}

export interface RepositoryTrustOptions {
  readonly db: DatabaseSync;
  readonly logger: Logger;
  /**
   * `<userData>/settings.json`, where earlier versions kept approvals under
   * `traceTrustedRepositories`. They are moved into `trust_grants` on first use and the key is
   * removed (ADR 0090).
   */
  readonly legacySettingsPath?: string | undefined;
}

const legacyKey = 'traceTrustedRepositories';

/**
 * Grants in `trust_grants` (ADR 0090), matched through the trust domain's scope matcher. A
 * repository is identified by the real path of its top level and its `origin` URL (else its first
 * remote's): a grant holds while the path is the same and, if it recorded a URL, the repository
 * still has it. Nothing is trusted by default.
 */
export function createRepositoryTrust(options: RepositoryTrustOptions): RepositoryTrust {
  const { db, logger } = options;
  let imported: Promise<void> | undefined;

  const ready = async (): Promise<void> => {
    imported ??= importLegacyGrants(options);
    await imported;
  };

  const view = async (repository: GitRepository): Promise<TrustView> => {
    await ready();
    const subject = await identify(repository);
    const grant = findTrustGrant(listTrustGrants(db), subject);
    return {
      trusted: grant !== undefined,
      repositoryPath: subject.repositoryPath,
      ...(subject.remoteUrl !== undefined && { remoteUrl: subject.remoteUrl }),
    };
  };

  const list = async (): Promise<readonly TrustEntryView[]> => {
    await ready();
    return listTrustGrants(db).map((grant) => entryViewFrom(grant));
  };

  return {
    status: view,
    list,
    grant: async (repository): Promise<TrustView> => {
      await ready();
      const { repositoryPath, remoteUrl } = await identify(repository);
      saveTrustGrant(db, {
        scope: {
          kind: 'repository',
          path: repositoryPath,
          ...(remoteUrl !== undefined && { remoteUrl }),
        },
        grantedAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
      });
      logger.info('trusted a repository', { repositoryPath });
      return view(repository);
    },
    revoke: async (repository): Promise<TrustView> => {
      await ready();
      const { repositoryPath } = await identify(repository);
      deleteTrustGrant(db, { kind: 'repository', key: repositoryPath });
      return view(repository);
    },
    remove: async (repositoryPath): Promise<readonly TrustEntryView[]> => {
      await ready();
      deleteTrustGrant(db, { kind: 'repository', key: repositoryPath });
      return list();
    },
  };
}

function entryViewFrom({ scope, grantedAt }: TrustGrant): TrustEntryView {
  return {
    repositoryPath: scope.path,
    trustedAt: grantedAt,
    ...(scope.remoteUrl !== undefined && { remoteUrl: scope.remoteUrl }),
  };
}

/** Moves `traceTrustedRepositories` from `settings.json` into the table, once. Never rejects. */
async function importLegacyGrants({
  db,
  logger,
  legacySettingsPath,
}: RepositoryTrustOptions): Promise<void> {
  if (legacySettingsPath === undefined) {
    return;
  }
  try {
    const settings = await readSettingsFile(legacySettingsPath);
    if (!Object.hasOwn(settings, legacyKey)) {
      return;
    }
    const grants = legacyGrantsFrom(settings[legacyKey]);
    for (const grant of grants) {
      saveTrustGrant(db, grant);
    }
    await updateSettingsFile(legacySettingsPath, (current) => {
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== legacyKey));
    });
    logger.info('moved trust grants out of settings.json', { count: grants.length });
  } catch (error: unknown) {
    logger.warn('could not move trust grants out of settings.json', { error });
  }
}

function legacyGrantsFrom(stored: unknown): readonly TrustGrant[] {
  if (typeof stored !== 'object' || stored === null) {
    return [];
  }
  return Object.entries(stored).flatMap(([path, value]): TrustGrant[] => {
    if (typeof value !== 'object' || value === null || path === '') {
      return [];
    }
    const { trustedAt, remoteUrl } = value as Record<string, unknown>;
    if (typeof trustedAt !== 'string' || trustedAt === '') {
      return [];
    }
    return [
      {
        scope: {
          kind: 'repository',
          path,
          ...(typeof remoteUrl === 'string' && remoteUrl !== '' && { remoteUrl }),
        },
        grantedAt: trustedAt,
      },
    ];
  });
}

async function identify(repository: GitRepository): Promise<TrustSubject> {
  const [repositoryPath, remotes] = await Promise.all([
    realPathOf(repository),
    listRemoteUrls(repository),
  ]);
  let urls: readonly RemoteUrl[] = [];
  if (remotes.ok) {
    urls = remotes.value;
  }
  const chosen = urls.find((remote) => remote.name === 'origin') ?? urls[0];
  return { repositoryPath, remoteUrl: chosen?.url };
}

async function realPathOf(repository: GitRepository): Promise<string> {
  try {
    return await realpath(repository.root);
  } catch {
    return repository.root;
  }
}
