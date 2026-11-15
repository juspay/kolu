/**
 * THE WATERFALL'S WORDS, and every rule that reads them.
 *
 * The words themselves are declared in `./schema.ts` — the record's schema
 * embeds them, so that is where they have to be — and re-exported here, which
 * is the one import a reader looking for "what is a mode" should need. What is
 * NEW here is the rules: what a mode RUNS ({@link MODE_RUNS}), which roles it
 * has, which setup keys it cannot live without, who types into its terminals,
 * and the readings of a record that answer those questions off the human's
 * decisions.
 *
 * ## Why one module, and what it is worth
 *
 * These rules used to sit in four places across three packages: `rolesOf`
 * beside the decision readings, `missingSetup` beside the Conductor's refusal
 * sentences, `driverOf` beside the folds, the mode→setup table keyed by plain
 * `string`. Adding a mode was three edits and two silent defaults — a mode
 * nobody listed "needed nothing", and its terminals were driven by nobody. Now
 * a mode is ONE row of {@link MODE_RUNS}, typed by {@link WorkMode}, so a new
 * one is a compile error until every rule says what it means.
 *
 * ## The direction of the arrow
 *
 * `./schema.ts`, `./record.ts`, `./folds.ts` and `./readings.ts` must NOT
 * import this module — that is the test that the mechanism is separable from
 * the vocabulary, and it is held by a `noRestrictedImports` override in
 * `biome.jsonc` rather than by a comment. This module reads all four.
 *
 * What is NOT here is anybody's ENGLISH. The refusal sentences are the
 * Conductor's (they name `work_open` and its arguments), the card's words are
 * the browser's, and the wake's are the wake's. What crosses this wall is the
 * derived FACT — which keys are missing, which words are foreign, who is
 * waiting — and the reader spells it.
 */

import { type Policy, type Waiter, waitingOn } from "./folds.ts";
import { answerValue } from "./readings.ts";
import {
  type Decision,
  hostOf,
  ON_GREEN,
  type OnGreen,
  SETUP_KEYS,
  type SetupKey,
  WORK_MODES,
  WORK_ROLES,
  type Work,
  type WorkMode,
  type WorkRole,
} from "./schema.ts";

export {
  hostOf,
  ON_GREEN,
  type OnGreen,
  SETUP_KEYS,
  type SetupKey,
  WORK_MODES,
  WORK_ROLES,
  type WorkMode,
  type WorkRole,
} from "./schema.ts";

/**
 * HOW EACH MODE IS RUN — the one table the waterfall's shape is written in.
 *
 * Keyed by {@link WorkMode} rather than by `string`, deliberately: a mode
 * added to `WORK_MODES` and not described here does not compile, which is the
 * whole point. Before this table the same fact was read three ways with three
 * fail-open defaults — no roles, no needed setup, no driver — so a half-known
 * mode produced a work that was created half set up and whose terminals were
 * left unlocked.
 *
 *  - `roles` — the parts the mode runs, in the order they come in. A `watch`
 *    runs none: the terminal it adopts is already doing whatever it does.
 *  - `needs` — the setup keys this mode cannot be opened without, BEYOND the
 *    ONE every work needs (`mode`; the host is the work's identity, not a
 *    question). A waterfall mode needs the
 *    implementor's harness and model and what to do when CI is green; `full`
 *    needs the planner's two as well.
 *  - `driven` — whether kolu types into its member terminals. A `watch` is the
 *    person's own terminal and kolu never drives it, so nothing there is ever
 *    locked.
 */
export const MODE_RUNS: Readonly<
  Record<
    WorkMode,
    {
      readonly roles: ReadonlyArray<WorkRole>;
      readonly needs: ReadonlyArray<SetupKey>;
      readonly driven: boolean;
    }
  >
> = {
  full: {
    roles: ["planner", "implementor"],
    needs: [
      "implementor.harness",
      "implementor.model",
      "on-green",
      "planner.harness",
      "planner.model",
    ],
    driven: true,
  },
  trivial: {
    roles: ["implementor"],
    needs: ["implementor.harness", "implementor.model", "on-green"],
    driven: true,
  },
  watch: { roles: [], needs: [], driven: false },
};

/** The roles a mode runs, in the order they come in. */
export const rolesOf = (mode: WorkMode | null): ReadonlyArray<WorkRole> =>
  mode === null ? [] : MODE_RUNS[mode].roles;

/** THE SETUP KEY for one role's harness or model, BY LOOKUP — `null` for a
 *  role that has none.
 *
 *  A lookup rather than `` `${role}.harness` `` with a cast: `SETUP_KEYS`
 *  enumerates exactly the per-role keys that exist, and `other` has none. The
 *  concatenation was correct only because two tables happened to agree, and a
 *  role added to one of them read back as a harness of `null` with nothing
 *  said about why. */
export const setupKeyOf = (
  role: WorkRole,
  what: "harness" | "model",
): SetupKey | null => {
  const spelled = `${role}.${what}`;
  return SETUP_KEYS.find((key) => key === spelled) ?? null;
};

