/**
 * Shared test helper: pull the next frame from an already-open async iterator
 * with a timeout, failing on a stream that ends before yielding. Every kaval
 * test that waits on a stream frame (the contract corpus, the in-process and
 * socket suites, the inventory-feed assertions) plugs into this ONE primitive,
 * so a change to how the suite races a frame (e.g. surfacing the pending value
 * on timeout) lands in one place instead of three near-identical copies.
 *
 * Dependency-free ON PURPOSE: it lives BELOW the contract layer so the most
 * primitive tests can use it without taking a dependency on
 * `contractCorpus.testlib.ts` (which would invert the layering). The shared-host
 * interleave-skipper `frameUntil` stays in `contractCorpus.testlib.ts` — a
 * distinct, corpus-specific concern that delegates to this.
 *
 * This is a `.testlib.ts`, NOT a `.test.ts`: vitest's `include` is `*.test.ts`,
 * so this file is never run as a standalone suite, and default.nix's staleKey
 * fileFilter excludes `.testlib.ts` so a shared test helper does not land in the
 * daemon's hashed closure.
 */

/** Next frame from an ALREADY-OPEN iterator, with a timeout — does not close it,
 *  so the caller keeps reading (snapshot, then deltas) and closes once. Fails
 *  the test on a timeout or a stream that ends before yielding, so a stalled
 *  subscription is a clear failure, not a hung test. */
export async function nextFrame<T>(
  it: AsyncIterator<T>,
  ms = 8000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("stream timed out")), ms);
  });
  try {
    const r = await Promise.race([it.next(), timeout]);
    if (r.done) throw new Error("stream ended without yielding");
    return r.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
