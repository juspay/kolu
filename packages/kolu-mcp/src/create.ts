/**
 * `lifecycle_create` — the MCP face's create tool, completing the verb to
 * `kolu create` parity: spawn a terminal at a STATED `placement` (a tile of its
 * own, or a split inside another), in a fresh git worktree (`repo` +
 * `worktree`), labelled on the canvas (`intent`), optionally typing a
 * command at its first prompt (`run`), and — the step that makes the whole call
 * worth making — briefing what that command started (`message`).
 *
 * ## `run` + `message` is the whole spawn-and-dispatch
 *
 * Briefing a fresh worker used to cost about six calls: create, wait for the
 * agent to boot, type the brief, wait for the terminal to settle, send Enter,
 * read the screen to check it took. Five of those are the orchestrator doing, by
 * hand and across a wire, an observation padi can make in-process. `message` is
 * that observation moved: padi waits for the launched agent to reach a prompt,
 * types the brief, waits for the TUI to take it, and presses Enter — inside this
 * one tool call, on the same machinery `lifecycle_sendInput { submit: true }`
 * uses, with one wider quiet window because a booting agent is SILENT before it
 * paints (`FIRST_MESSAGE_SETTLE_MS`).
 *
 * It refuses rather than guessing. A terminal that never settles gets no text
 * typed into it, and the failure names the live terminal so the caller dispatches
 * it rather than creating a second one.
 *
 * ## `placement` is required here for the same reason it is on the CLI
 *
 * The agent calling this tool is exactly the script-shaped caller the no-default
 * rule exists for: it will not notice a placement it never chose, and the canvas
 * and the Dock read a terminal's parent edge as *who works for whom*. So the
 * field is REQUIRED, and the refusal names both spellings —
 * `{"kind":"toplevel"}` and `{"kind":"child-of","parentId":"…"}`.
 *
 * That refusal is the SCHEMA's, not a gate in this file, and deliberately so.
 * `CreateArgsSchema` spreads `PadiCreateInputSchema.fields`, so `placement`
 * arrives as the wire's own required field carrying the wire's own
 * `PLACEMENT_REQUIRED` sentence on both the missing-key and the malformed-value
 * issue. A hand-written check here would be a SECOND copy of a rule the wire
 * already states — free to drift, and unreachable anyway, since `decodeUnknownSync`
 * runs before `handler`. The blank/worktree gates below stay hand-written because
 * they are THIS face's rules, which the wire does not know.
 *
 * Every step is a thin call on `padiSurface` — `git.worktreeCreate`,
 * `lifecycle.create`, `lifecycle.sendInput` — composed exactly the way
 * `kolu create` (kolu-cli's `verbs/create.ts`) and the canvas `useWorktreeOps`
 * compose them, so a worktree'd terminal created over MCP is byte-identical to
 * one created from the CLI or the browser. The worktree lands where the daemon
 * puts every worktree: `<repo>/.worktrees/<name>`, cut host-side by
 * `git.worktreeCreate` (which stays UNEXPOSED as a raw tool — it is composed
 * in here, behind the same directory gates the CLI enforces).
 *
 * The order is worktree → create → sendInput and can't be another: the
 * worktree's `path` is the new terminal's cwd, and the command is INPUT typed
 * at a live shell prompt, never a spawn argv. That last point is the #1872
 * protection the exposed-procedure comment used to carry, intact here: there
 * is still NO `command`/`env` spawn parameter — a terminal created through
 * this face always gets the rc-hooked shell with the daemon's own clean env,
 * and `run` is what you type at it (the CLI's `-- <argv>`, pre-joined).
 *
 * ## The sequence is NOT atomic, so a failure says what already exists
 *
 * The steps each change the world on the far side, and there is no transaction
 * across them: when `lifecycle.create` fails the worktree is already cut on
 * disk, and when `sendInput` fails a terminal is already live on the canvas.
 * A refusal that reported only the error would leave the driving agent owning
 * an orphan terminal and an orphan worktree with no id to act on. So a run
 * that stops after something landed fails with the survivors BY NAME — prose
 * for the model, and the same facts as data in `structuredContent`
 * ({@link CreateRefusal}'s `stopped-partway` arm) so a driver recovers from a
 * tag, not a sentence. Nothing is rolled back, deliberately: killing a
 * terminal the user may want is worse than an orphan they were told about
 * (the CLI's own doctrine). A failure with NOTHING behind it — the worktree
 * itself, or a `lifecycle.create` that had no worktree before it — is not a
 * partway stop at all, and propagates as the daemon's own sentence.
 *
 * ## Refusals, not silent overrides
 *
 * The DIRECTORY gates are the CLI's, refused as data BEFORE any call dials
 * padi: `cwd` XOR `worktree`, `repo` only with `worktree`, and `worktree`
 * REQUIRES an absolute `repo`. (The CANVAS placement is refused a layer
 * earlier, by the shared wire schema — see the section above.) That last rule is where this face is
 * deliberately stricter than the CLI, and the reason is NOT that the padi may
 * be remote: it is that this face has no cwd worth defaulting to at all. The
 * CLI's default is the human's shell directory — an intent they expressed by
 * standing there. `kolu mcp`'s `process.cwd()` is wherever the MCP host
 * happened to spawn the server, which the model never chose and cannot see;
 * defaulting to it would cut a worktree in a directory nobody named. So the
 * path is required rather than guessed (the fail-fast rule: no default masking
 * a missing required value), and a relative one is refused for the same reason
 * — there is no base to resolve it against that the caller meant.
 */

