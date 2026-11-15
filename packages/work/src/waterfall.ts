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

import { isAgentModelId } from "@kolu/agent-distro/models";
import { type Policy, type Waiter, waitingOn } from "./folds.ts";
import { answerValue } from "./readings.ts";
import {
  type Decision,
  hostOf,
  isAnswered,
  isAsked,
  isKoluChoice,
  isKoluChoiceKey,
  type KoluChoiceKey,
  ON_GREEN,
  type OfferedSetupKey,
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
 *  below read, stated before any work exists. The questions kolu draws the
 *  options for ({@link KOLU_CHOICE_KEYS}) are NAMED, with what the request
 *  already said: no options and no words, which are kolu's. */
export type SetupAsk =
  | {
      readonly key: OfferedSetupKey;
      readonly question: string;
      readonly options: ReadonlyArray<string>;
      readonly given?: string | undefined;
    }
  | {
      readonly key: KoluChoiceKey;
      readonly given?: string | undefined;
    };

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
    if (!("options" in one)) continue;
    const vocabulary: ReadonlyArray<string> =
      one.key === "mode" ? WORK_MODES : ON_GREEN;
    for (const word of [
      ...one.options,
      ...(one.given === undefined ? [] : [one.given]),
    ])
      if (!vocabulary.includes(word) && !foreign.includes(word))
        foreign.push(`${one.key}: ${JSON.stringify(word)}`);
  }
  return foreign;
};

/** The role a setup key is about, and which of its two it names — `null` for
 *  `mode` and `on-green`, which are about the whole work. */
export const roleOfKey = (
  key: SetupKey,
): { readonly role: WorkRole; readonly what: "harness" | "model" } | null => {
  for (const role of WORK_ROLES)
    for (const what of ["harness", "model"] as const)
      if (setupKeyOf(role, what) === key) return { role, what };
  return null;
};

/** THE HARNESS A MODEL QUESTION IS FOR, as this answer leaves it: the one the
 *  same form is answering for that role, else the one the work already
 *  recorded, else `null` (nobody has said yet). A model is only ever a model
 *  OF a harness, so this is the one place the pair is put together — the
 *  form, the check and the start command all read it. */
export const harnessForModel = (
  work: Work,
  ask: string,
  key: KoluChoiceKey,
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): string | null => {
  const named = roleOfKey(key);
  if (named === null) return null;
  const harnessKey = setupKeyOf(named.role, "harness");
  const asked = work.decisions.find(
    (one) => one.ask === ask && one.key === harnessKey && isAsked(one),
  );
  if (asked !== undefined) return values.get(asked.id)?.[0] ?? null;
  return roleAnswer(work, named.role, "harness");
};

/** WHAT ONE HARNESS OFFERS for a model question on a host: the ids it listed,
 *  or `unlisted` for a harness that has no way to list its models (any model
 *  id the person names is then the answer). */
export type ModelChoices =
  | { readonly kind: "listed"; readonly ids: ReadonlyArray<string> }
  | { readonly kind: "unlisted" };

/** WHAT KOLU CAN OFFER for its own setup questions on a work's host, read
 *  live by whoever records or starts an answer: the harnesses this kolu
 *  carries, and — for each harness a model is being judged for — what the
 *  host said it offers. A listing that FAILED is not in here: it is the
 *  caller's refusal, never an empty list. */
export interface KoluChoices {
  readonly harnesses: ReadonlyArray<string>;
  readonly models: ReadonlyMap<string, ModelChoices>;
}

/** WHY A MODEL IS NOT ONE ITS HARNESS OFFERS, or `null` when it is: not in
 *  the list a harness gave, or — for a harness that cannot list — not a
 *  model id at all (upstream's rule: one word, no whitespace), which no launch
 *  takes. The form reads it as the person types, so it says why before the
 *  answer is sent. */
export const modelNotOffered = (
  value: string,
  offered: ModelChoices,
): "not-listed" | "not-a-model-id" | null =>
  offered.kind === "listed"
    ? offered.ids.includes(value)
      ? null
      : "not-listed"
    : isAgentModelId(value)
      ? null
      : "not-a-model-id";

/** THE ONE RULE for an answer to one of kolu's questions — the same where an
 *  answer is recorded, where a saved one is started, and where `work_open`
 *  decides whether a saved one stands. `harness` is the role's harness, for a
 *  model (`null` when nobody has said). */
const judgeAnswer = (
  key: KoluChoiceKey,
  value: string,
  harness: string | null,
  choices: KoluChoices,
): UnofferedAnswer | null => {
  if (roleOfKey(key)?.what === "harness")
    return choices.harnesses.includes(value)
      ? null
      : { key, value, why: "not-installed" };
  // A model of no harness — none answered, or one this kolu does not carry
  // (which its own answer is refused for) — is not a model of anything.
  if (harness === null || !choices.harnesses.includes(harness))
    return { key, value, why: "no-harness" };
  const offered = choices.models.get(harness);
  if (offered === undefined)
    throw new Error(
      `judgeAnswer: no model list for ${harness} — the caller must ask the host for every installed harness a model is judged against`,
    );
  const why = modelNotOffered(value, offered);
  return why === null ? null : { key, value, why, harness };
};

/** The harnesses this answer needs kolu's model list for — one per model
 *  question it answers — so the recorder asks the host for exactly those. */
