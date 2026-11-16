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
import type { CheckHead, MergeState, WorkId } from "kolu-work";

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
 *  `prOf`: what it last said about this PR at this commit), never against the
 *  last reading: a restart must record nothing twice. */
export interface WatchPr {
  readonly number: number;
  readonly title: string;
  /** Where it lives, as the forge spelled it — never empty ({@link
   *  prReading} refuses a reading without one) — recorded on `pr-opened`, so
   *  a finished work's PR is still a link. */
  readonly url: string;
  readonly state: "open" | "closed" | "merged";
  /** How its checks stand — none reported, or the forge's rollup over the
   *  ones that have. Two arms rather than a nullable word: "the forge
   *  reported no checks" is a reading, not a hole. `kolu-work`'s `CHECK_STEP`
   *  is the one table that says what each word becomes on a timeline. */
  readonly checks: WatchChecks;
  /** Whether the forge would merge it ({@link WatchMerge}) — the second fact,
   *  kept apart from the checks because a required check that has not
   *  started is in no rollup. */
  readonly merge: WatchMerge;
  /** The names of the checks that are failing, when any are. */
  readonly failing: ReadonlyArray<string>;
  /** THE COMMIT the fields above are about — the PR's head, off the same
   *  reading, in the record's own two arms (`kolu-work`'s `CheckHead`). A
   *  check event is news about ONE commit, so a reading of a commit the
   *  timeline already holds says nothing new unless its word moved, and a
   *  PUSH adds an event. `unreported` is a host whose padi predates the
   *  field; then the work cannot tell its commits apart, which is the honest
   *  reading of a source that cannot say which commit it meant. */
  readonly head: CheckHead;
}

/** HOW A PULL REQUEST'S CHECKS STAND — none reported, or the forge's own
 *  rollup over the checks that have reported. */
export type WatchChecks =
  | { readonly kind: "unreported" }
  | {
      readonly kind: "rollup";
      readonly rollup: "pending" | "pass" | "fail";
    };

/** WHETHER THE FORGE WOULD MERGE IT — an answer, or "not worked out yet for
 *  this commit" (`kolu-work`'s `MergeState`, each of them recorded when it is
 *  news), or a reading that carries no merge state at all (`unreported`): a
 *  padi older than the field. That one is never recorded, and a work read
 *  through it is never green — which the card says, as "GitHub has not said
 *  whether it can merge it". */
export type WatchMerge = MergeState | { readonly kind: "unreported" };

/** A BRANCH WHOSE PULL REQUEST KOLU WATCHES — one per piece of work in
 *  progress that is keyed by a branch. The watch asks the host for the PR of
 *  that branch in that repository; no terminal is involved, so a work with no
 *  members is watched exactly like one with two.
 *
 *  The WORD lives here with the other three watch words; the LIST is derived
 *  off the works' own keys by `./workStore.ts`'s `prWatches`, whose doc is
 *  the one statement of which branches are in it. */
export interface PrWatch {
  readonly work: WorkId;
  /** The fleet host ref the repository is on. */
  readonly host: string;
  readonly repo: string;
  readonly branch: string;
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