import type { PadiSurfaceClient } from "@kolu/padi/dial";
import {
  FIRST_MESSAGE_SETTLE_MS,
  PadiCreateInputSchema,
  PLACEMENT_REQUIRED,
} from "@kolu/padi/surface";
import { type BespokeTool, messageOf, ToolFailure } from "@kolu/surface-mcp";
import type { SendPlan } from "@kolu/terminal-protocol";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import { isValidWorktreeName, WORKTREE_NAME_MESSAGE } from "kolu-git/schemas";
import { isAbsolute } from "node:path";
// The face's ONE text planner, shared with `lifecycle_sendInput` rather than
// re-spelled: a brief and a plain send must put IDENTICAL bytes on the wire (the
// same paste fold), and a refusal either raises must name the field the caller
// actually spelled, in the same words.
import { planText } from "./sendInput.ts";

export const CreateArgsSchema = Schema.Struct({
  // The verb's existing fields, spread from the wire schema itself so this
  // tool can never drift from what `lifecycle.create` accepts (placement, cwd,
  // intent + the display chrome).
  ...PadiCreateInputSchema.fields,
  // …and `placement` re-stated ON TOP of that spread for one reason: a blurb.
  // The value schema, its `message`, and the `messageMissingKey` the spread
  // carried are all preserved (`.annotate` merges), so this adds the agent-facing
  // sentence to the tool's JSON Schema without forking the rule — the refusal an
  // agent reads and the description it reads are literally the same string.
  // Pinned in `argSchemas.test.ts`, which is where this face's JSON Schema —
  // `describe`d field blurbs and all — is asserted; `create.test.ts` pins the
  // REFUSALS that schema produces.
  placement: PadiCreateInputSchema.fields.placement.annotate({
    description: PLACEMENT_REQUIRED,
  }),
  // Per-field blurbs sit on the encoded-side node INSIDE `optionalKey`, and
  // ANNOTATE-FIRST-CHECK-SECOND where there is a check — otherwise the blurb
  // lands on the check and the converter buries it in `allOf`, where no host
  // reads it (`argSchemas.test.ts` pins both halves).
  repo: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Absolute path (on the machine the padi runs on) of the repository to branch the worktree FROM. Required with `worktree`; a relative path is refused, because this server's working directory is wherever its host spawned it and is not a directory you chose.",
    }),
  ),
  worktree: Schema.optionalKey(
    // The git-ref rule is the WIRE's own (`git.worktreeCreate`'s input), reused
    // rather than restated so this tool cannot advertise a name the daemon
    // would then reject — the browser's create dialog runs the same predicate.
    Schema.String.annotate({
      description:
        "Branch name to cut a fresh git worktree on — the terminal opens IN it, at <repo>/.worktrees/<name>. Requires `repo`; mutually exclusive with `cwd`.",
    }).check(
      Schema.isMinLength(1),
      Schema.makeFilter((s: string) =>
        isValidWorktreeName(s) ? undefined : WORKTREE_NAME_MESSAGE,
      ),
    ),
  ),
  run: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'A command line to TYPE at the new terminal\'s first shell prompt, submitted with Enter (e.g. "claude"). Typed input to the rc-hooked shell — not a spawn argv — exactly `kolu create -- <argv>`. A newline in it submits a line, so a multi-line value runs as several commands.',
    }),
  ),
  message: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "A first message to deliver once the thing `run` launched reaches its prompt — the brief. padi waits for the new terminal to go quiet (a wider window than a normal submit, because a booting agent is silent before it paints), types this, waits again, then presses Enter. With it, ONE call spawns a worker and puts it to work; without it you would create, wait for boot, type, settle, submit, and verify. Refuses rather than typing into a terminal that never settles — the terminal survives and is named.",
    }),
  ),
});
export type CreateArgs = typeof CreateArgsSchema.Type;

