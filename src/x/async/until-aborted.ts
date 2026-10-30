/**
 * `work`'s result, or `'aborted'` as soon as `signal` aborts (at once if it already has). `work`
 * itself goes on: this only stops waiting for it.
 */
export async function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | 'aborted'> {
  if (signal.aborted) {
    return 'aborted';
  }
  using stack = new DisposableStack();
  const listening = stack.adopt(new AbortController(), (controller) => {
    controller.abort();
  });
  const aborted = new Promise<'aborted'>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve('aborted');
      },
      { once: true, signal: listening.signal },
    );
  });
  return await Promise.race([work, aborted]);
}
