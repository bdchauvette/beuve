import type { QueueStackView } from '#contract/ipc-contract.ts';

/** An open pull request as stacking reads it: where it lives and its head and base branches. */
export interface StackNode {
  /** `host/owner/repo#n`. */
  readonly key: string;
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** The head branch, when known. */
  readonly branch: string | undefined;
  readonly baseBranch: string | undefined;
  /** Its head is in another repository, so no pull request of this one can be based on it. */
  readonly isFork: boolean;
}

/** The open pull requests of the queue's repositories, and which of them are queued. */
export interface StackInput {
  readonly nodes: readonly StackNode[];
  /** Keys of the queued pull requests. */
  readonly queued: ReadonlySet<string>;
}

/**
 * The stacks of open pull requests the queue's pull requests belong to (ADR 0113 and its
 * amendment, ADR 0054's relation): within one repository, a pull request whose base branch is
 * another's head branch sits on it. A stack is the whole tree of such pull requests, queued or not,
 * so one whose middle is not waiting on the viewer stays one stack. Each member of a stack of two
 * or more with at least one queued member gets the bottom's key as the stack id (stable while the
 * bottom stays open), its distance from the bottom, the stack's size and its position in stack
 * order (depth first, bottom first, siblings by number). Keys outside the queue in the answer are
 * the stack's context. Pure.
 */
export function queueStacksFrom({
  nodes,
  queued,
}: StackInput): ReadonlyMap<string, QueueStackView> {
  const ordered = nodes.toSorted((left, right) => left.number - right.number);
  const byHead = new Map<string, StackNode>();
  for (const node of ordered) {
    if (!node.isFork && node.branch !== undefined && !byHead.has(branchKey(node, node.branch))) {
      byHead.set(branchKey(node, node.branch), node);
    }
  }
  const parentOf = (node: StackNode): StackNode | undefined => {
    if (node.baseBranch === undefined) {
      return undefined;
    }
    const parent = byHead.get(branchKey(node, node.baseBranch));
    if (parent === node) {
      return undefined;
    }
    return parent;
  };
  const members = new Map<string, StackNode[]>();
  const children = new Map<string, StackNode[]>();
  for (const node of ordered) {
    members
      .getOrInsertComputed(rootOf(node, parentOf).key, () => {
        return [];
      })
      .push(node);
    const parent = parentOf(node);
    if (parent !== undefined) {
      children
        .getOrInsertComputed(parent.key, () => {
          return [];
        })
        .push(node);
    }
  }
  const stacks = new Map<string, QueueStackView>();
  for (const [id, stack] of members) {
    if (stack.length < 2 || stack.every((node) => !queued.has(node.key))) {
      continue;
    }
    const inStack = new Set(stack.map((node) => node.key));
    let position = 0;
    const walk = (node: StackNode, depth: number): void => {
      stacks.set(node.key, { id, depth, size: stack.length, position });
      position += 1;
      const above = children.get(node.key) ?? [];
      for (const child of above) {
        if (inStack.has(child.key) && !stacks.has(child.key)) {
          walk(child, depth + 1);
        }
      }
    };
    const bottom = stack.find((node) => node.key === id);
    if (bottom !== undefined) {
      walk(bottom, 0);
    }
    for (const node of stack) {
      if (!stacks.has(node.key)) {
        walk(node, 0);
      }
    }
  }
  return stacks;
}

/** The bottom of the node's stack; a cycle stops where it would repeat. */
function rootOf(node: StackNode, parentOf: (node: StackNode) => StackNode | undefined): StackNode {
  const seen = new Set<string>([node.key]);
  let root = node;
  let parent = parentOf(root);
  while (parent !== undefined && !seen.has(parent.key)) {
    seen.add(parent.key);
    root = parent;
    parent = parentOf(root);
  }
  return root;
}

/** A branch of the node's repository, case-insensitive in the repository as GitHub is. */
function branchKey(node: StackNode, branch: string): string {
  return `${node.host}/${node.owner}/${node.repo}`.toLowerCase() + `:${branch}`;
}
