import type { ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  FileAttributesView,
  FileReviewProgressView,
  FileReviewStateView,
  RepositoryTreeView,
  ReviewOrderMode,
  ReviewOrderView,
  ReviewThreadView,
  ReviewView,
} from '#contract/ipc-contract.ts';

import type { StatusNotice } from './describe-editor-open.ts';

/** What the review's data needs from the window around it. */
export interface ReviewDataEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The open review; loads that find another one by the time they answer drop their result. */
  readonly review: () => ReviewView | undefined;
  /** The file order the reviewer chose, which a late `calls` order must still match. */
  readonly reviewOrder: () => ReviewOrderMode | undefined;
  /** Whether other reviewers' line comments are wanted (ADR 0140); nothing is read while not. */
  readonly showReviewComments: () => boolean;
  readonly notify: (notice: StatusNotice) => void;
}

interface ReviewDataSnapshot {
  readonly marks: ReadonlyMap<string, FileReviewStateView>;
  readonly progress: FileReviewProgressView | undefined;
  readonly order: ReviewOrderView | undefined;
  readonly tree: RepositoryTreeView | undefined;
  readonly fileAttributes: FileAttributesView | undefined;
  /** Other reviewers' line threads (ADR 0140); empty while the setting is off. */
  readonly threads: readonly ReviewThreadView[];
}

const initial: ReviewDataSnapshot = {
  marks: new Map(),
  progress: undefined,
  order: undefined,
  tree: undefined,
  fileAttributes: undefined,
  threads: [],
};

/**
 * What the window learns about the open review after `session:get-review` answers: the reviewed
 * marks and counts (ADR 0064), the reading order (ADR 0065), the head's tracked paths for the
 * radar tree, and which files `.gitattributes` marks generated
 * (ADR 0052), and other reviewers' line threads when wanted (ADR 0140). `open` starts every load; each drops its answer when another review is open by
 * then. The host re-renders when a getter's value changes.
 */
export class ReviewDataController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: ReviewDataEnvironment;
  private snapshot: ReviewDataSnapshot = initial;
  /** Counts thread reads, so an older answer never replaces a newer one. */
  private threadsRead = 0;

  constructor(host: ReactiveControllerHost, environment: ReviewDataEnvironment) {
    this.host = host;
    this.environment = environment;
  }

  private patch(change: Partial<ReviewDataSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.host.requestUpdate();
  }

  private applyMarks(review: ReviewView): void {
    this.patch({
      marks: new Map(
        review.files.map((file) => {
          return [file.path, file.reviewed ?? 'no'];
        }),
      ),
      progress: review.reviewProgress,
    });
  }

  /** The radar tree's paths, once per head. */
  private async loadTree(review: ReviewView): Promise<void> {
    const bridge = this.environment.bridge();
    const { tree: shown } = this.snapshot;
    if (
      bridge === undefined ||
      (shown?.sessionId === review.session.id && shown.headSha === review.headSha)
    ) {
      return;
    }
    const tree = await bridge.invoke('session:get-tree', { sessionId: review.session.id });
    if (this.environment.review() === review && tree.ok) {
      this.patch({ tree: tree.value });
    }
  }

  /** Which review files `.gitattributes` marks generated or `-diff` (ADR 0052). */
  private async loadFileAttributes(review: ReviewView): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const attributes = await bridge.invoke('session:get-file-attributes', {
      sessionId: review.session.id,
    });
    if (this.environment.review() === review && attributes.ok) {
      this.patch({ fileAttributes: attributes.value });
    }
  }

  /** The review's reviewed marks by path and their counts (ADR 0064). */
  get marks(): ReadonlyMap<string, FileReviewStateView> {
    return this.snapshot.marks;
  }

  get progress(): FileReviewProgressView | undefined {
    return this.snapshot.progress;
  }

  /** The review's reading order, once `session:get-order` answers for its head. */
  get order(): ReviewOrderView | undefined {
    return this.snapshot.order;
  }

  /** The open session head's tracked paths, for the radar tree. */
  get tree(): RepositoryTreeView | undefined {
    return this.snapshot.tree;
  }

  get fileAttributes(): FileAttributesView | undefined {
    return this.snapshot.fileAttributes;
  }

  /** Other reviewers' line threads for the open review (ADR 0140); none while they are off. */
  get threads(): readonly ReviewThreadView[] {
    return this.snapshot.threads;
  }

  /** Forgets the order, tree, file attributes and threads: another session is opening. */
  reset(): void {
    this.threadsRead += 1;
    this.patch({ order: undefined, tree: undefined, fileAttributes: undefined, threads: [] });
  }

  /** A review arrived: show its marks and start every load that follows it. */
  open(review: ReviewView): void {
    this.applyMarks(review);
    void this.loadTree(review);
    void this.reloadOrder(review);
    void this.loadFileAttributes(review);
    void this.reloadThreads(review);
  }

  /**
   * Reads other reviewers' line threads (ADR 0140), when they are wanted: the threads stay on
   * screen while they are read again, an answer that is not the latest or for another review is
   * dropped, and turning them off forgets them.
   */
  async reloadThreads(review: ReviewView): Promise<void> {
    const bridge = this.environment.bridge();
    this.threadsRead += 1;
    if (bridge === undefined || !this.environment.showReviewComments()) {
      if (this.snapshot.threads.length > 0) {
        this.patch({ threads: [] });
      }
      return;
    }
    const read = this.threadsRead;
    const loaded = await bridge.invoke('review:get-threads', { sessionId: review.session.id });
    if (read !== this.threadsRead || this.environment.review() !== review) {
      return;
    }
    if (!loaded.ok) {
      this.environment.notify({
        tone: 'error',
        text: `Other reviewers’ comments: ${loaded.error.message}`,
      });
      return;
    }
    if (loaded.value.kind === 'failed') {
      this.environment.notify({
        tone: 'error',
        text: `Other reviewers’ comments: ${loaded.value.message}`,
      });
      return;
    }
    if (loaded.value.kind === 'unsupported') {
      this.patch({ threads: [] });
      return;
    }
    this.patch({ threads: loaded.value.threads });
  }

  /** The files' reading order (ADR 0065) in the saved mode; `calls` may take a moment. */
  async reloadOrder(review: ReviewView): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined || review.files.length === 0) {
      return;
    }
    const mode = this.environment.reviewOrder();
    const order = await bridge.invoke('session:get-order', { sessionId: review.session.id });
    const isSuperseded = !order.ok && order.error.code === 'cancelled';
    if (
      isSuperseded ||
      this.environment.review() !== review ||
      mode !== this.environment.reviewOrder()
    ) {
      return;
    }
    if (order.ok) {
      this.patch({ order: order.value });
    } else {
      this.patch({ order: undefined });
      this.environment.notify({ tone: 'error', text: `File order: ${order.error.message}` });
    }
  }

  /** File Reviewed: stores the mark against the head the reviewer sees; a moved head says so. */
  async setFileReviewed(path: string, isReviewed: boolean): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      return;
    }
    const marked = await bridge.invoke('review:set-file-reviewed', {
      sessionId: review.session.id,
      path,
      reviewed: isReviewed,
      expectedHeadSha: review.headSha,
    });
    if (this.environment.review() !== review) {
      return;
    }
    if (!marked.ok) {
      this.environment.notify({ tone: 'error', text: marked.error.message });
      return;
    }
    this.patch({
      marks: new Map(this.snapshot.marks).set(path, marked.value.reviewed),
      progress: marked.value.progress,
    });
  }
}
