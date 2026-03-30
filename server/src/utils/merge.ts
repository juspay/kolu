/** Merge multiple AsyncIterables into one, yielding values as they arrive from any source.
 *  Ends when all sources are exhausted or the signal is aborted. */
export async function* mergeIterables<T>(
  iterables: AsyncIterable<T>[],
  signal?: AbortSignal,
): AsyncIterable<T> {
  const iterators = iterables.map((it) => it[Symbol.asyncIterator]());
  const pending = new Map<number, Promise<{ idx: number; result: IteratorResult<T> }>>();

  function advance(idx: number, iter: AsyncIterator<T>) {
    pending.set(
      idx,
      iter.next().then((result) => ({ idx, result })),
    );
  }

  for (let i = 0; i < iterators.length; i++) advance(i, iterators[i]!);

  try {
    while (pending.size > 0) {
      if (signal?.aborted) return;
      const { idx, result } = await Promise.race(pending.values());
      pending.delete(idx);
      if (result.done) continue;
      yield result.value;
      advance(idx, iterators[idx]!);
    }
  } finally {
    await Promise.allSettled(iterators.map((it) => it.return?.()));
  }
}