/** The worktree this create materialized, as both the answer and the survivor
 *  report spell it — one shape, so the two can't drift. */
interface LandedWorktree {
  readonly path: string;
  readonly branch: string;
}

/** What EXISTS on the far side, accumulated one step at a time. Every field is
 *  optional because every field is a step that may not have run yet: this is
 *  the shape of a run that stopped in the middle. */
interface Landed {
  readonly id?: TerminalId;
  readonly worktree?: LandedWorktree;
}

/** The machine-readable half of every refusal this tool raises, carried in
 *  `ToolFailure.detail` beside the sentence — because a driver's recovery
 *  differs per kind, and reading it out of prose means parsing English:
 *  `blank-field` ⇒ a variable didn't expand, fix the named field;
 *  `cwd-and-worktree` / `repo-without-worktree` / `worktree-needs-repo` /
 *  `relative-repo` ⇒ fix the directory; `stopped-partway` ⇒ real resources
 *  exist — act on `landed` (kill the terminal, remove the worktree) or adopt
 *  them. */
export type CreateRefusal =
  | { readonly kind: "blank-field"; readonly field: string }
  | { readonly kind: "cwd-and-worktree" }
  | { readonly kind: "repo-without-worktree" }
  | { readonly kind: "worktree-needs-repo" }
  | { readonly kind: "relative-repo"; readonly repo: string }
  | {
      readonly kind: "stopped-partway";
      readonly landed: Landed;
      /** The `run` line that was never typed — present only when a terminal
       *  exists and is sitting at a bare prompt because of it. */
      readonly notTyped?: string;
      /** The `message` that was never delivered — present only when the terminal
       *  (and whatever `run` started in it) is live and simply never got the
       *  brief. Distinct from `notTyped`: there the terminal is a bare shell, here
       *  it is a running agent sitting idle with nothing to do. */
      readonly notDelivered?: string;
    };

const refuse = (
  message: string,
  detail: CreateRefusal,
): ToolFailure<CreateRefusal> => new ToolFailure(message, detail);

/** Refuse a field the caller SPELLED with an empty value, before any of them is
 *  read for meaning and long before the dial — the CLI's `refuseBlankFlags`,
 *  in this face's vocabulary. An empty value is not an argument to interpret,
 *  it is a variable that did not expand. `intent` rides here too: the wire
 *  refuses `""` but accepts `"  "`, which reaches the canvas as a blank tile
 *  label. */
