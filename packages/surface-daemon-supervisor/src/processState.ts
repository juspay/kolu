/**
 * `readProcessState` — the supervisor's *ask*: what RUN STATE is this pid in?
 *
 * The endpoint's fourth pid-lifecycle question, beside `waitForPidGone` (is a
 * pid gone?), the gate's `isHolderLive` (is a pid alive?) and `readSocketHolders`
 * (who holds this socket path?): this one answers *is the holder stopped, so it
 * cannot be running a shutdown handler* — the fact that lets the reap ladder skip
 * a 120 s graceful window that could only ever be spent for nothing (#2101).
 *
 * **Nothing here reads the OS, and nothing here parses a platform's process
 * table.** The old reader hand-rolled `/proc/<pid>/stat` on linux and shelled out
 * to `ps -o stat=` on darwin. Both are gone: the state is one `osfacts snapshot
 * --pids <pid> --status` call, whose `STAT` row already carries the same symbol
 * `ps` would print. What is left in this module is the SHAPE OF THE ASK — a
 * function type on `EndpointSpec`, and the fold from a status reading to the one
 * domain answer a caller acts on.
 *
 * **The binary path is injected, not resolved here.** `@kolu/surface-daemon-supervisor`
 * is shared spine: kolu bakes `KOLU_OSFACTS_BIN` and drishti bakes
 * `DRISHTI_OSFACTS_BIN`, and a package that knew either name would be a package
 * that belongs to one of them. Composition roots resolve their own bake once
 * (`bakedOsFactsBin(<their var>)`, which throws loudly at boot when the wrapper
 * did not bake it — no PATH fallback, here or anywhere) and pass that path to
 * {@link processStateReader}.
 *
 * **A read that fails is a FAILURE, never "not stopped".** The fold keeps the
 * same contract as `osfacts-client`'s own `processIdentityAsync`: ESRCH/ENOENT is
 * an honest domain answer (`undefined` — the pid is gone, and the reap ladder's
 * KILL leg reports that immediately anyway), and any other unreadable or missing
 * row THROWS into the error channel. A caller must never see a failed read
 * collapsed into "proceed with the graceful wait", which is the silent fallback
 * this seam exists to make unspellable.
 */
import { Effect } from "effect";
import type { OsfactsClientError } from "osfacts-client";
import { OsfactsParseError, snapshotPids } from "osfacts-client";

/**
 * A pid's OS run state — the single-character `ps`/`/proc/<pid>/stat` symbol
 * (`R` running, `S`/`D` sleeping, `T` stopped, `t` tracing stop, `Z` zombie, …),
 * as `osfacts snapshot --status` reports it. Deliberately the RAW symbol: folding
 * a symbol to a consumer's own vocabulary is the consumer's one decision, and a
 * reader that guessed would be a second place to change.
 */
export type ProcessState = string;

/**
 * Ask the OS for a pid's run state, or `undefined` when the pid is gone.
 * Injected on `EndpointSpec` beside `readProcessIdentity` / `readSocketHolders`
 * for the same reason: the spine never learns which env var a consumer bakes the
 * osfacts binary into, and never parses a platform's process table itself.
 *
 * An **Effect** whose error channel is `osfacts-client`'s own union, so a read
 * that could not complete is a failure the endpoint reports (`dead`) and
 * rethrows (R3-5) rather than a value the reap ladder would have to interpret.
 */
export type ReadProcessState = (
  pid: number,
) => Effect.Effect<ProcessState | undefined, OsfactsClientError>;

/**
 * The fold from a `--status` reading to a pid's run state, or `undefined` when
 * the pid is dead/absent. A twin of `osfacts-client`'s `foldStartTimeReading`,
 * and the same contract: ESRCH/ENOENT is an honest domain answer (`undefined` —
 * the pid is gone), and any other unreadable or missing row throws, because a
 * live pid the OS declined to describe is a failure a caller must see rather
 * than a state it may guess at.
 */
function foldStatusReading(
  reading: {
    statuses: readonly { pid: number; state: string }[];
    unreadable: readonly { pid: number; facet: string; errno: string }[];
  },
  pid: number,
): ProcessState | undefined {
  const row = reading.statuses.find((value) => value.pid === pid);
  if (row !== undefined) return row.state;
  const unreadable = reading.unreadable.find(
    (value) => value.pid === pid && value.facet === "status",
  );
  if (
    unreadable !== undefined &&
    (unreadable.errno === "ESRCH" || unreadable.errno === "ENOENT")
  ) {
    return undefined;
  }
  throw new OsfactsParseError({
    message:
      unreadable !== undefined
        ? `osfacts could not read pid ${pid} state (${unreadable.errno})`
        : `osfacts returned no state for pid ${pid}`,
  });
}

/**
 * The osfacts-backed reader a composition root binds: `processStateReader(bin)`
 * is the `ReadProcessState` the endpoint takes. `bin` is the SAME resolved path
 * the root passes to `processIdentityAsync` / `osfactsSocketHolders`, so one
 * root spells its env var once for all the OS facts.
 */
export function processStateReader(bin: string): ReadProcessState {
  return (pid) =>
    Effect.flatMap(snapshotPids(bin, [pid], { status: true }), (reading) =>
      Effect.try({
        try: () => foldStatusReading(reading, pid),
        catch: (error) => error as OsfactsClientError,
      }),
    );
}
