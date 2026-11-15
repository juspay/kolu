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

import { type AgentModelList, isAgentModelId } from "@kolu/agent-distro/models";
import { Array as Arr, Option } from "effect";
import { type Policy, type Waiter, waitingOn } from "./folds.ts";
import type { Given } from "./record.ts";
import {
  hostOf,
  isAbout,
  isAsked,
  isKoluChoice,
  isKoluChoiceKey,
  type KoluChoiceKey,
  ON_GREEN,
  type OfferedSetupKey,
  type OnGreen,
  SETUP_KEYS,
  type SetupKey,
  UNIQUE_ROLES,
  WORK_MODES,
  type WaterfallRole,
  WORK_ROLES,
  type Work,
  type WorkMode,
  type WorkRole,
} from "./schema.ts";

export {
  hostOf,
  isKoluChoice,
  isKoluChoiceKey,
  KOLU_CHOICE_KEYS,
  type KoluChoice,
  type KoluChoiceKey,
  ON_GREEN,
  OFFERED_SETUP_KEYS,
  type Offered,
  type OfferedSetupKey,
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

/** The roles a mode runs, in the order they come in — none until a mode is
 *  answered. */
export const rolesOf = (
  mode: Option.Option<WorkMode>,
): ReadonlyArray<WorkRole> =>
  Option.match(mode, {
    onNone: () => [],
    onSome: (one) => MODE_RUNS[one].roles,
  });

/** THE SETUP KEY for one role's harness or model, BY LOOKUP — none for a
 *  role that has no such key (`other`), rather than a key spelled by joining
 *  two words: the concatenation was correct only because two tables happened
 *  to agree. */
export const setupKeyOf = (
  role: WorkRole,
  what: "harness" | "model",
): Option.Option<SetupKey> => {
  const spelled = `${role}.${what}`;
  return Option.fromUndefinedOr(SETUP_KEYS.find((key) => key === spelled));
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

/** WHERE ONE SETUP QUESTION STANDS — THE ONE READING of "is this setup
 *  question settled", read by everybody: the setup a card and the Conductor
 *  see ({@link setupOf}), which keys `work_open` asks, whether `startOf`
 *  refuses and what it says, and the form.
 *
 *  - `answered` — the newest answer WITH A VALUE (a decision answered with
 *    nothing is not a value the record can hold);
 *  - `open` — no value, and a question for it is in front of the human now:
 *    the answer will come by itself;
 *  - `unasked` — no value and nothing open (never asked, declined, dropped):
 *    nobody will answer it unless it is asked, which is `work_open`'s job. */
export type SetupStanding<V extends string> =
  | { readonly kind: "answered"; readonly value: V }
  | { readonly kind: "open"; readonly ask: string }
  | { readonly kind: "unasked" };

export function setupStanding(work: Work, key: "mode"): SetupStanding<WorkMode>;
export function setupStanding(
  work: Work,
  key: "on-green",
): SetupStanding<OnGreen>;
export function setupStanding(work: Work, key: SetupKey): SetupStanding<string>;
export function setupStanding(
  work: Work,
  key: SetupKey,
): SetupStanding<string> {
  for (let at = work.decisions.length - 1; at >= 0; at -= 1) {
    const one = work.decisions[at];
    if (
      one !== undefined &&
      one.topic === "setup" &&
      one.key === key &&
      one.kind === "settled" &&
      one.answer.how === "answered"
    )
      return { kind: "answered", value: one.answer.value };
  }
  const open = work.decisions.find(
    (one) => one.topic === "setup" && one.key === key && one.kind === "asked",
  );
  return open === undefined
    ? { kind: "unasked" }
    : { kind: "open", ask: open.ask };
}

/** The value a setup question was answered with — none while it is open or
 *  unasked ({@link setupStanding}, read the one way every reader reads it). */
export function setupValue(work: Work, key: "mode"): Option.Option<WorkMode>;
export function setupValue(work: Work, key: "on-green"): Option.Option<OnGreen>;
export function setupValue(work: Work, key: SetupKey): Option.Option<string>;
export function setupValue(work: Work, key: SetupKey): Option.Option<string> {
  const standing = setupStanding(work, key);
  return standing.kind === "answered"
    ? Option.some(standing.value)
    : Option.none();
}

/** The mode, or none until answered. */
export const modeOf = (work: Work): Option.Option<WorkMode> =>
  setupValue(work, "mode");

/** What to do when CI is green — the one place it is written. */
export const onGreenOf = (work: Work): Option.Option<OnGreen> =>
  setupValue(work, "on-green");

/** WHAT THE WATERFALL'S WORDS MEAN FOR THIS WORK, as the folds take it.
 *
 *  The folds compute from the timeline and must not re-read the setup three
 *  times over (and could not, without importing this module): the two facts
 *  they need — whether the human asked for a hand-over, and whether this is a
 *  plain watch — are read ONCE here and handed in. */
export const policyOf = (work: Work): Policy => ({
  handOver: Option.contains(onGreenOf(work), "hand-over"),
  watching: Option.contains(modeOf(work), "watch"),
});

/** WHO IS TYPING INTO A MEMBER TERMINAL — the Conductor, the person who took
 *  it over, or nobody: the work has ended, the terminal is not an active
 *  member of it, or its mode is not one the Conductor runs
 *  ({@link MODE_RUNS}'s `driven`: a `watch` is the human's own terminal, and
 *  a work whose mode nobody has answered yet runs nothing). */
export type Driver = "conductor" | "you" | "nobody";

/** The driver, read off the events the way everything else about a work is:
 *  the latest `taken-over`/`handed-back` for that terminal SINCE it last
 *  joined. So the lock ends by itself when the member leaves or the work ends,
 *  it survives a restart (it is in the stored record), and every reader —
 *  browser, MCP, the host's own refusals — reads one answer. */
export const driverOf = (
  work: Work,
  terminal: string,
  member: Option.Option<{ readonly work: string; readonly role: WorkRole }>,
): Driver => {
  if (work.state.kind !== "open") return "nobody";
  const mode = modeOf(work);
  if (Option.isNone(mode) || !MODE_RUNS[mode.value].driven) return "nobody";
  if (Option.isNone(member)) return "nobody";
  for (let at = work.events.length - 1; at >= 0; at -= 1) {
    const event = work.events[at];
    if (event === undefined || !isAbout(event, terminal)) continue;
    // Back to the join THIS membership started at and no further: a terminal
    // that left and came back is driven by the Conductor again, whatever was
    // said about the terminal it used to be.
    if (event.kind === "joined") break;
    if (event.kind === "taken-over") return "you";
    if (event.kind === "handed-back") break;
  }
  return "conductor";
};

/** ONE ROLE'S SETUP — nothing chosen, its harness, or its harness and the
 *  model it runs. A model is only ever a model OF a harness, so "a model with
 *  no harness" has no arm. */
export type RoleSetup =
  | { readonly kind: "not-chosen" }
  | { readonly kind: "harness"; readonly harness: string }
  | {
      readonly kind: "harness-and-model";
      readonly harness: string;
      readonly model: string;
    };

export interface SetupReading {
  readonly host: string;
  readonly mode: Option.Option<WorkMode>;
  readonly roles: ReadonlyArray<{
    readonly role: WorkRole;
    readonly setup: RoleSetup;
  }>;
  readonly onGreen: Option.Option<OnGreen>;
}

/** One role's answer for `harness` or `model` — none both for a role that
 *  has no such key and for one nobody has answered. */
const roleAnswer = (
  work: Work,
  role: WorkRole,
  what: "harness" | "model",
): Option.Option<string> =>
  Option.flatMap(setupKeyOf(role, what), (key) => setupValue(work, key));

/** One role's setup, off its two answers. */
export const roleSetupOf = (work: Work, role: WorkRole): RoleSetup =>
  Option.match(roleAnswer(work, role, "harness"), {
    onNone: (): RoleSetup => ({ kind: "not-chosen" }),
    onSome: (harness): RoleSetup =>
      Option.match(roleAnswer(work, role, "model"), {
        onNone: (): RoleSetup => ({ kind: "harness", harness }),
        onSome: (model): RoleSetup => ({
          kind: "harness-and-model",
          harness,
          model,
        }),
      }),
  });

/** The setup, as the decisions say it. */
export const setupOf = (work: Work): SetupReading => {
  const mode = modeOf(work);
  return {
    host: hostOf(work),
    mode,
    roles: rolesOf(mode).map((role) => ({
      role,
      setup: roleSetupOf(work, role),
    })),
    onGreen: onGreenOf(work),
  };
};

/** One setup question as `work_open` carries it — the shape the two checks
 *  below read, stated before any work exists. The questions kolu draws the
 *  options for ({@link KOLU_CHOICE_KEYS}) are NAMED, with what the request
 *  already said: no options and no words, which are kolu's. */
export type SetupAsk =
  | {
      readonly key: OfferedSetupKey;
      readonly question: string;
      readonly options: ReadonlyArray<string>;
      readonly given: Given<string>;
    }
  | {
      readonly key: KoluChoiceKey;
      readonly given: Given<string>;
    };

/**
 * WHAT THIS SETUP DOES NOT ASK AND MUST — checked BEFORE the work exists and
 * before the human is asked anything.
 *
 * WHICH MODE'S NEEDS APPLY turns on whether the mode is still a question.
 *
 *  - A mode question carrying a given value is a mode ALREADY DECIDED — the
 *    human's request said it, nobody will be asked, and `modeOf` will read
 *    exactly that word back. So the keys needed are exactly
 *    `MODE_RUNS[given].needs`. Taking the union over its options too is what
 *    made a given `trivial` demand `planner.harness` and `planner.model` — two
 *    questions about a role a trivial waterfall does not run, put to a person
 *    who had already said which mode they wanted.
 *  - A mode question with nothing given may still come out as any word it
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
  for (const one of setup) {
    if (one.key !== "mode") continue;
    if (one.given.kind === "given") modes.add(one.given.value);
    else for (const option of one.options) modes.add(option);
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
 *  A `mode` or `on-green` answer is one of kolu's words or no answer at all
 *  (the record has nowhere to put another), so a `mode` question offering
 *  "the full thing" would be asked and could never be answered. The fleet
 *  face's decoder refuses those options already; this is the backstop behind
 *  it.
 *
 *  Answers the offending words, so the refusal can name all of them at once. */
export const foreignSetupWords = (
  setup: ReadonlyArray<SetupAsk>,
): ReadonlyArray<string> => {
  const foreign: string[] = [];
  for (const one of setup) {
    if (!("options" in one)) continue;
    const vocabulary: ReadonlyArray<string> =
      one.key === "mode" ? WORK_MODES : ON_GREEN;
    for (const word of [
      ...one.options,
      ...(one.given.kind === "given" ? [one.given.value] : []),
    ])
      if (!vocabulary.includes(word) && !foreign.includes(word))
        foreign.push(`${one.key}: ${JSON.stringify(word)}`);
  }
  return foreign;
};

/** The role a setup key is about, and which of its two it names — none for
 *  `mode` and `on-green`, which are about the whole work. */
export const roleOfSetupKey = (
  key: SetupKey,
): Option.Option<{
  readonly role: WorkRole;
  readonly what: "harness" | "model";
}> => {
  for (const role of WORK_ROLES)
    for (const what of ["harness", "model"] as const)
      if (Option.contains(setupKeyOf(role, what), key))
        return Option.some({ role, what });
  return Option.none();
};

/** ... and for one of kolu's own questions, always a waterfall role: total,
 *  because every kolu-choice key names a planner's or an implementor's
 *  harness or model. */
export const roleOfKey = (
  key: KoluChoiceKey,
): { readonly role: WaterfallRole; readonly what: "harness" | "model" } => {
  for (const role of UNIQUE_ROLES)
    for (const what of ["harness", "model"] as const)
      if (Option.contains(setupKeyOf(role, what), key)) return { role, what };
  throw new Error(
    `roleOfKey: ${key} names no waterfall role's harness or model`,
  );
};

/** THE HARNESS A MODEL QUESTION IS FOR, as this answer leaves it: the one the
 *  same form is answering for that role, else the one the work already
 *  recorded, else none (nobody has said yet). A model is only ever a model OF
 *  a harness, so this is the one place the pair is put together — the form,
 *  the check and the start command all read it. */
export const harnessForModel = (
  work: Work,
  ask: string,
  key: KoluChoiceKey,
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): Option.Option<string> => {
  const { role } = roleOfKey(key);
  const asked = work.decisions.find(
    (one) =>
      one.ask === ask &&
      one.topic === "setup" &&
      Option.contains(setupKeyOf(role, "harness"), one.key) &&
      isAsked(one),
  );
  if (asked !== undefined)
    return Option.flatMap(
      Option.fromUndefinedOr(values.get(asked.id)),
      (sent) => Arr.head(sent),
    );
  return roleAnswer(work, role, "harness");
};

/** WHAT ONE HARNESS OFFERS for a model question on a host: the ids it listed,
 *  or `unlisted` for a harness that has no way to list its models (any model
 *  id the person names is then the answer) — `--models`' own list. */
export type ModelChoices = AgentModelList;

/** WHAT KOLU CAN OFFER for its own setup questions on a work's host, read
 *  live by whoever records or starts an answer: the harnesses this kolu
 *  carries, and — for each harness a model is being judged for — what the
 *  host said it offers. A listing that FAILED is not in here: it is the
 *  caller's refusal, never an empty list. */
export interface KoluChoices {
  readonly harnesses: ReadonlyArray<string>;
  readonly models: ReadonlyMap<string, ModelChoices>;
}

/** WHY A MODEL IS NOT ONE ITS HARNESS OFFERS — none when it is: not in the
 *  list a harness gave, or — for a harness that cannot list — not a model id
 *  at all (upstream's rule: one word, no whitespace), which no launch takes.
 *  The form reads it as the person types, so it says why before the answer
 *  is sent. */
export const modelNotOffered = (
  value: string,
  offered: ModelChoices,
): Option.Option<"not-listed" | "not-a-model-id"> =>
  offered.kind === "listed"
    ? offered.ids.includes(value)
      ? Option.none()
      : Option.some("not-listed")
    : isAgentModelId(value)
      ? Option.none()
      : Option.some("not-a-model-id");

/** THE ONE RULE for an answer to one of kolu's questions — the same where an
 *  answer is recorded, where a saved one is started, and where `work_open`
 *  decides whether a saved one stands. `harness` is the role's harness, for a
 *  model (none when nobody has said). */
const judgeAnswer = (
  key: KoluChoiceKey,
  value: string,
  harness: Option.Option<string>,
  choices: KoluChoices,
): Option.Option<UnofferedAnswer> => {
  if (roleOfKey(key).what === "harness")
    return choices.harnesses.includes(value)
      ? Option.none()
      : Option.some({ key, value, why: "not-installed" });
  // A model of no harness — none answered, or one this kolu does not carry
  // (which its own answer is refused for) — is not a model of anything.
  if (Option.isNone(harness) || !choices.harnesses.includes(harness.value))
    return Option.some({ key, value, why: "no-harness" });
  const offered = choices.models.get(harness.value);
  if (offered === undefined)
    throw new Error(
      `judgeAnswer: no model list for ${harness.value} — the caller must ask the host for every installed harness a model is judged against`,
    );
  return Option.map(
    modelNotOffered(value, offered),
    (why): UnofferedAnswer => ({ key, value, why, harness: harness.value }),
  );
};

/** ONE ANSWER TO ONE OF KOLU'S QUESTIONS, wherever it comes from — the values
 *  sent for it (at least one: a question left blank is no answer and is not
 *  judged), and, for a model, the harness of its role, none when nobody has
 *  said. The rule below reads only this, so an answer from the form, one the
 *  request gave and one the record holds are judged alike. */
export interface KoluAnswer {
  readonly key: KoluChoiceKey;
  readonly values: Arr.NonEmptyReadonlyArray<string>;
  readonly harness: Option.Option<string>;
}

/** The answers to kolu's questions in one ASK, as the form sent them — only
 *  the questions it gave a value for. */
export const askedAnswersOf = (
  work: Work,
  ask: string,
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<KoluAnswer> =>
  work.decisions.flatMap((one) => {
    if (one.ask !== ask || !isAsked(one) || !isKoluChoice(one)) return [];
    return Option.match(
      Option.flatMap(Option.fromUndefinedOr(values.get(one.id)), (sent) => {
        const filled = sent.filter((value) => value !== "");
        return Arr.isReadonlyArrayNonEmpty(filled)
          ? Option.some(filled)
          : Option.none();
      }),
      {
        onNone: () => [],
        onSome: (sent) => [
          {
            key: one.key,
            values: sent,
            harness: harnessForModel(work, ask, one.key, values),
          },
        ],
      },
    );
  });

/** ... the ones the REQUEST gave (`work_open`'s given values), before any
 *  work exists: a model's harness is the one given beside it, else the one
 *  the work (if there is one) already recorded. */
export const givenAnswersOf = (
  given: ReadonlyArray<{ readonly key: KoluChoiceKey; readonly value: string }>,
  before: Option.Option<Work>,
): ReadonlyArray<KoluAnswer> =>
  given.map(({ key, value }) => {
    const { role } = roleOfKey(key);
    const harnessKey = setupKeyOf(role, "harness");
    const beside = given.find((one) => Option.contains(harnessKey, one.key));
    return {
      key,
      values: [value],
      harness:
        beside === undefined
          ? Option.flatMap(before, (work) => roleAnswer(work, role, "harness"))
          : Option.some(beside.value),
    };
  });

/** ... and the SAVED ones to `keys` — what a start rests on, and what
 *  `work_open` re-judges. A key with no answer has none. */
export const savedAnswersOf = (
  work: Work,
  keys: ReadonlyArray<KoluChoiceKey>,
): ReadonlyArray<KoluAnswer> =>
  keys.flatMap((key) =>
    Option.match(setupValue(work, key), {
      onNone: () => [],
      onSome: (value) => [
        {
          key,
          values: [value] as const,
          harness: roleAnswer(work, roleOfKey(key).role, "harness"),
        },
      ],
    }),
  );

/** The harnesses these answers need kolu's model list for — one per model
 *  answered — so the caller asks the host for exactly those. */
export const modelHarnessesOf = (
  answers: ReadonlyArray<KoluAnswer>,
): ReadonlyArray<string> => [
  ...new Set(
    answers.flatMap((one) =>
      roleOfKey(one.key).what === "model" && Option.isSome(one.harness)
        ? [one.harness.value]
        : [],
    ),
  ),
];

/**
 * EVERY ANSWER THAT IS NOT ONE OF KOLU'S OPTIONS — the same rule where an
 * answer is recorded, where a saved one is started, and where `work_open`
 * decides whether a saved one stands.
 *
 *  - A harness must be one this kolu carries.
 *  - A model must be one the host listed for its harness, when that harness
 *    can list; a model id (one word, no spaces) when it cannot.
 *  - A model whose harness nobody has named is not a model of anything.
 *  - One answer each: a role does not run on two harnesses.
 *
 * Answers one fact per bad answer, so the refusal can name them all.
 */
export const unofferedAnswers = (
  answers: ReadonlyArray<KoluAnswer>,
  choices: KoluChoices,
): ReadonlyArray<UnofferedAnswer> =>
  answers.flatMap((one): UnofferedAnswer[] => {
    const [value, ...more] = one.values;
    if (more.length > 0) return [{ key: one.key, value, why: "several" }];
    return Option.match(judgeAnswer(one.key, value, one.harness, choices), {
      onNone: () => [],
      onSome: (judged) => [judged],
    });
  });

/** One answer kolu's rule found that is not kolu's to record or start — and,
 *  where the reason is about what a harness offers, that harness. */
export type UnofferedAnswer =
  | {
      readonly key: KoluChoiceKey;
      readonly value: string;
      readonly why: "several" | "not-installed" | "no-harness";
    }
  | {
      readonly key: KoluChoiceKey;
      readonly value: string;
      readonly why: "not-listed" | "not-a-model-id";
      readonly harness: string;
    };

/** WHY, in words — the clause after the value: «"fable 5.2" is not a model
 *  id …». One spelling for the refusal where an answer is recorded, the
 *  refusal at start, the question `work_open` asks again and the form. */
export const unofferedWhy = (
  bad: UnofferedAnswer,
  harnesses: ReadonlyArray<string>,
  host: string,
): string => {
  switch (bad.why) {
    case "several":
      return "is one of several answers, and a role runs on one";
    case "not-installed":
      return `is not a harness this kolu carries (${harnesses.join(", ") || "it carries none"})`;
    case "no-harness":
      return "is a model of no harness this kolu carries — the role's harness has no answer, or is not installed";
    case "not-listed":
      return `is not a model ${bad.harness} offers on ${host}`;
    case "not-a-model-id":
      return "is not a model id — a model id is one word, with no spaces";
    default:
      return bad satisfies never;
  }
};

/** ... and the whole fact, naming the question: «planner.model: "fable 5.2"
 *  is not a model id …». */
export const unofferedWords = (
  bad: UnofferedAnswer,
  harnesses: ReadonlyArray<string>,
  host: string,
): string =>
  `${bad.key}: ${JSON.stringify(bad.value)} ${unofferedWhy(bad, harnesses, host)}`;

/** A waterfall role's two kolu questions — what starting it rests on. */
export const koluKeysOf = (role: WaterfallRole): ReadonlyArray<KoluChoiceKey> =>
  (["harness", "model"] as const).flatMap((what) =>
    Option.match(Option.filter(setupKeyOf(role, what), isKoluChoiceKey), {
      onNone: () => [],
      onSome: (key) => [key],
    }),
  );

/** WHETHER THIS WORK STILL NEEDS A SETUP KEY — every key until the mode is
 *  answered (the mode decides which the rest are), then the mode and what
 *  that mode runs on ({@link MODE_RUNS}' `needs`). A planner's harness on a
 *  trivial waterfall is not a question anybody needs answered. */
export const needsSetupKey = (work: Work, key: SetupKey): boolean =>
  Option.match(modeOf(work), {
    onNone: () => true,
    onSome: (mode) => key === "mode" || MODE_RUNS[mode].needs.includes(key),
  });

/** THE SETUP KEYS `work_open` ASKS, of the ones it carries: every key the
 *  work still needs ({@link needsSetupKey}) with no value
 *  ({@link setupStanding} — the one reading), and every key whose saved value
 *  kolu no longer offers (`reasked`, judged by the caller against the host).
 *  A work that does not exist yet has no value for any. A key whose question
 *  is already open is asked again, in the new form, and the caller drops the
 *  old one ({@link openSetupQuestions}), so exactly one question per key is
 *  ever in front of the human. */
export const keysToAsk = <K extends SetupKey>(
  work: Option.Option<Work>,
  keys: ReadonlyArray<K>,
  reasked: ReadonlySet<SetupKey>,
): ReadonlyArray<K> =>
  keys.filter(
    (key) =>
      reasked.has(key) ||
      Option.match(work, {
        onNone: () => true,
        onSome: (one) =>
          needsSetupKey(one, key) &&
          setupStanding(one, key).kind !== "answered",
      }),
  );

/** The open questions for these setup keys, by decision id — what a new form
 *  asking the same keys takes the place of. */
export const openSetupQuestions = (
  work: Work,
  keys: ReadonlyArray<SetupKey>,
): ReadonlySet<string> =>
  new Set(
    work.decisions
      .filter(
        (one) =>
          one.kind === "asked" &&
          one.topic === "setup" &&
          keys.includes(one.key),
      )
      .map((one) => one.id),
  );

/** THE OPEN SETUP QUESTIONS NOBODY NEEDS ANY MORE — asked before the mode
 *  was answered, about a role the answered mode does not run. They go away
 *  with the answer that made them moot, so a trivial waterfall is not left
 *  waiting on the human for a planner it will never start. */
export const unneededSetupQuestions = (work: Work): ReadonlySet<string> =>
  new Set(
    work.decisions
      .filter(
        (one) =>
          one.kind === "asked" &&
          one.topic === "setup" &&
          !needsSetupKey(work, one.key),
      )
      .map((one) => one.id),
  );

/** One setup question a role cannot start without, and where it stands —
 *  open in front of the human (the answer will come by itself), or asked of
 *  nobody (only `work_open` puts it). */
export interface StartBlocker {
  readonly key: SetupKey;
  readonly standing:
    | { readonly kind: "open"; readonly ask: string }
    | { readonly kind: "unasked" };
}

/** WHAT STARTING A ROLE WAITS ON — the mode and, when the mode runs that
 *  role, the role's harness and model, each that has no value, read by the
 *  one reading. Empty is "nothing is missing": then the role either runs on
 *  a harness and a model, or the answered mode does not run it at all. */
export const startBlockers = (
  work: Work,
  role: WaterfallRole,
): ReadonlyArray<StartBlocker> =>
  (["mode", ...koluKeysOf(role)] as const)
    .filter((key) => needsSetupKey(work, key))
    .flatMap((key) => {
      const standing = setupStanding(work, key);
      return standing.kind === "answered" ? [] : [{ key, standing }];
    });

/**
 * WHAT A PERSON CHOSE LAST TIME, read off the saved works — never off a
 * conversation's memory, so a new conversation, a restart and another tab all
 * offer the same thing first.
 *
 *  - {@link SetupMemory.last}: the most recent answer to a setup question on
 *    this host. For a model, the most recent model THAT ROLE ran with
 *    `harness` — a person who plans on one model and implements on another
 *    gets each back — and only when the role has none, the most recent model
 *    any role ran with it (a model is a model of its harness).
 *  - {@link SetupMemory.modelsUsed}: every model a person ran `harness` on,
 *    on any host, most recent first — what a harness that cannot list its own
 *    models is offered.
 */
export interface SetupMemory {
  readonly last: (
    key: SetupKey,
    harness: Option.Option<string>,
  ) => Option.Option<string>;
  readonly modelsUsed: (harness: string) => ReadonlyArray<string>;
}

export const setupMemory = (
  works: ReadonlyArray<Work>,
  host: string,
): SetupMemory => {
  /** Every setup answer, with the harness its role ran on in that work. */
  const answers = works
    .flatMap((work) =>
      work.decisions.flatMap((one) => {
        if (
          one.topic !== "setup" ||
          one.kind !== "settled" ||
          one.answer.how !== "answered"
        )
          return [];
        const named = roleOfSetupKey(one.key);
        return [
          {
            host: hostOf(work),
            key: one.key,
            at: one.answer.at,
            value: one.answer.value,
            harness: Option.flatMap(named, ({ role }) =>
              roleAnswer(work, role, "harness"),
            ),
            model: Option.exists(named, ({ what }) => what === "model"),
          },
        ];
      }),
    )
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const sameHarness = (a: Option.Option<string>, b: Option.Option<string>) =>
    Option.makeEquivalence((x: string, y: string) => x === y)(a, b);
  return {
    last: (key, harness) => {
      const here = answers.filter((one) => one.host === host);
      const found = Option.exists(
        roleOfSetupKey(key),
        ({ what }) => what === "model",
      )
        ? (here.find(
            (one) => one.key === key && sameHarness(one.harness, harness),
          ) ??
          here.find((one) => one.model && sameHarness(one.harness, harness)))
        : here.find((one) => one.key === key);
      return Option.map(Option.fromUndefinedOr(found), (one) => one.value);
    },
    // Only what a launch would take: words saved as a model before kolu drew
    // these options are not offered back.
    modelsUsed: (harness) => [
      ...new Set(
        answers
          .filter((one) => one.model && Option.contains(one.harness, harness))
          .map((one) => one.value)
          .filter(isAgentModelId),
      ),
    ],
  };
};

/** What a terminal is, as a member of a work in progress. */
export interface Membership {
  readonly work: string;
  readonly title: string;
  readonly role: WorkRole;
  /** Who types into it — the Conductor while kolu drives it, `you` once the
   *  person has taken it over, `nobody` for a member of a work the Conductor
   *  does not drive (a `watch`, or a mode nobody has answered yet). The mark
   *  and the input guard read this one answer ({@link driverOf}). */
  readonly driver: Driver;
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
      driver: driverOf(work, terminal, Option.some(member)),
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
