/**
 * `socketHolders` — ask the OS which process(es) hold a given unix-socket PATH.
 *
 * The supervisor's third pid-lifecycle leaf, beside `waitForPidGone` (is a pid
 * gone?) and the gate's `isHolderLive` (is a pid alive?): this one answers *who
 * listens on this exact socket path* — the identity source the gate-less-squatter
 * recovery needs. The gate names the daemon only while the pidfile survives; when
 * the gate is gone but a live orphan still holds the rendezvous socket, the OS is
 * the only remaining witness of who that holder is.
 *
 * **It no longer reads the OS itself.** Until OSF4 this module carried its own
 * `/proc/net/unix` parse, its own `/proc/<pid>/fd` readlink walk, and its own
 * `lsof` shell-out on darwin — the last of kolu's five hand-rolled OS readers.
 * All of it is now one `osfacts socket-holders` call, so the platform split, the
 * parse rules, and the honesty policy live in the tool that owns them and are
 * pinned by its own two-platform suite. What is left here is the *fold*: turning
 * the tool's document into the answer the recovery acts on.
 *
 * **Three answers, never one.** The old reader returned `SocketHolder[]` and
 * collapsed *nobody holds it*, *someone holds it whom I may not name*, and *I
 * could not look* into the same empty array — so a caller could not tell a free
 * socket from a blind read. They are now separate arms of
 * {@link SocketHolderReading}, and the recovery folds them exhaustively. Only
 * `none` is proof of freedom, and even that proof is deliberately not acted on
 * alone: the caller re-probes the socket before spawning onto it.
 *
 * **Why a LIST, not a single pid.** On linux the bound listener is the one
 * `/proc/net/unix` row that carries the path, so the answer is usually singular
 * — but a child that inherited the listening descriptor holds it too, and on
 * darwin the descriptor walk cannot tell a listener from a connected client. So
 * the leaf returns *every* pid the OS says holds the path, and the caller's
 * handshake — which self-reports the daemon's own pid — selects the true
 * listener from the set (the recovery kills only a pid the OS corroborates AND
 * the daemon named over the socket). That keeps the leaf honest on both
 * platforms without it having to guess listener-vs-client.
 *
 * **The binary path is injected, not resolved here.** `@kolu/surface-daemon-supervisor`
 * is shared spine: kolu bakes `KOLU_OSFACTS_BIN` and drishti bakes
 * `DRISHTI_OSFACTS_BIN`, and a package that knew either name would be a package
 * that belongs to one of them. Composition roots pass the resolved absolute
 * path (`bakedOsFactsBin(<their var>)`), which throws loudly at boot when the
 * wrapper did not bake it — no PATH fallback, here or anywhere.
 */

import {
  socketHolders as readOsfactsSocketHolders,
  type SocketHoldersReading,
} from "osfacts-client";

/** A process the OS reports as holding a socket path — its pid and a human
 *  command label (for the foreign-holder error that must name the culprit). */
export interface SocketHolder {
  pid: number;
  /** A readable command for the pid — osfacts' short display name (the
   *  executable's basename), the same fact on both platforms. `"?"` when the
   *  holder could not be named: it may have exited between the holder lookup
   *  and the identity read. Diagnostic only, never a decision input. */
  command: string;
}

/**
 * What the OS said about who holds a socket path.
 *
 * The three arms are the whole point of this leaf. Folding them into one
 * possibly-empty list is the defect OSF4 deleted, because `[]` then meant
 * "free", "occupied by someone I may not name", and "the read failed" at once
 * — and a supervisor that reads the first meaning while the third is true
 * spawns a second daemon onto a live rendezvous socket.
 */
export type SocketHolderReading =
  /** At least one process the OS named. Never empty. */
  | { readonly kind: "holders"; readonly holders: readonly SocketHolder[] }
  /** Proven: nothing holds this path. Only linux can prove this — its
   *  `/proc/net/unix` table lists every bound unix socket, so absence from it
   *  is evidence rather than silence. */
  | { readonly kind: "none" }
  /** Something may hold the path and the OS would not say what. `detail` names
   *  which of the two shapes it was, for the operator-facing message only —
   *  both decide identically, because neither is proof of freedom. */
  | { readonly kind: "unattributed"; readonly detail: string };

/** Ask the OS which processes hold `socketPath`. Injected on `EndpointSpec` so
 *  the spine never learns which env var a given consumer bakes the binary into. */
export type ReadSocketHolders = (
  socketPath: string,
) => Promise<SocketHolderReading>;

/**
 * The osfacts-backed reader, bound to an already-resolved binary path.
 *
 * `bin` is resolved ONCE at the composition root rather than per call, so a
 * missing bake fails at boot — the loud moment — instead of during a recovery
 * that is already handling a wedged endpoint.
 */
export function osfactsSocketHolders(bin: string): ReadSocketHolders {
  return async (socketPath) =>
    foldSocketHoldersReading(
      await readOsfactsSocketHolders(bin, socketPath, { procs: true }),
    );
}

/**
 * osfacts' document → the answer the recovery acts on.
 *
 * Exported for its own unit pins: this fold is where the three answers are
 * kept apart, so it is where a regression would collapse them.
 */
export function foldSocketHoldersReading(
  reading: SocketHoldersReading,
): SocketHolderReading {
  const named = reading.holders.flatMap((holder) =>
    holder.status === "claimed"
      ? [
          {
            pid: holder.pid,
            command:
              reading.procs.find((row) => row.pid === holder.pid)?.name ?? "?",
          },
        ]
      : [],
  );
  if (named.length > 0) return { kind: "holders", holders: named };
  // A bound socket the tool could not attribute to any readable pid. Linux
  // emits this when the path IS in its table but no pid it may inspect holds
  // the inode — a foreign-uid holder, and emphatically not a free socket.
  if (reading.holders.length > 0)
    return {
      kind: "unattributed",
      detail: "the socket is bound, but its holder is not ours to inspect",
    };
  // The tool could not complete the search. Darwin has no readable table of
  // bound unix sockets, so a descriptor walk denied another user's processes
  // reports this rather than pretending to linux's proof of absence.
  const blind = reading.errors.find((row) => row.facet === "socket_holders");
  if (blind !== undefined)
    return {
      kind: "unattributed",
      detail: `the holder search could not complete (${blind.source}: ${blind.code})`,
    };
  return { kind: "none" };
}