export function refuseBlankFields(args: CreateArgs): void {
  for (const [field, value] of [
    ["cwd", args.cwd],
    ["intent", args.intent],
    ["repo", args.repo],
    ["worktree", args.worktree],
    ["run", args.run],
    ["message", args.message],
  ] as const) {
    if (value !== undefined && value.trim() === "") {
      throw refuse(
        `\`${field}\` is blank — a variable that did not expand? Pass a real value or omit the field.`,
        { kind: "blank-field", field },
      );
    }
  }
}

/** WHICH DIRECTORY the new terminal opens in, as one value with two arms — the
 *  CLI's `Directory`, minus the local-cwd default that face can offer and this
 *  one cannot (see the module doc). Distinct from the terminal's `placement`,
 *  which is where it lands on the CANVAS and is the wire's own required field. */
export type CreateDirectory =
  | { readonly kind: "worktree"; readonly repo: string; readonly name: string }
  | { readonly kind: "open"; readonly cwd: string | undefined };

/** Read the directory fields down into the one shape that means something,
 *  refusing every combination that does not — pure, so the gate matrix is
 *  unit-tested apart from the wire. Throws {@link ToolFailure} so a refusal
 *  reaches the agent as an `isError` result whose `structuredContent` names
 *  the rule it broke. */
export function resolveCreateDirectory(args: {
  cwd?: string;
  repo?: string;
  worktree?: string;
}): CreateDirectory {
  if (args.worktree === undefined) {
    if (args.repo !== undefined) {
      throw refuse(
        "`repo` only means something with `worktree` (it names the repo to branch FROM). Add `worktree`, or drop `repo` and pass `cwd` to just open a terminal somewhere.",
        { kind: "repo-without-worktree" },
      );
    }
    return { kind: "open", cwd: args.cwd };
  }
  if (args.cwd !== undefined) {
    throw refuse(
      "`cwd` and `worktree` are mutually exclusive: a worktree create opens the terminal IN the new worktree, so a `cwd` would be ignored. Pass `repo` to say where to branch from.",
      { kind: "cwd-and-worktree" },
    );
  }
  if (args.repo === undefined) {
    throw refuse(
      "`worktree` needs `repo` — an absolute path, on the machine the padi runs on, of the repository to branch from. There is no working directory to default to: this server's own is wherever its host spawned it, not a directory you chose.",
      { kind: "worktree-needs-repo" },
    );
  }
  if (!isAbsolute(args.repo)) {
    throw refuse(
      `\`repo\` must be an absolute path; got \`${args.repo}\`. A relative path would resolve against the padi daemon's working directory — not yours, and not one you can see from here.`,
      { kind: "relative-repo", repo: args.repo },
    );
  }
  return { kind: "worktree", repo: args.repo, name: args.worktree };
}

/** The refusal for a sequence that stopped AFTER earlier steps had landed —
 *  each survivor named in the form the agent can act on, with the removal verb
 *  beside it. See the module doc for why nothing is rolled back. */
function stoppedPartway(
  landed: Landed,
  error: unknown,
  unfinished: { notTyped?: string; notDelivered?: string } = {},
): ToolFailure<CreateRefusal> {
  const { notTyped, notDelivered } = unfinished;
  const lines = [
    messageOf(error),
    "the create stopped PARTWAY — these already exist and were NOT rolled back:",
  ];
  // Creation order, so the list reads as the story of how far it got.
  if (landed.worktree !== undefined) {
    lines.push(
      `  worktree ${landed.worktree.branch} on disk at ${landed.worktree.path} — \`git worktree remove ${landed.worktree.path}\` removes it`,
    );
  }
  if (landed.id !== undefined) {
    lines.push(
      `  terminal ${landed.id} live on the canvas — lifecycle_kill ends it`,
    );
    if (notTyped !== undefined) {
      lines.push(
        `  \`${notTyped}\` was NOT typed — that terminal is sitting at a bare shell prompt`,
      );
    }
    if (notDelivered !== undefined) {
      // The recovery is NOT "call create again": the worker is up and only the
      // brief is missing, so the fix is one `lifecycle_sendInput` at the id
      // above. Saying so here is what stops a driver from spawning a second
      // worker to deliver a message the first one is waiting for.
      lines.push(
        `  the message was NOT delivered — that agent is live and idle; dispatch it with lifecycle_sendInput { id, text, submit: true } rather than creating another`,
      );
    }
  }
  return refuse(lines.join("\n"), {
    kind: "stopped-partway",
    landed,
    ...(notTyped !== undefined ? { notTyped } : {}),
    ...(notDelivered !== undefined ? { notDelivered } : {}),
  });
}

