import { Duration, Effect } from "effect";

import type { MissingServer } from "./servers.ts";

export interface ProbedServer {
  readonly name: string;
  /** Absolute: the file that answered the probe, not a word to resolve again. */
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** What to set when launching it, beyond what it inherits. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * WHAT ONE PROBE FOUND — both halves at once, because they are one reading.
 * The two arms are not the same answer: a host that never had the tool had
 * nothing go wrong and is owed no sentence, while a tool that is HERE and
 * would not answer is the one worth telling somebody about.
 */
export interface Probed {
  /** The server to hand a session, or `null` where there is none to hand. */
  readonly server: ProbedServer | null;
  /** What a person is owed about the one they did not get, or `null` where an
   *  absence is the ordinary case and no fault. */
  readonly missing: MissingServer | null;
  /** The probing plugin's own page for this server, if it has one. */
  readonly at?: string;
}

/** ONE THING TO ASK — the caller's own name for it, and the question.
 *
 *  The name is for the log line and for the ORDER, and for nothing else. What a
 *  ROSTER row is called comes off the answer, where whoever found the server
 *  named it. */
export interface Probe {
  readonly name: string;
  /**
   * Ask this host. IT NEVER FAILS: every way of failing is an ARM of
   * {@link Probed} — "the tool is not here" is an answer and not a fault, and
   * "it is here and would not work" is a SENTENCE somebody has to read. The
   * no-failure contract is the prober's to keep: never throws and never logs.
   */
  readonly ask: Effect.Effect<Probed>;
}

const AT_ONCE = 4;

export const probed = (
  probes: ReadonlyArray<Probe>,
): Effect.Effect<ReadonlyArray<Probed>> =>
  Effect.forEach(
    probes,
    (one) =>
      Effect.gen(function* () {
        const [duration, found] = yield* Effect.timed(one.ask);
        yield* said(one.name, found).pipe(
          Effect.annotateLogs({
            duration: `${Math.round(Duration.toMillis(duration))}ms`,
          }),
        );
        return found;
      }),
    { concurrency: AT_ONCE },
  );

const said = (name: string, found: Probed): Effect.Effect<void> => {
  if (found.server !== null) {
    return Effect.annotateLogs(Effect.logDebug(`${name} is on this session`), {
      command: found.server.command,
    });
  }
  if (found.missing !== null) {
    return Effect.annotateLogs(
      Effect.logDebug(`${name} is not on this session`),
      {
        where: found.missing.where,
        why: found.missing.why,
      },
    );
  }
  return Effect.logDebug(`${name} is not running`);
};

export const handedIn = (
  found: ReadonlyArray<Probed>,
): ReadonlyArray<ProbedServer> =>
  found.flatMap((one) => (one.server === null ? [] : [one.server]));

export const missingIn = (
  found: ReadonlyArray<Probed>,
): ReadonlyArray<MissingServer> =>
  found.flatMap((one) => (one.missing === null ? [] : [one.missing]));

export const addressesIn = (
  found: ReadonlyArray<Probed>,
): ReadonlyMap<string, string> =>
  new Map(
    found.flatMap((one) =>
      one.server !== null && one.at !== undefined
        ? [[one.server.name, one.at] as const]
        : [],
    ),
  );
