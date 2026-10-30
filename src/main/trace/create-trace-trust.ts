import { realpath } from 'node:fs/promises';

import type { TraceTrustView } from '#contract/ipc-contract.ts';
import { listRemoteUrls } from '#internal/git/list-remote-urls.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

/** The reviewer's approvals to run a repository's own tests (ADR 0036, 0041). */
export interface TraceTrust {
  readonly status: (repository: GitRepository) => Promise<TraceTrustView>;
  readonly grant: (repository: GitRepository) => Promise<TraceTrustView>;
  readonly revoke: (repository: GitRepository) => Promise<TraceTrustView>;
}

export interface TraceTrustOptions {
  /** `<userData>/settings.json`; approvals live in memory without it. */
  readonly settingsPath?: string | undefined;
}

interface Approval {
  readonly trustedAt: string;
  readonly remoteUrl?: string;
}

const settingsKey = 'traceTrustedRepositories';

/**
 * Stores approvals in `settings.json` under `traceTrustedRepositories`, keyed by the repository's
 * real path with the remote URL it was given for (`origin`, else the first remote), keeping every
 * other key. An approval holds while the path is the same and, if a remote was recorded, the
 * repository still has it: a path that now holds another project is not trusted. Nothing is
 * ever trusted by default, and an unreadable or malformed file reads as no approvals.
 */
export function createTraceTrust(options: TraceTrustOptions): TraceTrust {
  const { settingsPath } = options;
  const remembered = new Map<string, Approval>();

  const find = async (key: string): Promise<Approval | undefined> => {
    if (settingsPath === undefined) {
      return remembered.get(key);
    }
    const settings = await readSettingsFile(settingsPath);
    const stored = settings[settingsKey];
    return approvalFrom(
      typeof stored === 'object' && stored !== null
        ? (stored as Record<string, unknown>)[key]
        : undefined,
    );
  };

  const view = async (repository: GitRepository): Promise<TraceTrustView> => {
    const { key, remoteUrl } = await identify(repository);
    const approval = await find(key);
    const isTrusted =
      approval !== undefined &&
      (approval.remoteUrl === undefined || approval.remoteUrl === remoteUrl);
    return {
      trusted: isTrusted,
      repositoryPath: key,
      ...(remoteUrl !== undefined && { remoteUrl }),
    };
  };

  const write = async (key: string, approval: Approval | undefined): Promise<void> => {
    if (approval === undefined) {
      remembered.delete(key);
    } else {
      remembered.set(key, approval);
    }
    if (settingsPath === undefined) {
      return;
    }
    await updateSettingsFile(settingsPath, (current) => {
      const stored = current[settingsKey];
      const others = Object.entries(
        typeof stored === 'object' && stored !== null ? stored : {},
      ).filter(([other]) => other !== key);
      const entries = Object.fromEntries(
        approval === undefined ? others : [...others, [key, approval]],
      );
      return { ...current, [settingsKey]: entries };
    });
  };

  return {
    status: view,
    grant: async (repository): Promise<TraceTrustView> => {
      const { key, remoteUrl } = await identify(repository);
      await write(key, {
        trustedAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
        ...(remoteUrl !== undefined && { remoteUrl }),
      });
      return view(repository);
    },
    revoke: async (repository): Promise<TraceTrustView> => {
      const { key } = await identify(repository);
      await write(key, undefined);
      return view(repository);
    },
  };
}

function approvalFrom(value: unknown): Approval | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { trustedAt, remoteUrl } = value as Record<string, unknown>;
  if (typeof trustedAt !== 'string') {
    return undefined;
  }
  return typeof remoteUrl === 'string' ? { trustedAt, remoteUrl } : { trustedAt };
}

async function identify(
  repository: GitRepository,
): Promise<{ readonly key: string; readonly remoteUrl: string | undefined }> {
  const [key, remotes] = await Promise.all([realPathOf(repository), listRemoteUrls(repository)]);
  const urls = remotes.ok ? remotes.value : [];
  const chosen = urls.find((remote) => remote.name === 'origin') ?? urls[0];
  return { key, remoteUrl: chosen?.url };
}

async function realPathOf(repository: GitRepository): Promise<string> {
  try {
    return await realpath(repository.root);
  } catch {
    return repository.root;
  }
}