/** What `lifecycle_create` answers: the new terminal's id + pid, the worktree
 *  it materialized, and the command line it typed — absent keys dropped, so
 *  the record reads as exactly what happened. */
export interface CreateResult {
  readonly id: TerminalId;
  readonly pid: number;
  readonly worktree?: LandedWorktree;
  readonly ran?: string;
  /** The first message, present only when one was actually SUBMITTED. A create
   *  that reports `briefed` has put the worker to work; one that does not, has
   *  not — there is no "delivered, probably" reading available. */
  readonly briefed?: string;
}

/** The first message, planned — ONE value carrying both halves the create needs.
 *
 *  The encoded BYTES the wire takes and the raw TEXT a survivors report names are
 *  defined together or not at all, and carrying them as two optionals (a
 *  `SendPlan | undefined` beside `args.message`) made "planned but nameless" a
 *  state the compiler allowed and every reader had to rule out by hand. */
interface Brief {
  readonly text: string;
  readonly plan: SendPlan;
}

/** The four world-changing steps as one effect. See the module doc for the
 *  ordering and the partial-failure doctrine. */
const composeCreate = (
  directory: CreateDirectory,
  args: CreateArgs,
  brief: Brief | undefined,
  padi: PadiSurfaceClient,
): Effect.Effect<CreateResult, unknown> =>
  Effect.gen(function* () {
    // `placement` comes out by NAME rather than riding `...createRest`: it is the
    // one required field on this call, the whole point of the tool's contract,
    // and a reader of the create below should see it stated rather than have to
    // work out that it must be inside the spread. Same shape as `kolu create`'s.
    // `message` is pulled out only to EXCLUDE it from the spread — the create
    // verb does not take one; the planned {@link Brief} is what step 4 delivers.
    const {
      cwd: _cwd,
      repo: _repo,
      worktree: _wt,
      message: _message,
      run,
      placement,
      ...createRest
    } = args;

    // ── Step 1: the worktree (host-side; its `path` is the terminal's cwd) ──
    // Nothing exists yet if this fails, so its error IS the whole truth and
    // propagates unadorned — no survivors to name.
    const worktree =
      directory.kind === "worktree"
        ? yield* padi.surface.git.worktreeCreate({
            repoPath: directory.repo,
            name: directory.name,
          })
        : undefined;
    const cwd =
      worktree?.path ?? (directory.kind === "open" ? directory.cwd : undefined);

    // ── Step 2: the terminal ────────────────────────────────────────────────
    // Spread discipline for the OPTIONAL fields, not `{cwd, …}`: every optional
    // field on the wire is a `Schema.optionalKey`, so an explicit `undefined` is
    // a decode FAILURE, not a default. The key is present or it is not.
    // `placement` is stated flat because it is required — there is no shape of
    // this call that omits it.
    const creating = padi.surface.lifecycle.create({
      placement,
      ...(cwd !== undefined ? { cwd } : {}),
      ...createRest,
    });
    // Only a create that had a worktree BEFORE it can stop partway; a bare
    // create failing has produced nothing, and a survivors report with no
    // survivors would be a false alarm carrying a `kind` whose recovery
    // ("act on what landed") names nothing.
    const created = yield* worktree === undefined
      ? creating
      : Effect.mapError(creating, (error) =>
          stoppedPartway({ worktree }, error),
        );

    // ── Step 3: the command ─────────────────────────────────────────────────
    // PTY input is buffered — the shell reads `<run>\r` at its first prompt
    // once rc init completes (the same latent slow-rc race the CLI and the
    // canvas worktree flow accept). A terminal is live from here on, so this
    // failure too is carried out with the terminal's id.
    if (run !== undefined) {
      yield* Effect.mapError(
        padi.surface.lifecycle.sendInput({
          id: created.id,
          data: `${run}\r`,
        }),
        (error) =>
          stoppedPartway({ id: created.id, worktree }, error, {
            notTyped: run,
          }),
      );
    }

    // ── Step 4: the brief ───────────────────────────────────────────────────
    // The SAME submit machinery `lifecycle_sendInput { submit: true }` uses,
    // with the one parameter a first message needs: a wider quiet window, so a
    // booting agent's silence between exec and first paint is not mistaken for
    // an idle prompt (`FIRST_MESSAGE_SETTLE_MS`). Everything else — the
    // mid-turn refusal, the paste encoding, the Enter — is padi's, unchanged.
    //
    // Encoded through the SHARED send policy rather than written raw: a brief is
    // usually multiline, and it must arrive as one bracketed paste here exactly
    // as it would through `kolu send --file`, or the agent's input box fires a
    // half-written prompt at every newline.
    if (brief !== undefined) {
      yield* Effect.mapError(
        padi.surface.lifecycle.submitInput({
          id: created.id,
          data: brief.plan.write,
          settleMs: FIRST_MESSAGE_SETTLE_MS,
        }),
        (error) =>
          stoppedPartway({ id: created.id, worktree }, error, {
            notDelivered: brief.text,
          }),
      );
    }

    return {
      id: created.id,
      pid: created.pid,
      ...(worktree !== undefined ? { worktree } : {}),
      ...(run !== undefined ? { ran: run } : {}),
      ...(brief !== undefined ? { briefed: brief.text } : {}),
    };
  });

