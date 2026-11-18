/**
 * A clock a test moves by hand.
 *
 * Three files in this package inject one into the thing they are testing — the
 * transcript's stamps ({@link ./transcript.ts}), the strip's own reading of
 * them ({@link ./watching.ts}), and how long ago a stored conversation was
 * touched ({@link ./listings.ts}) — and each of them had written the same five
 * lines. That is the shape `web/src/client/chat/rows.testlib.ts` and
 * `live.testlib.ts` already answer one package over, and the reason is the same
 * one: a helper copied is a helper that gets FIXED once. The copies here had
 * already drifted in the two ways copies drift — one took an ISO string and one
 * an epoch number, one returned the new instant from `pass` and one did not —
 * so a reader moving between two of them had to check which they were in.
 *
 * WHY IT IS INJECTED AT ALL, said once here rather than at each caller: the
 * interesting cases are a minute and three hours apart, and waiting for them is
 * not a test strategy. A stamp is then a VALUE a test names rather than
 * something asserted by comparing it with itself.
 *
 * `*.testlib.ts` rather than `*.test.ts`, which is the naming that keeps the
 * runner out of it: this file holds no tests, and a `bun test` that collected
 * one here would be collecting a helper.
 */

/** What a hand-moved clock answers, and how a test moves it. */
export interface Clock {
  /** The instant, in epoch milliseconds — what `Date.now` would have said. */
  readonly now: () => number;
  /** ... and time passing, because nothing here passes on its own. */
  readonly pass: (ms: number) => void;
}

/**
 * A clock stopped at `from` — an ISO instant where a test is about stamps a
 * person reads, and a bare number where it is about arithmetic and the epoch
 * is nobody's subject.
 *
 * BOTH SPELLINGS, because both were already in use and neither is wrong: a
 * transcript test names the moment a row was born (`"2026-08-21T12:00:00.000Z"`
 * appears in its own assertion), and a listings test only needs two instants a
 * known distance apart.
 */
export const clock = (from: string | number): Clock => {
  let at = typeof from === "string" ? Date.parse(from) : from;
  return {
    now: () => at,
    pass: (ms: number) => {
      at += ms;
    },
  };
};
