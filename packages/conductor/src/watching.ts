/**
 * THE WATCH LIST, and the one decision made about every reading of it: does
 * this wake the Conductor, or not?
 *
 * A PURE module, deliberately. Whether a terminal that just stopped is news
 * depends on exactly four things — what it is doing now, whether an agent was
 * ever seen in it, what the conversation has already been told, and whether it
 * is still there at all — and none of them is a socket. The watcher upstream
 * (`packages/server/src/conductor/watcher.ts`) turns padi's streams into
 * {@link WatchObservation}s; the host downstream (`./conductor.ts`) decides
 * where a ring goes. What is WORTH ringing about is here, where it can be
 * tested by calling a function.
 *
 * ## The rules, and the reason for each
 *
 * - **WORKING resets what we were told.** An agent that went back to work will
 *   stop again, and that stop is news. Without the reset a conversation told
 *   once would never hear about the same terminal twice.
 * - **A SHELL never rings.** A terminal with no agent in it is a prompt
 *   somebody left open; it stops being busy a hundred times an hour and none of
 *   them is anything the Conductor can act on.
 * - **GONE rings only if an agent was ever seen.** A terminal that never held
 *   an agent drops off the list silently — that is the same rule as the one
 *   above, read at the end of a life rather than in the middle of it. Either
 *   way the entry DROPS: there is nothing left to watch.
 * - **A level equal to what we were told does not ring again.** This is what
 *   makes a restart safe: kolu looks at every watched terminal again, and a
 *   terminal that is still stopped for the same reason it was stopped before
 *   the restart is not news a second time.
 *
 * `told` is set when a wake is DELIVERED (its turn started), never when it is
 * decided — a ring that waited through a turn and then failed to go must still
 * be owed.
 */

import type { ConductorWakeLevel } from "kolu-common/conductor";

/** One terminal on the list, as it is remembered — and saved with the
 *  conversation ({@link ./persisted.ts}).
 *
 *  `name` and `agent` are the LAST THING KOLU SAW, not a mirror: they exist so
 *  a wake can say which terminal it is about even when the host it was on has
 *  stopped answering, and so a terminal that is gone can still be described in
 *  the sentence announcing that it is gone. */
export interface WatchEntry {
  readonly ref: string;
  readonly name: string;
  /** The agent kolu detected in it, or `null` for a terminal no agent has ever
   *  been seen in. STICKY: an agent that exited leaves the terminal a shell,
   *  and the fact that one was once there is what makes its death worth
   *  telling. */
  readonly agent: string | null;
  /** The level the conversation has already been told about, or `null`. */
  readonly told: ConductorWakeLevel | null;
}

/** What a terminal is doing, as the watcher reads it off its host.
 *
 *  Five words where a wake has three: `working` and `shell` are the two
 *  readings that never ring, and they are reported rather than dropped because
 *  both MOVE the entry — one resets what we were told, the other keeps the
 *  name current. */
export type WatchLevel = ConductorWakeLevel | "working" | "shell";

/** One reading of one watched terminal, for refs on CONNECTED hosts only — a
 *  host that is merely not answering says nothing about its terminals, and
 *  `gone` would be a lie about every one of them. */
export interface WatchObservation {
  /** The fleet ref (`host/id`), as the watch list keys it. */
  readonly ref: string;
  /** Its two halves, from the watcher that already holds both — the encoded
   *  host key it subscribed and the id on that host. Split HERE would be this
   *  file re-deriving what its caller knows: a host key may itself contain
   *  slashes (`remote:ssh://box/3`), and one grammar read in two places is one
   *  of them being wrong about a remote. */
  readonly host: string;
  readonly terminalId: string;
  /** What a person calls the host it is on. */
  readonly hostName: string;
  readonly name: string;
  readonly agent: string | null;
  readonly level: WatchLevel;
}

/** What one reading did to one entry. `ring` is the wake level this is worth
 *  waking the Conductor about, or `null`; `drop` is a terminal that is not
 *  there any more and has nothing left to watch. */
export interface Watched {
  readonly entry: WatchEntry;
  readonly ring: ConductorWakeLevel | null;
  readonly drop: boolean;
}

/** A fresh entry, for a terminal somebody just put on the list. Nothing is
 *  known about it until the watcher reads its host. */
export const watchEntry = (ref: string): WatchEntry => ({
  ref,
  name: "",
  agent: null,
  told: null,
});

/**
 * One reading of one watched terminal: what the entry becomes, and whether it
 * is worth waking the Conductor about.
 *
 * The entry carries forward what the reading does not say: a name is kept when
 * a reading has none, and an agent is kept for good once one has been seen.
 */
export const observed = (
  entry: WatchEntry,
  seen: WatchObservation,
): Watched => {
  const named = seen.name === "" ? entry.name : seen.name;
  // STICKY: `null` from a reading means "no agent in it right now", which for
  // a terminal that had one is the agent having exited — the thing its death
  // is worth reporting for.
  const agent = seen.agent ?? entry.agent;
  switch (seen.level) {
    case "working":
      // It will stop again, and that stop is news.
      return {
        entry: { ref: entry.ref, name: named, agent, told: null },
        ring: null,
        drop: false,
      };
    case "shell":
      // Nothing an agent did, so nothing to be told — and nothing to forget
      // either: `told` is about an agent's state, and there is no agent here
      // to have entered a new one.
      return {
        entry: { ref: entry.ref, name: named, agent, told: entry.told },
        ring: null,
        drop: false,
      };
    case "gone":
      return {
        // `told` is left exactly as it was: it is set when a wake is
        // DELIVERED, and this entry is about to drop anyway.
        entry: { ref: entry.ref, name: named, agent, told: entry.told },
        // A terminal no agent was ever seen in drops off in silence.
        ring: agent === null ? null : "gone",
        drop: true,
      };
    default: {
      const ring = entry.told === seen.level ? null : seen.level;
      return {
        entry: { ref: entry.ref, name: named, agent, told: entry.told },
        ring,
        drop: false,
      };
    }
  }
};
