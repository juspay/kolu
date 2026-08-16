/**
 * `lifecycle_create` — the MCP face's create tool, completing the verb to
 * `kolu create` parity: spawn a terminal at a STATED `placement` (a tile of its
 * own, or a split inside another), in a fresh git worktree (`repo` +
 * `worktree`), labelled on the canvas (`intent`), and optionally typing a
 * command at its first prompt (`run`).
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
import { PadiCreateInputSchema, PLACEMENT_REQUIRED } from "@kolu/padi/surface";
import { type BespokeTool, messageOf, ToolFailure } from "@kolu/surface-mcp";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import { isValidWorktreeName, WORKTREE_NAME_MESSAGE } from "kolu-git/schemas";
import { isAbsolute } from "node:path";

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
  // Pinned in `create.test.ts` ("the tool schema is the wire's rule, not a copy").
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
  notTyped?: string,
): ToolFailure<CreateRefusal> {
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
  }
  return refuse(lines.join("\n"), {
    kind: "stopped-partway",
    landed,
    ...(notTyped !== undefined ? { notTyped } : {}),
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
}

/** The three world-changing steps as one effect. See the module doc for the
 *  ordering and the partial-failure doctrine. */
const composeCreate = (
  directory: CreateDirectory,
  args: CreateArgs,
  padi: PadiSurfaceClient,
): Effect.Effect<CreateResult, unknown> =>
  Effect.gen(function* () {
    const { cwd: _cwd, repo: _repo, worktree: _wt, run, ...createRest } = args;

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
    // Spread discipline, not `{cwd, …}`: every optional field on the wire is a
    // `Schema.optionalKey`, so an explicit `undefined` is a decode FAILURE, not
    // a default. The key is present or it is not.
    const creating = padi.surface.lifecycle.create({
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
        (error) => stoppedPartway({ id: created.id, worktree }, error, run),
      );
    }

    return {
      id: created.id,
      pid: created.pid,
      ...(worktree !== undefined ? { worktree } : {}),
      ...(run !== undefined ? { ran: run } : {}),
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
    'Open a new terminal and return its id. `placement` is REQUIRED and has no default — say `{"kind":"toplevel"}` for a tile of its own, or `{"kind":"child-of","parentId":"<terminal id>"}` to open it as a split INSIDE that terminal; the canvas and the Dock read that edge as who-works-for-whom, so guessing it flattens the hierarchy. Optionally: in a FRESH GIT WORKTREE (repo + worktree ⇒ cut at <repo>/.worktrees/<name>, terminal opens in it), labelled on the canvas (intent), and typing a command at its first shell prompt (run, submitted with Enter). One call replaces `kolu create --toplevel --repo … --worktree … -- <cmd>`. The terminal always gets the rc-hooked shell; `run` is typed input, not a spawn argv. A failure after the worktree or terminal landed names the survivors in structuredContent (stopped-partway) — nothing is rolled back.',
  handler: (args, client) => {
    const a = args as CreateArgs;
    // Refusals are raised synchronously, BEFORE anything dials padi.
    refuseBlankFields(a);
    const directory = resolveCreateDirectory(a);
    return composeCreate(directory, a, client as PadiSurfaceClient);
  },
};
