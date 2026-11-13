/**
 * THE WATCH LIST, and the one decision made about every reading of it: does
 * this wake the Conductor, or not?
 *
 * A PURE module, deliberately. Whether a terminal that just stopped is news
 * depends on exactly six things — what it is doing now, whether an agent was
 * ever seen in it, whether the Conductor has ever spoken to that agent, how
 * the terminal came to be watched, what the conversation has already been
 * told, and whether it is still there at all — and none of them is a socket.
 * The watcher upstream (`packages/server/src/conductor/watcher.ts`) turns
 * padi's streams into {@link WatchObservation}s; the host downstream
 * (`./conductor.ts`) decides where a ring goes. What is WORTH ringing about is
 * here, where it can be tested by calling a function.
 *
 * ## The rules, and the reason for each
 *
 * - **WORKING resets what we were told.** An agent that went back to work will
 *   stop again, and that stop is news. Without the reset a conversation told
 *   once would never hear about the same terminal twice.
 * - **A FRESH AGENT IS `ready`, NOT `stopped`.** Creating a terminal and the
 *   agent in it coming up are seconds apart, and the agent's first idle is
 *   padi's `finishedIds` like any other — so without this rule the Conductor
 *   is told its planner STOPPED before it was ever briefed. While no agent_say
 *   has landed in a watched terminal, an idle agent in it rings `ready`.
 * - **A SHELL never rings — except the one kolu started a command in.** A
 *   terminal with no agent is a prompt somebody left open; it stops being busy
 *   a hundred times an hour and none of them is anything the Conductor can act
 *   on. But a terminal the Conductor created WITH a command, whose command ran
 *   (a non-shell foreground was seen) and which is back at its prompt with no
 *   agent ever detected, is a brief that never started: it rings `ended`.
 * - **A TERMINAL PUT TO SLEEP rings once, and STAYS on the list.** Its agent
 *   is released with it, which is the end of that agent's work; waking the
 *   terminal puts it back on the ordinary levels, so there is nothing to drop.
 * - **GONE rings only if an agent was ever seen.** A terminal that never held
 *   an agent drops off the list silently — that is the same rule as the shell
 *   one, read at the end of a life rather than in the middle of it. Either way
 *   the entry DROPS: there is nothing left to watch.
 * - **A level equal to what we were told does not ring again.** This is what
 *   makes a restart safe: kolu looks at every watched terminal again, and a
 *   terminal that is still stopped for the same reason it was stopped before
 *   the restart is not news a second time.
 * - **A STATE THE CONDUCTOR ITSELF PUT A TERMINAL IN IS NOT NEWS.** Two ways
 *   in: {@link spokenTo} re-baselines `told` the moment an `agent_say` lands,
 *   and a terminal that JOINS by being asked for ({@link WatchJoin}) baselines
 *   on its first reading. Both exist because `agent_say` returns as soon as the
 *   keys are pressed and `watch_terminal` names an agent that is already idle:
 *   without them the Conductor is woken about the agent it has just briefed.
 *
 * `told` is set when a wake is DELIVERED (its turn started), never when it is
 * decided — a ring that waited through a turn and then failed to go must still
 * be owed.
 */

import type { ConductorWakeLevel } from "kolu-common/conductor";

/** HOW A TERMINAL CAME TO BE WATCHED, which is what the `ready` and `ended`
 *  rules read.
 *
 *  - `created` — the Conductor opened it (`lifecycle_create`) with no command.
 *  - `created-run` — ... and typed a command at its first prompt. The ONLY
 *    join `ended` applies to: nothing else gives kolu a command whose return
 *    to the prompt means anything.
 *  - `asked` — the Conductor (or a person) put an existing terminal on the
 *    list with `watch_terminal`. The only join that BASELINES, because it is
 *    the only one whose terminal already has a state nobody here caused. */
export type WatchJoin = "created" | "created-run" | "asked";

/** THE LAST READING, as the entry remembers it — runtime only.
 *
 *  Kept because two decisions are made OUTSIDE a reading: {@link spokenTo}
 *  re-baselines `told` at the level the terminal stands at, and `ended` needs
 *  to know whether the foreground is the shell RIGHT NOW rather than whether
 *  it ever was. Not persisted: a restart re-reads the world, and a remembered
 *  reading would be the one thing in this module that could be stale. */