/** The bespoke tool — same wire name as the exposed procedure it supersedes, so
 *  a driver that knew `lifecycle_create` before this face grew worktrees calls
 *  it unchanged (every old argument shape still lands on the same verb). */
export const createTool: BespokeTool = {
  input: CreateArgsSchema,
  mutates: true,
  title: "Create a terminal",
  description:
    'Open a new terminal and return its id. `placement` is REQUIRED and has no default — say `{"kind":"toplevel"}` for a tile of its own, or `{"kind":"child-of","parentId":"<terminal id>"}` to open it as a split INSIDE that terminal; the canvas and the Dock read that edge as who-works-for-whom, so guessing it flattens the hierarchy. Optionally: in a FRESH GIT WORKTREE (repo + worktree ⇒ cut at <repo>/.worktrees/<name>, terminal opens in it), labelled on the canvas (intent), typing a command at its first shell prompt (run, submitted with Enter), and — the way to BRIEF a worker — `message`, a first prompt padi delivers once that command reaches its prompt. run + message is the whole spawn-and-dispatch in ONE call: no boot wait, no separate send, no verify. The terminal always gets the rc-hooked shell; `run` is typed input, not a spawn argv. A failure after the worktree or terminal landed names the survivors in structuredContent (stopped-partway) — nothing is rolled back, and an undelivered `message` means a live idle agent to dispatch, not a create to repeat.',
  handler: (args, client) => {
    const a = args as CreateArgs;
    // Refusals are raised synchronously, BEFORE anything dials padi — and the
    // brief's BYTES are planned here for the same reason: the paste fold is pure,
    // so a payload this create would refuse never costs a worktree and a live
    // terminal it would then have to be reported beside.
    refuseBlankFields(a);
    const directory = resolveCreateDirectory(a);
    const brief =
      a.message === undefined
        ? undefined
        : { text: a.message, plan: planText(a.message, "message") };
    return composeCreate(directory, a, brief, client as PadiSurfaceClient);
  },
};