export const modelHarnessesOf = (
  work: Work,
  ask: string,
  values: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<string> => {
  const harnesses = new Set<string>();
  for (const one of work.decisions) {
    if (one.ask !== ask || !isAsked(one) || !isKoluChoice(one)) continue;
    if (roleOfKey(one.key)?.what !== "model") continue;
    if ((values.get(one.id) ?? []).length === 0) continue;
    const harness = harnessForModel(work, ask, one.key, values);
    if (harness !== null) harnesses.add(harness);
  }
  return [...harnesses];
};

/**
 * EVERY ANSWER IN THIS ASK THAT IS NOT ONE OF KOLU'S OPTIONS — checked where
 * an answer is recorded, before it is.
 *
 *  - A harness must be one this kolu carries.
 *  - A model must be one the host listed for its harness, when that harness
 *    can list; a model id (one word, no spaces) when it cannot.
 *  - A model whose harness nobody has named is not a model of anything.
 *  - One answer each: a role does not run on two harnesses.
 *
 * A question left blank is not checked: the record says exactly that about it.
 * Answers one fact per bad answer, so the refusal can name them all.
 */
export const unofferedAnswers = (
  work: Work,
  ask: string,
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  choices: KoluChoices,
): ReadonlyArray<UnofferedAnswer> => {
  const bad: UnofferedAnswer[] = [];
  for (const one of work.decisions) {
    if (one.ask !== ask || !isAsked(one) || !isKoluChoice(one)) continue;
    const given = values.get(one.id) ?? [];
    if (given.length === 0) continue;
    const [value = ""] = given;
    if (given.length > 1) {
      bad.push({ key: one.key, value, why: "several" });
      continue;
    }
    const judged = judgeAnswer(
      one.key,
      value,
      harnessForModel(work, ask, one.key, values),
      choices,
    );
    if (judged !== null) bad.push(judged);
  }
  return bad;
};

/** One answer kolu's rule found that is not kolu's to record or start. */
export interface UnofferedAnswer {
  readonly key: KoluChoiceKey;
  readonly value: string;
  readonly why:
    | "several"
    | "not-installed"
    | "no-harness"
    | "not-listed"
    | "not-a-model-id";
  /** The harness the model was judged against (`not-listed`,
   *  `not-a-model-id`). */
  readonly harness?: string;
}

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
      return `is not a model ${bad.harness ?? "its harness"} offers on ${host}`;
    case "not-a-model-id":
      return "is not a model id — a model id is one word, with no spaces";
    default:
      return bad.why satisfies never;
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

/** The installed harnesses whose model lists the SAVED answers to `keys`
 *  need — so the caller asks the host for exactly those. */
export const savedModelHarnessesOf = (
  work: Work,
  keys: ReadonlyArray<KoluChoiceKey>,
  installed: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const harnesses = new Set<string>();
  for (const key of keys) {
    const named = roleOfKey(key);
    if (named?.what !== "model") continue;
    if (answerValue(setupDecision(work, key)) === null) continue;
    const harness = roleAnswer(work, named.role, "harness");
    if (harness !== null && installed.includes(harness)) harnesses.add(harness);
  }
  return [...harnesses];
};

/**
 * EVERY SAVED ANSWER TO `keys` THAT KOLU NO LONGER OFFERS — by the same rule
 * an answer is recorded by, read again later: when a planner or implementor
 * is started, and when `work_open` decides what to ask. An answer saved
 * before kolu drew these options (words typed as a model), a model that left
 * its harness's list, a harness this kolu stopped carrying: each is named here
 * rather than typed into a terminal. A key with no answer is not judged.
 */
export const unofferedSaved = (
  work: Work,
  keys: ReadonlyArray<KoluChoiceKey>,
  choices: KoluChoices,
): ReadonlyArray<UnofferedAnswer> =>
  keys.flatMap((key) => {
    const value = answerValue(setupDecision(work, key));
    const named = roleOfKey(key);
    if (value === null || named === null) return [];
    const judged = judgeAnswer(
      key,
      value,
      named.what === "model" ? roleAnswer(work, named.role, "harness") : null,
      choices,
    );
    return judged === null ? [] : [judged];
  });

/** A waterfall role's two kolu questions — what starting it rests on. */
export const koluKeysOf = (role: WorkRole): ReadonlyArray<KoluChoiceKey> =>
  (["harness", "model"] as const).flatMap((what) => {
    const key = setupKeyOf(role, what);
    return key !== null && isKoluChoiceKey(key) ? [key] : [];
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
  readonly last: (key: SetupKey, harness: string | null) => string | null;
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
        if (one.key === null || !isAnswered(one)) return [];
        const value = answerValue(one);
        if (value === null) return [];
        const named = roleOfKey(one.key);
        return [
          {
            host: hostOf(work),
            key: one.key,
            at: one.answer.at,
            value,
            harness:
              named === null ? null : roleAnswer(work, named.role, "harness"),
            model: named?.what === "model",
          },
        ];
      }),
    )
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    last: (key, harness) => {
      const here = answers.filter((one) => one.host === host);
      if (roleOfKey(key)?.what !== "model")
        return here.find((one) => one.key === key)?.value ?? null;
      return (
        (
          here.find((one) => one.key === key && one.harness === harness) ??
          here.find((one) => one.model && one.harness === harness)
        )?.value ?? null
      );
    },
    // Only what a launch would take: words saved as a model before kolu drew
    // these options are not offered back.
    modelsUsed: (harness) => [
      ...new Set(
        answers
          .filter((one) => one.model && one.harness === harness)
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