export interface LastReading {
  readonly level: WatchLevel;
  /** Whether the foreground was the terminal's own shell — padi's answer, or
   *  `null` for a reading that carried none ({@link WatchObservation}). */
  readonly foregroundShell: boolean | null;
}

/** One terminal on the list, as it is remembered — and saved with the
 *  conversation ({@link ./persisted.ts}), except for the two runtime fields
 *  at the bottom.
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
   *  telling — and what keeps `ended` to the terminals that never had one. */
  readonly agent: string | null;
  /** The level the conversation has already been told about, or `null`. */
  readonly told: ConductorWakeLevel | null;
  /** How it came to be watched. */
  readonly joined: WatchJoin;
  /** Whether the Conductor has SAID anything to the agent in it since it
   *  joined the list ({@link spokenTo}). What `ready` turns on: an agent
   *  nobody has briefed is not an agent that stopped. */
  readonly spoken: boolean;
  /** Whether a NON-SHELL FOREGROUND was ever seen in it — padi's
   *  `foreground.shell === false`. Half of `ended`: a command that never ran
   *  cannot have returned. */
  readonly ran: boolean;
  /** RUNTIME ONLY. The last reading of this terminal in THIS process, or
   *  `null` before the first one. */
  readonly last: LastReading | null;
  /** RUNTIME ONLY. Whether the next reading BASELINES this entry rather than
   *  ringing about it — true only for a terminal somebody has just asked to
   *  watch, and never for one a restart restored (whose `told` already says
   *  what it was told). */
  readonly baselining: boolean;
}

/** ONE WATCHED TERMINAL, as a reader OUTSIDE the conversation is told about
 *  it: what the terminal is, never how the bookkeeping stands.
 *
 *  `told`, `spoken`, `ran`, `last` and `baselining` stay in {@link
 *  WatchEntry}. They are how this module decides what rings, they move several
 *  times per reading, and nothing outside can act on one — a reader handed
 *  them would be reading the watcher's working memory and drawing conclusions
 *  from it. What a reader outside is owed is the terminal: which one, what it
 *  was last seen as, and how it got on the list. */
export type WatchedTerminal = Pick<
  WatchEntry,
  "ref" | "name" | "agent" | "joined"
>;

/** What a terminal is doing, as the watcher reads it off its host.
 *
 *  A wake level plus the two readings that never ring on their own: `working`
 *  and `shell` are reported rather than dropped because both MOVE the entry —
 *  one resets what we were told, the other keeps the name current and is where
 *  `ended` is decided.
 *
 *  Two of the wake levels never come off a host: `ready` and `ended` are
 *  CONCLUSIONS this module draws from a `stopped` and a `shell` reading, and
 *  the watcher has no business spelling either. */
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
  /** Whether padi's foreground process IS the terminal's own shell — an idle
   *  prompt with nothing running in front of it. `null` when the reading has
   *  no foreground to report: a sleeping terminal (its PTY is released), one
   *  that is gone, or a record padi has not sampled a foreground for yet.
   *
   *  Reported rather than folded into the level because the DECISION it feeds
   *  is this module's: `ended` is "the command ran and we are back at the
   *  prompt", which is two readings of this one fact and not a state padi has
   *  a word for. */
  readonly foregroundShell: boolean | null;
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
 *  known about it until the watcher reads its host — and if it was ASKED for,
 *  the first reading is a baseline rather than news ({@link observed}). */
export const watchEntry = (ref: string, joined: WatchJoin): WatchEntry => ({
  ref,
  name: "",
  agent: null,
  told: null,
  joined,
  spoken: false,
  ran: false,
  last: null,
  baselining: joined === "asked",
});

/** An entry as a RESTART restores it: everything the record kept, and the two
 *  runtime fields at their empty value.
 *
 *  `baselining` is FALSE, which is the whole point of this function existing
 *  beside {@link watchEntry}: a restored entry's `told` already says what the
 *  conversation has been told, and baselining it again would swallow the one
 *  wake a restart owes — the news that waited through a turn, failed to go,
 *  and was written down as still owed. */
export const restoredEntry = (
  saved: Omit<WatchEntry, "last" | "baselining">,
): WatchEntry => ({ ...saved, last: null, baselining: false });

