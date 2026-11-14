/**
 * THE PIECES AROUND A PIECE OF WORK that are pure: what a call about a work is
 * REFUSED for, what the setup of a mode must carry, and how a set of questions
 * becomes the one form a person answers.
 *
 * `kolu-work` owns the record and every transition over it; `./conductor.ts`
 * owns the live host that applies them. What is here is the middle neither
 * wants: the Conductor's intent arriving from an MCP tool, checked before
 * anything is created, and turned into the elicitation-shaped form the harness
 * already knows how to draw.
 *
 * The I/O PORT for a work's files is declared here too and implemented by
 * kolu-server: listing a directory on another host and copying it back is the
 * most volatile thing about a work (a daemon protocol, a chunked read, a state
 * root) and the least related to what a work IS.
 */

import type { AskChoice, AskField } from "@kolu/acp/wire";
import type { Form } from "@kolu/acp";
import type { WORK_REFUSALS } from "kolu-mcp/workRefusal";
import {
  type KeptFile,
  type Question,
  type SetupKey,
  ON_GREEN,
  WORK_MODES,
} from "kolu-work";

/** Why a call about a work was refused — the one tuple both this package and
 *  the fleet face build from (`kolu-mcp/workRefusal`). */
export type WorkRefusalKind = (typeof WORK_REFUSALS)[number];

/**
 * A CALL ABOUT A WORK, REFUSED — and the Conductor told exactly what to fix.
 *
 * An Error subclass rather than a declared wire error: the fleet face is the
 * only caller, and it turns this into the `ToolFailure` an agent reads. `kind`
 * is what a face branches on; `why` is the whole sentence it shows, because a
 * refusal an agent cannot act on costs the same turn as silence.
 */
export class WorkRefusal extends Error {
  readonly kind: WorkRefusalKind;
  readonly why: string;
  constructor(kind: WorkRefusalKind, why: string) {
    super(why);
    this.name = "WorkRefusal";
    this.kind = kind;
    this.why = why;
  }
}

/** The setup keys a mode's work cannot run without.
 *
 *  `host` and `mode` ALWAYS: nothing can be created before the machine is
 *  known, and the mode decides the rest. A waterfall mode (`full`/`trivial`)
 *  needs the implementor's harness and model and what to do when CI is green;
 *  `full` needs the planner's two as well. A plain `watch` needs neither — the
 *  terminal it adopts is already running whatever it runs. */
const NEEDED_FOR_MODE: Readonly<Record<string, ReadonlyArray<SetupKey>>> = {
  full: [
    "implementor.harness",
    "implementor.model",
    "on-green",
    "planner.harness",
    "planner.model",
  ],
  trivial: ["implementor.harness", "implementor.model", "on-green"],
  watch: [],
};

/** One setup question as `work_open` carries it. */
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
 * The mode is read off the setup itself, from whatever the mode question could
 * come to: the answer it was GIVEN, or any option it offers. A mode question
 * that offers `full` means this work may turn out to be a full waterfall, so
 * the planner's two questions have to be in the same form — asking them later
 * is the second form this whole shape exists to remove, and a work whose
 * planner was launched on a model nobody chose is the defect behind it.
 *
 * Answers the keys that are missing, in the order they are needed, so the
 * refusal can name all of them at once rather than one per round trip.
 */
export const missingSetup = (
  setup: ReadonlyArray<SetupAsk>,
): ReadonlyArray<SetupKey> => {
  const asked = new Set(setup.map((one) => one.key));
  const modes = new Set<string>();
  for (const one of setup) {
    if (one.key !== "mode") continue;
    for (const option of one.options) modes.add(option);
    if (one.given !== undefined) modes.add(one.given);
  }
  const needed: SetupKey[] = ["host", "mode"];
  for (const mode of WORK_MODES) {
    if (!modes.has(mode)) continue;
    for (const key of NEEDED_FOR_MODE[mode] ?? [])
      if (!needed.includes(key)) needed.push(key);
  }
  return needed.filter((key) => !asked.has(key));
};

