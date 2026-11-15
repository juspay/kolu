/**
 * ONE READING OF ONE MEMBER TERMINAL — the vocabulary every half of the
 * observation chain is written in, and nothing else.
 *
 * A LEAF, deliberately. The chain is `padi frames → ./readings.ts →
 * ./members.ts (is this worth waking the Conductor?) + ./observing.ts (what
 * does it mean to the work?) → the store`, and all four of those modules speak
 * these three shapes. Declared in the RULES module, as they were, the most
 * depended-upon thing in the chain would live inside the most volatile one;
 * here both rule modules import downwards and neither imports the other.
 *
 * Nothing in here decides anything: no rule, no clock, no I/O. What an
 * observation MEANS is `./members.ts`'s (a wake level) and `./observing.ts`'s
 * (a timeline event).
 */

import type { ConductorReadingLevel } from "kolu-common/conductor";

/** What a terminal is doing, as the watcher reads it off its host.
 *
 *  The four levels a wake shares, the two readings that never ring on their
 *  own (`working` and `shell` are reported rather than dropped because both
 *  MOVE the member — one resets what we were told, the other keeps the name
 *  current and is where `ended` and `exited` are decided), and the two
 *  PRESENCE readings padi publishes before an agent has any transcript:
 *  `starting` and `fresh`.
 *
 *  `ready`, `ended` and `exited` are not in here at all: they are what
 *  `./members.ts` ANSWERS with. */
export type WatchLevel = ConductorReadingLevel;

/** WHERE A MEMBER TERMINAL IS WORKING, off its padi record — the worktree the
 *  work's files are listed from, the branch and the repository. `null` for a
 *  terminal whose record says it is in no repository (or one nobody has read
 *  yet). */
export interface WatchGit {
  readonly worktree: string;
  readonly branch: string;
  readonly repo: string;
}

/** THE PULL REQUEST OF A PIECE OF WORK, as the forge reports it — the one live
 *  fact about a work that kolu cannot see from a terminal's screen.
 *
 *  Read from the WORK, not from a member: a work is a branch on a machine, so
 *  kolu asks that host for the pull request of that branch in that repository
 *  for as long as the work is open, whether or not any terminal is left
 *  (`readings.ts`'s {@link prReading} folds padi's reading into this). What
 *  becomes an EVENT is decided against the work's own timeline (`kolu-work`'s
 *  `prOf`, `checksSeen`), never against the last reading: a restart must record
 *  nothing twice. */
export interface WatchPr {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  /** How its checks stand, or `null` when none have been reported. The words
   *  are the forge's; `kolu-work`'s `CHECK_STEP` is the one table that says
   *  what each becomes on a timeline. */
  readonly checks: "pending" | "pass" | "fail" | null;
  /** The names of the checks that are failing, when any are. */
  readonly failing: ReadonlyArray<string>;
  /** THE COMMIT the two fields above are about — the PR's head, off the same
   *  reading. A check event is news about ONE commit, so a reading of a commit
   *  the timeline already holds adds nothing and a PUSH adds an event. `null`
   *  when the reading carries no head (a host whose padi predates the field);
   *  then the work hears about that PR's checks once per kind, ever, which is
   *  the honest reading of a source that cannot say which commit it meant. */
  readonly head: string | null;
}

/** One reading of one member terminal, for refs on CONNECTED hosts only — a
 *  host that is merely not answering says nothing about its terminals, and
 *  `gone` would be a lie about every one of them. */
export interface WatchObservation {
  /** The fleet ref (`host/id`), as the work's members are keyed. */
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
   *  is `./members.ts`'s: `ended` is "the command ran and we are back at the
   *  prompt", which is two readings of this one fact and not a state padi has
   *  a word for. */
  readonly foregroundShell: boolean | null;
  /** The repository this terminal is in, off the same record. The PR is NOT
   *  here: a pull request belongs to the WORK (its branch), and is observed
   *  once for the work rather than once per member that can see it. */
  readonly git: WatchGit | null;
}