/**
 * HOW A TERMINAL STANDS, as a wake level — or `null` for a reading that is
 * nothing to tell anybody about.
 *
 * The one place a reading becomes a level, so the rule that `agent_say`
 * re-baselines at ({@link spokenTo}) and the rule a watcher's frame is judged
 * by ({@link observed}) cannot drift apart.
 */
const standsAs = (
  entry: WatchEntry,
  last: LastReading | null,
): ConductorWakeLevel | null => {
  if (last === null) return null;
  switch (last.level) {
    case "working":
      return null;
    case "shell":
      // THE BRIEF THAT NEVER STARTED. Every clause is load-bearing: a command
      // kolu typed (`created-run`), which RAN (a non-shell foreground was
      // seen), which is over (the prompt is back in front), in a terminal no
      // agent was EVER detected in. Anything else is a shell, and a shell
      // never rings.
      return entry.joined === "created-run" &&
        entry.ran &&
        entry.agent === null &&
        last.foregroundShell === true
        ? "ended"
        : null;
    case "asleep":
      // A terminal nobody ever saw an agent in is a tile somebody put away.
      return entry.agent === null ? null : "asleep";
    case "gone":
      return entry.agent === null ? null : "gone";
    case "stopped":
      // AN AGENT NOBODY HAS SPOKEN TO HAS NOT STOPPED — it has arrived.
      return entry.spoken || entry.agent === null ? "stopped" : "ready";
    default:
      // `asking` — and the two levels no watcher produces, which read as
      // themselves if one ever did.
      return last.level;
  }
};

/**
 * One reading of one watched terminal: what the entry becomes, and whether it
 * is worth waking the Conductor about.
 *
 * The entry carries forward what the reading does not say: a name is kept when
 * a reading has none, an agent is kept for good once one has been seen, and
 * `ran` is kept once a command has been seen in front of the shell.
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
  const moved: WatchEntry = {
    ...entry,
    name: named,
    agent,
    ran: entry.ran || seen.foregroundShell === false,
    last: { level: seen.level, foregroundShell: seen.foregroundShell },
    baselining: false,
  };
  // A terminal that is gone has nothing left to watch, whatever else this
  // reading says about it.
  const drop = seen.level === "gone";
  if (entry.baselining) {
    // THE FIRST READING OF A TERMINAL SOMEBODY ASKED FOR is the state it was
    // FOUND in, and the Conductor is told that by the tool's own answer rather
    // than by a wake a second later. An agent already in it counts as spoken
    // to: it is somebody else's conversation, and its next idle is not this
    // conversation's briefing arriving.
    const based: WatchEntry = { ...moved, spoken: agent !== null };
    return {
      entry: { ...based, told: standsAs(based, based.last) },
      ring: null,
      drop,
    };
  }
  if (seen.level === "working") {
    // It will stop again, and that stop is news.
    return { entry: { ...moved, told: null }, ring: null, drop: false };
  }
  const stands = standsAs(moved, moved.last);
  // `told` is left exactly as it was — it is set when a wake is DELIVERED —
  // and a level equal to it is the same news twice.
  return {
    entry: moved,
    ring: stands === null || stands === entry.told ? null : stands,
    drop,
  };
};

/**
 * THE CONDUCTOR JUST SPOKE TO THE AGENT IN THIS TERMINAL.
 *
 * `agent_say` answers as soon as the keys are pressed, so the agent's state
 * has usually not flipped to `working` yet: left alone, the terminal would
 * ring about the idle it was sitting in when it was briefed, the instant the
 * Conductor's turn ends. So the entry re-baselines at the level it STANDS at —
 * which, now that something has been said to it, is `stopped` rather than
 * `ready`.
 *
 * A terminal NOBODY HAS READ YET keeps whatever it was told. There is no
 * state to suppress — the baseline is the thing being computed, and there is
 * nothing to compute it from — and clearing it would make a say the one
 * gesture that makes a terminal MORE likely to ring.
 *
 * The held slot is withdrawn by the caller (`./conductor.ts`): what is here is
 * only what the ENTRY becomes. A later `working` resets `told` as it always
 * did, so the next real stop is news again.
 */
export const spokenTo = (entry: WatchEntry): WatchEntry => {
  const spoken: WatchEntry = { ...entry, spoken: true, baselining: false };
  return { ...spoken, told: standsAs(spoken, spoken.last) ?? entry.told };
};
