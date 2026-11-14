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
  ON_GREEN,
  type OnGreen,
  SETUP_KEYS,
  type SetupKey,
  WORK_MODES,
  type Work,
  type WorkMode,
  type WorkRole,
} from "./schema.ts";

export {
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
 *    two every work needs (`host` and `mode`). A waterfall mode needs the
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

/** THE LABEL A SETUP DECISION IS DRAWN UNDER — the key's own name, in the
 *  words a person says. The two keys of one role share a label because a role
 *  is ONE row on the card: "Implementor — omp · claude-opus-5". */
export const SETUP_LABEL: Record<SetupKey, string> = {
  host: "Host",
  mode: "Mode",
  "planner.harness": "Planner",
  "planner.model": "Planner",
  "implementor.harness": "Implementor",
  "implementor.model": "Implementor",
  "on-green": "On green",
};

/** THE SETUP, GROUPED INTO ROWS, in the order they are drawn — one row per
 *  label, so a role's harness and its model are one line and never two. Every
 *  surface that lists the setup reads this order rather than inventing one. */
export const SETUP_ROWS: ReadonlyArray<ReadonlyArray<SetupKey>> = [
  ["host"],
  ["mode"],
  ["planner.harness", "planner.model"],
  ["implementor.harness", "implementor.model"],
  ["on-green"],
];

/** HOW LONG A DRAWN LINE MAY BE. The card's rows are one line each: a
 *  decision, a timeline event. Past this the line is cut and the rest sits
 *  behind a press — never wrapped into a paragraph, which is how the same
 *  seven facts came to fill a screen three times over. */
export const LINE_LIMIT = 72;

/** ... and how long a LABEL may be: a few words, not a sentence. */
export const LABEL_LIMIT = 34;

/** One line of text, and whether anything was left behind it. */
export interface OneLine {
  readonly line: string;
  /** `true` when the line is not the whole of what was given — it was cut, or
   *  it had line breaks the one line flattened. What a press reveals. */
  readonly rest: boolean;
}

/** THE ONE-LINE RULE, in one place. Whitespace (line breaks included) becomes
 *  single spaces, and anything past `limit` is cut at the last word boundary
 *  with an ellipsis. */
export const oneLine = (text: string, limit: number = LINE_LIMIT): OneLine => {
  const whole = text.trim();
  const flat = whole.replace(/\s+/g, " ");
  if (flat.length <= limit) return { line: flat, rest: flat !== whole };
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  const kept = space > limit / 2 ? cut.slice(0, space) : cut;
  return { line: `${kept.replace(/[\s,.;:—-]+$/, "")}…`, rest: true };
};

/** WHAT A DECISION IS CALLED on a card: the setup key's own name, else the
 *  header the asker gave it, else the first few words of the question. The
 *  question itself is never the label — a Conductor that reasons inside its
 *  question ("Full or trivial? I'd pick full: …") would otherwise have its
 *  prose drawn as a heading. */
export const decisionLabel = (decision: Decision): string => {
  if (decision.key !== null) return SETUP_LABEL[decision.key];
  const header = decision.header.trim();
  return oneLine(header === "" ? decision.question : header, LABEL_LIMIT).line;
};

/** The latest ANSWERED decision for a setup key. */
const setupDecision = (work: Work, key: SetupKey): Decision | undefined =>
  work.decisions.findLast(
    (one) => one.key === key && one.answer?.how === "answered",
  );

const among = <T extends string>(
  value: string | null,
  vocabulary: ReadonlyArray<T>,
): T | null =>
  value !== null && (vocabulary as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : null;

/** The host the work runs on, or `null` until the human has said. */
export const hostOf = (work: Work): string | null =>
  answerValue(setupDecision(work, "host"));

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
export const driverOf = (work: Work, terminal: string): Driver | null => {
  if (work.endedAt !== null) return null;
  const mode = modeOf(work);
  if (mode === null || !MODE_RUNS[mode].driven) return null;
  if (
    !work.members.some(
      (one) => one.terminal === terminal && one.leftAt === null,
    )
  )
    return null;
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
  readonly host: string | null;
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
  const needed: SetupKey[] = ["host", "mode"];
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
  works: ReadonlyArray<Work>,
): ReadonlyMap<string, Membership> => {
  const index = new Map<string, Membership>();
  for (const work of works) {
    if (work.endedAt !== null) continue;
    for (const member of work.members) {
      if (member.leftAt !== null) continue;
      index.set(member.terminal, {
        work: work.id,
        title: work.title,
        role: member.role,
        driver: driverOf(work, member.terminal),
      });
    }
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