/** THE TWO QUESTIONS WHOSE ANSWERS ARE A VOCABULARY, and every word offered
 *  for them that is not one.
 *
 *  `modeOf` and `onGreenOf` read a decision only when the answer is one of
 *  their words (`WORK_MODES`, `ON_GREEN`), so a `mode` question offering "the
 *  full thing" would be asked, answered, stored — and then read as NOTHING: a
 *  work with no mode and nobody able to say why. The fleet face's decoder
 *  refuses those options already; this is the backstop behind it, and the one
 *  place the sentence a caller acts on is written.
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

/** The suffix of the free-text field attached to a question — the "or say it
 *  in your own words" box beside the options.
 *
 *  Derived from the decision's own id so the two keys travel together and the
 *  answer can be read back without a second map. `~` because a decision id is
 *  a uuid and never contains one. */
export const otherKey = (decision: string): string => `${decision}~other`;

/**
 * THE FORM a set of questions is put as — one field per question, each with
 * its own "other" box attached.
 *
 * Shaped exactly like an agent's elicitation, because it IS one as far as
 * everything downstream is concerned: the row is drawn by the same component,
 * answered by the same procedure, and settled by the same registry. What makes
 * it kolu's is that the row names the work (`Harness.askPerson`).
 *
 * Every question is OPTIONAL (`required: false`). A person answering from the
 * card may answer the one question they came for and leave the rest; a
 * required field would refuse that answer at the harness and leave the row up
 * with nothing said about why.
 */
export const askForm = (
  message: string,
  questions: ReadonlyArray<Question>,
): Form => {
  const fields: AskField[] = [];
  for (const one of questions) {
    const choices: AskChoice[] = one.options.map((option) => ({
      value: option,
      label: option,
      hint: null,
    }));
    fields.push({
      key: one.id,
      label: one.question,
      hint: null,
      kind: one.multiple ? "choices" : "choice",
      choices,
      required: false,
      attachedTo: null,
    });
    fields.push({
      key: otherKey(one.id),
      label: "or say it in your own words",
      hint: null,
      kind: "text",
      choices: [],
      required: false,
      attachedTo: one.id,
    });
  }
  // A question kolu asked is not a tool call and names no place to go: both are
  // facts about the form rather than fields somebody forgot.
  return { message, fields, toolCall: null, link: null };
};

/** What the human answered one question, as the values `answerAsk` splits into
 *  picks and typed text: whatever they chose, plus whatever they typed in the
 *  box beside it. A question they left alone answers with nothing, which is
 *  what the record then says about it. */
export const pickedValues = (
  content: Readonly<Record<string, string | number | boolean | Array<string>>>,
  decision: string,
): ReadonlyArray<string> => [
  ...valuesAt(content[decision]),
  ...valuesAt(content[otherKey(decision)]),
];

const valuesAt = (
  value: string | number | boolean | Array<string> | undefined,
): ReadonlyArray<string> => {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((one) => one !== "");
  const said = String(value);
  return said === "" ? [] : [said];
};

/**
 * THE FILES OF A PIECE OF WORK, as the host reaches them — listed where the
 * work is happening, and copied into kolu when it ends.
 *
 * A PORT, implemented by kolu-server over the padi client of the host the
 * member terminal is on. Everything about it is volatile in a way the record is
 * not: which daemon answers, how a remote file is read back, where this
 * machine's state root is. What the work holds is a list of paths and, at the
 * end, how many bytes of each were kept.
 */
export interface WorkFiles {
  /** Worktree-relative paths (".waterfall/plan.md") of the files directly in
   *  `<worktree>/.waterfall/` on `host`; `[]` when the directory is absent.
   *  Rejects (with a sentence) when the host cannot be read. */
  list(at: { host: string; worktree: string }): Promise<ReadonlyArray<string>>;
  /** Copy those files into `<stateRoot>/works/<work>/<path>` on THIS machine,
   *  fetched through the host daemon's existing file read; answers what
   *  landed. */
  keep(at: {
    host: string;
    worktree: string;
    work: string;
    paths: ReadonlyArray<string>;
  }): Promise<ReadonlyArray<KeptFile>>;
  /** RECONCILE the kept files to the works kolu still has: delete every
   *  `<stateRoot>/works/<id>` directory whose id is not in `keep`.
   *
   *  One rule rather than "delete this work's files", because the set of works
   *  can shrink in two ways — the history cap drops the oldest finished one,
   *  and a restored backup replaces the lot — and a per-work delete leaves the
   *  second one's orphans on disk for ever. A missing root is nothing to do. */
  sweep(keep: ReadonlyArray<string>): Promise<void>;
}
