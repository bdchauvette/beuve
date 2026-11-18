import type { ReviewCommentRecord } from './review-comment-record.ts';
import type { ReviewThread, ReviewThreadComment } from './review-thread.ts';

/**
 * Groups a pull request's line comments into threads (ADR 0140): a reply joins the thread of the
 * comment it answers, however deep, and a reply whose parent wasn't read starts a thread of its
 * own. A thread sits where its first comment sits: on the lines it has now, or, when it has none,
 * where it was first written, marked outdated. Threads are ordered by their first comment, and
 * comments within one oldest first. Pure.
 */
export function reviewThreadsFrom(records: readonly ReviewCommentRecord[]): ReviewThread[] {
  const byId = new Map(
    records.map((record) => {
      return [record.id, record];
    }),
  );
  const groups = new Map<number, ReviewCommentRecord[]>();
  for (const record of records) {
    groups.getOrInsert(rootOf(record, byId).id, []).push(record);
  }
  const threads: { readonly first: ReviewCommentRecord; readonly group: ReviewCommentRecord[] }[] =
    [];
  for (const records of groups.values()) {
    const group = records.toSorted(compareRecords);
    const [first] = group;
    if (first !== undefined) {
      threads.push({ first, group });
    }
  }
  return threads
    .toSorted((a, b) => {
      return compareRecords(a.first, b.first);
    })
    .map(({ first, group }) => {
      return threadFrom(first, group);
    });
}

function rootOf(
  record: ReviewCommentRecord,
  byId: ReadonlyMap<number, ReviewCommentRecord>,
): ReviewCommentRecord {
  let current = record;
  const seen = new Set<number>([record.id]);
  for (;;) {
    if (current.replyTo === undefined) {
      return current;
    }
    const parent = byId.get(current.replyTo);
    if (parent === undefined || seen.has(parent.id)) {
      return current;
    }
    seen.add(parent.id);
    current = parent;
  }
}

const sides = { LEFT: 'base', RIGHT: 'head' } as const;

function threadFrom(
  first: ReviewCommentRecord,
  group: readonly ReviewCommentRecord[],
): ReviewThread {
  const comments = group.map((record): ReviewThreadComment => {
    return {
      id: String(record.id),
      author: record.author,
      body: record.body,
      at: record.at,
      url: record.url,
    };
  });
  const base = {
    id: String(first.id),
    path: first.path,
    side: sides[first.side],
    comments,
  };
  if (first.isFileLevel) {
    return { ...base, sha: first.commitId, isOutdated: false };
  }
  if (first.line !== undefined) {
    return {
      ...base,
      startLine: first.startLine ?? first.line,
      endLine: first.line,
      sha: first.commitId,
      isOutdated: false,
    };
  }
  if (first.originalLine !== undefined) {
    return {
      ...base,
      startLine: first.originalStartLine ?? first.originalLine,
      endLine: first.originalLine,
      sha: first.originalCommitId,
      isOutdated: true,
    };
  }
  return { ...base, sha: first.originalCommitId, isOutdated: true };
}

function compareRecords(a: ReviewCommentRecord, b: ReviewCommentRecord): number {
  if (a.at !== b.at) {
    if (a.at < b.at) {
      return -1;
    }
    return 1;
  }
  return a.id - b.id;
}