/** THE ORDER THE ROLES COME IN, as a number — the planner plans, the
 *  implementor implements, anything else follows. A token, not words: every
 *  face sorts by it and spells its own labels. */
export const roleRank = (role: WorkRole): number =>
  WORK_ROLES.indexOf(role) < 0 ? WORK_ROLES.length : WORK_ROLES.indexOf(role);

/** WHERE A WATERFALL'S FILES LIVE, worktree-relative — the one spelling of
 *  the directory every `file` event's path starts with. */
export const WATERFALL_DIR = ".waterfall/";

/** A waterfall file's own name, for a face that draws one: the path with the
 *  directory taken off, or the path itself when it is somewhere else. */
export const waterfallFileName = (path: string): string =>
  path.startsWith(WATERFALL_DIR) ? path.slice(WATERFALL_DIR.length) : path;

/** The latest ANSWERED decision for a setup key. */
const setupDecision = (work: Work, key: SetupKey): Decision | undefined =>
  work.decisions.findLast(
    (one) =>
      one.key === key &&
      one.kind === "answered" &&
      one.answer.how === "answered",
  );
const among = <T extends string>(
  value: string | null,
  vocabulary: ReadonlyArray<T>,
): T | null =>
  value !== null && (vocabulary as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : null;

/** THE HOST is part of a work's identity now ({@link hostOf} in
 *  `./schema.ts`, read off the key), not a question the human may leave
 *  unanswered. Re-exported here so a reader of the waterfall's readings
 *  finds it where the others are. */

/** The mode, or `null` until answered (or answered with words that are no
 *  mode). */
export const modeOf = (work: Work): WorkMode | null =>
  among(answerValue(setupDecision(work, "mode")), WORK_MODES);

/** What to do when CI is green — the one place it is written. */
export const onGreenOf = (work: Work): OnGreen | null =>
  among(answerValue(setupDecision(work, "on-green")), ON_GREEN);

/** WHAT THE WATERFALL'S WORDS MEAN FOR THIS WORK, as the folds take it.
 *
 *  The folds compute from the timeline and must not re-read the setup three
 *  times over (and could not, without importing this module): the two facts
 *  they need — whether the human asked for a hand-over, and whether this is a
 *  plain watch — are read ONCE here and handed in. */
export const policyOf = (work: Work): Policy => ({
  handOver: onGreenOf(work) === "hand-over",
  watching: modeOf(work) === "watch",
});

/** WHO IS TYPING INTO A MEMBER TERMINAL — the Conductor, or the person who
 *  took it over. `null` for a terminal nothing drives: the work has ended, the
 *  terminal is not an active member of it, or its mode is not one the
 *  Conductor runs ({@link MODE_RUNS}'s `driven`: a `watch` is the human's own
 *  terminal, and a work whose mode nobody has answered yet runs nothing). */
export type Driver = "conductor" | "you";

/** The driver, read off the events the way everything else about a work is:
 *  the latest `taken-over`/`handed-back` for that terminal SINCE it last
 *  joined. So the lock ends by itself when the member leaves or the work ends,
 *  it survives a restart (it is in the stored record), and every reader —
 *  browser, MCP, the host's own refusals — reads one answer. */
export const driverOf = (
  work: Work,
  terminal: string,
  member: { readonly work: string; readonly role: WorkRole } | undefined,
): Driver | null => {
  if (work.state.kind !== "open") return null;
  const mode = modeOf(work);
  if (mode === null || !MODE_RUNS[mode].driven) return null;
  if (member === undefined) return null;
  for (let at = work.events.length - 1; at >= 0; at -= 1) {
    const event = work.events[at];
    if (event === undefined || event.terminal !== terminal) continue;
    // Back to the join THIS membership started at and no further: a terminal
    // that left and came back is driven by the Conductor again, whatever was
    // said about the terminal it used to be.
    if (event.kind === "joined") break;
    if (event.kind === "taken-over") return "you";
    if (event.kind === "handed-back") break;
  }
  return "conductor";
};

export interface SetupReading {
  readonly host: string;
  readonly mode: WorkMode | null;
  readonly roles: ReadonlyArray<{
    readonly role: WorkRole;
    readonly harness: string | null;
    readonly model: string | null;
  }>;
  readonly onGreen: OnGreen | null;
}

/** One role's setup answer for `harness` or `model` — `null` both for a role
 *  that has no such key and for one nobody has answered. */
const roleAnswer = (
  work: Work,
  role: WorkRole,
  what: "harness" | "model",
): string | null => {
  const key = setupKeyOf(role, what);
  return key === null ? null : answerValue(setupDecision(work, key));
};

/** The setup, as the decisions say it. */
export const setupOf = (work: Work): SetupReading => {
  const mode = modeOf(work);
  return {
    host: hostOf(work),
    mode,
    roles: rolesOf(mode).map((role) => ({
      role,
      harness: roleAnswer(work, role, "harness"),
      model: roleAnswer(work, role, "model"),
    })),
    onGreen: onGreenOf(work),
  };
};

/** One setup question as `work_open` carries it — the shape the two checks
 *  below read, stated before any work exists. */
export interface SetupAsk {
  readonly key: SetupKey;
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  readonly given?: string | undefined;
}

/**
 * WHAT THIS SETUP DOES NOT ASK AND MUST — checked BEFORE the work exists and
 * before the human is asked anything.
 *
 * WHICH MODE'S NEEDS APPLY turns on whether the mode is still a question.
 *
 *  - A mode question carrying `given` is a mode ALREADY DECIDED — the human's
 *    request said it, nobody will be asked, and `modeOf` will read exactly
 *    that word back. So the keys needed are exactly `MODE_RUNS[given].needs`.
 *    Taking the union over its options too is what made `given: "trivial"`
 *    demand `planner.harness` and `planner.model` — two questions about a role
 *    a trivial waterfall does not run, put to a person who had already said
 *    which mode they wanted.
 *  - A mode question with no `given` may still come out as any word it
 *    OFFERS, so every one of those modes' needs has to be in the same form: a
 *    question that offers `full` means this work may turn out to be a full
 *    waterfall, and asking the planner's two later is the second form this
 *    whole shape exists to remove.
 *
 * Answers the keys that are missing, in the order they are needed, so the
 * caller's refusal can name all of them at once rather than one per round
 * trip.
 */
export const missingSetup = (
  setup: ReadonlyArray<SetupAsk>,
): ReadonlyArray<SetupKey> => {
  const asked = new Set(setup.map((one) => one.key));
  const modes = new Set<string>();
  const decided = setup.find(
    (one) => one.key === "mode" && one.given !== undefined,
  )?.given;
  if (decided !== undefined) modes.add(decided);
  else
    for (const one of setup) {
      if (one.key !== "mode") continue;
      for (const option of one.options) modes.add(option);
    }
  const needed: SetupKey[] = ["mode"];
  for (const mode of WORK_MODES) {
    if (!modes.has(mode)) continue;
    for (const key of MODE_RUNS[mode].needs)
      if (!needed.includes(key)) needed.push(key);
  }
  return needed.filter((key) => !asked.has(key));
};

/** THE TWO QUESTIONS WHOSE ANSWERS ARE A VOCABULARY, and every word offered
 *  for them that is not one.
 *
 *  {@link modeOf} and {@link onGreenOf} read a decision only when the answer is
 *  one of their words ({@link WORK_MODES}, {@link ON_GREEN}), so a `mode`
 *  question offering "the full thing" would be asked, answered, stored — and
 *  then read as NOTHING: a work with no mode and nobody able to say why. The
 *  fleet face's decoder refuses those options already; this is the backstop
 *  behind it.
 *
 *  Answers the offending words, so the refusal can name all of them at once. */
export const foreignSetupWords = (
  setup: ReadonlyArray<SetupAsk>,
): ReadonlyArray<string> => {
  const foreign: string[] = [];
  for (const one of setup) {
    const vocabulary: ReadonlyArray<string> | null =
      one.key === "mode"
        ? WORK_MODES
        : one.key === "on-green"
          ? ON_GREEN
          : null;
    if (vocabulary === null) continue;
    for (const word of [
      ...one.options,
      ...(one.given === undefined ? [] : [one.given]),
    ])
      if (!vocabulary.includes(word) && !foreign.includes(word))
        foreign.push(`${one.key}: ${JSON.stringify(word)}`);
  }
  return foreign;
};

/** What a terminal is, as a member of a work in progress. */
export interface Membership {
  readonly work: string;
  readonly title: string;
  readonly role: WorkRole;
  /** Who types into it — `conductor` while kolu drives it, `you` once the
   *  person has taken it over, `null` for a member of a work the Conductor
   *  does not drive (a `watch`, or a mode nobody has answered yet). The mark
   *  and the input guard read this one answer ({@link driverOf}). */
  readonly driver: Driver | null;
}

/** THE MEMBERSHIP INDEX — terminal (`host/id`) to the work in progress it is
 *  an active member of. The ONE derivation every mark reads: the dock row,
 *  the tile, the card. */
export const membershipOf = (
  works: ReadonlyMap<string, Work> | ReadonlyArray<readonly [string, Work]>,
  members: ReadonlyMap<
    string,
    { readonly work: string; readonly role: WorkRole }
  >,
): ReadonlyMap<string, Membership> => {
  const byId = works instanceof Map ? works : new Map(works);
  const index = new Map<string, Membership>();
  for (const [terminal, member] of members) {
    const work = byId.get(member.work);
    if (work === undefined || work.state.kind !== "open") continue;
    index.set(terminal, {
      work: member.work,
      title: work.title,
      role: member.role,
      driver: driverOf(work, terminal, member),
    });
  }
  return index;
};

/** HOW MANY WORKS ARE WAITING ON THE HUMAN — the tab's number. Here rather
 *  than beside the fold it calls because the answer depends on each work's
 *  own policy, which is this module's to read. */
export const waitingOnYou = (works: ReadonlyArray<Work>): number =>
  works.filter((one) => waitingOn(one, policyOf(one)) === "you").length;

/** Re-exported so a reader of this module's folds does not have to know which
 *  file the waiter vocabulary is declared in. */
export type { Policy, Waiter };
