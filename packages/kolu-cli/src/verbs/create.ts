/**
 * `kolu create` — spawn a terminal on the padi we dialed: a tile of its own
 * (`--toplevel`) or a split of another (`--parent <id>`), in a fresh git
 * worktree (`--worktree`), labelled on the canvas (`--intent`), and optionally
 * running an agent in it (`-- <argv>`).
 *
 * ## Placement is required, and that is the interesting part
 *
 * Exactly one of `--toplevel` / `--parent <id>` — neither and both are refusals
 * ({@link placementOf}), and there is no default. A terminal's parent edge is
 * not decoration: the canvas nests a split inside its parent's tile and the
 * Dock reads the same edge as *who works for whom*. This CLI's audience is
 * scripts and agent loops, which is precisely the caller that does not notice a
 * default it never chose — an orchestrator once spawned two days of reviewer
 * agents as top-level tiles when every one of them was a split, and nothing
 * failed, the hierarchy just went flat. So the one thing only the caller knows
 * is the one thing they must say.
 *
 * Every step is a thin call on `padiSurface` — `git.worktreeCreate`,
 * `lifecycle.create`, `lifecycle.sendInput` — composed exactly the way the
 * canvas `useWorktreeOps` composes them, so a worktree'd agent created from the
 * CLI is byte-identical to one created from the browser (both land as canvas
 * tiles, both are owned by padi, both survive this process). This is the
 * composition padi-tui's `create.ts` carried; it moved here whole when `kolu`
 * became the ONE terminal CLI, gaining `--intent` (the freeform label the canvas
 * shows) — which the wire has accepted since the base create input was defined,
 * so it costs a field, not a contract change.
 *
 * ## Why the order is worktree → create → sendInput, and why it can't be another
 *
 * The worktree is cut FIRST because `git.worktreeCreate` runs HOST-side and its
 * `path` is the new terminal's cwd: creating the terminal first would open it
 * somewhere it must then be told to leave. The argv is written LAST, as input to
 * a live PTY, because padi runs its own shell-init spawn policy — a terminal is
 * a shell, and the agent is what you type at its first prompt, not an argv the
 * daemon execs.
 *
 * ## The sequence is NOT atomic, so a failure says what already exists
 *
 * Those three steps each change the world on the far side, and there is no
 * transaction across them: when `lifecycle.create` fails the worktree is already
 * cut on disk, and when `sendInput` fails a terminal is already LIVE on the
 * canvas. A failure that reported only the error would tell the user — or the
 * driving loop above them — that the command failed, from which the only
 * reasonable conclusion is that nothing happened. They would then own an orphan
 * terminal and an orphan worktree with no id to act on.
 *
 * So a run that stops partway reports the survivors BY NAME ({@link
 * stoppedPartway}): the terminal in the short `kolu kill` form, the worktree by
 * branch and path, each with the command that removes it. Only this layer knows
 * what it already created, so only this layer can say so.
 *
 * It does NOT roll them back. Killing a terminal the user may well want — an
 * agent that is already running, a worktree with their branch in it — is a worse
 * outcome than an orphan they were TOLD about, and an automatic rollback is
 * itself a second non-atomic sequence that can fail halfway. And it does not
 * downgrade the failure: the verb still exits non-zero, because the thing that
 * was asked for did not happen.
 *
 * ## Output discipline
 *
 * stdout is the DATA: exactly the new full id and nothing else, so
 * `id=$(kolu create --toplevel)` is the whole scripting story. The human trailer — what was
 * created, what it split, which worktree, which command — goes to stderr, where
 * a pipe never sees it. `--json` replaces the stdout line with the full record
 * (`{id, worktree?, ran?}`) and drops the trailer, since a JSON consumer reads
 * the fields rather than the prose. A run that stopped partway writes the SAME
 * payload for whatever exists — see {@link emitHandles} for why.
 *
 * ## Refusals, not silent overrides
 *
 * The gates fail loud rather than degrading, in this repo's house style
 * (`endpoint.ts`'s `refuseEndpointFlags` is the same idea one layer up): a flag
 * the user spelled and we would have ignored is a defect, not a convenience.
 * The three that decide WHICH DIRECTORY the terminal opens in are folded into
 * one parse ({@link directoryOf}) whose result makes the illegal combinations
 * unspellable, and the two that decide WHERE ON THE CANVAS it lands into
 * another ({@link placementOf}); the rest are PURE checks before the dial, so a
 * typo never provisions a cold ssh host, except the one co-location fact that
 * needs the transport and is checked just after it.
 */

import { type TerminalPlacement, TOPLEVEL_PLACEMENT } from "@kolu/padi/surface";
import {
  PLACEMENT_FLAGS_EXCLUSIVE,
  placementRequiredMessage,
  shortId,
} from "@kolu/padi/render";
import { shellJoin } from "@kolu/shell-quote";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { createFlags } from "../cli.ts";
import { type Endpoint, localCwdOf, withPadi } from "../endpoint.ts";
import {
  blankFlag,
  type CliFailure,
  failure,
  isBlank,
  reportOf,
} from "../exit.ts";
import { resolveTerminal, writeErr, writeJson, writeOut } from "./shared.ts";

/** What the command tree parses for `kolu create` — DERIVED from `createFlags`
 *  in `cli.ts`, where the optional flags are already projected to `undefined`.
 *  That projection matters twice over here: the wire below distinguishes an
 *  ABSENT key from an explicit `undefined` (every optional field on
 *  `PadiCreateInputSchema` is a `Schema.optionalKey`, so passing
 *  `{cwd: undefined}` is a decode FAILURE, not a default), and the spread
 *  discipline that honors it reads a plain `string | undefined`. */
export type CreateArgs = Command.Command.Config.Infer<typeof createFlags>;

/** What EXISTS on the far side, accumulated one step at a time.
 *
 *  Every field is optional because every field is a step that may not have run
 *  yet: this is the shape of a run that stopped in the middle, and {@link
 *  CreateResult} is the same shape once the terminal is proven to exist. One
 *  shape for both means `--json` prints the truth on either path without a
 *  second record to keep in sync. */
interface Landed {
  readonly id?: TerminalId;
  readonly worktree?: { readonly path: string; readonly branch: string };
  readonly ran?: string;
}

/** What `create` did — the new terminal's full id, the worktree it materialized
 *  (`--worktree`), and the command line it typed (`-- <argv>`). The `--json`
 *  payload verbatim: `JSON.stringify` drops the absent keys, so the two shapes
 *  can't drift. */
interface CreateResult extends Landed {
  readonly id: TerminalId;
}

/** How the run ended, as data — because the reporting below is the SAME work in
 *  both cases (write the handles that exist, then say what happened), and only
 *  the last line differs. Carrying the failure as a value rather than throwing
 *  it up the stack is what lets the partial state reach the user at all. */
type Outcome =
  | {
      readonly kind: "created";
      readonly result: CreateResult;
      /** The placement the run STATED, kept whole rather than reduced to a
       *  `parentId | undefined`: the trailer says "split of X" off the same
       *  value the wire was handed, so the sentence can't disagree with the
       *  request. */
      readonly placement: TerminalPlacement;
    }
  | Stopped;

/** The run stopped after earlier steps had already changed the world. */
type Stopped = {
  readonly kind: "stopped";
  readonly landed: Landed;
  readonly error: unknown;
};

/** Run one world-changing step, or STOP carrying what already exists.
 *
 *  Steps 2 and 3 tell the same three-line story — call, and if it failed carry
 *  the failure OUT as a value beside a snapshot of what landed — differing only
 *  in the snapshot. Written twice inline, the second copy was one careless edit
 *  away from reporting the first copy's survivors, in the exact block whose
 *  whole purpose is to name them correctly.
 *
 *  The stopped outcome rides the ERROR channel just far enough to short-circuit
 *  the rest of the sequence, and {@link run} catches it back into a value at the
 *  dial boundary. It is the same `Stopped` the reporting reads, not a second
 *  spelling of it: one shape, raised in one place, read in one place. */
const orStopped = <A, E, R>(
  step: Effect.Effect<A, E, R>,
  landed: Landed,
): Effect.Effect<A, Stopped, R> =>
  Effect.mapError(step, (error) => ({ kind: "stopped", landed, error }));

/** Is this the carried outcome rather than a genuine failure? Nothing else on
 *  that error channel is a `{kind: "stopped"}` — the CLI's own failures are
 *  `_tag`ged and padi's are schema-derived — so the discrimination is exact. */
const isStopped = (error: unknown): error is Stopped =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly kind?: unknown }).kind === "stopped";

/** The one `--worktree over --host needs --repo` message. A remote `--worktree`
 *  cannot default to the padi's cwd for the reason that makes the whole flag
 *  work: the worktree is cut on the REMOTE machine by `git.worktreeCreate`, so a
 *  local path would name a repo on the wrong host. */
const WORKTREE_OVER_HOST_NEEDS_REPO =
  "--worktree over --host needs --repo <path on the host>: the worktree is cut on the REMOTE machine, so it can't default to your local directory. Pass --repo with an absolute path on the host.";

// stdout/stderr are `./shared.ts`'s. The draining sink matters even for one
// short line: `process.stdout` is ASYNCHRONOUS when it is a pipe, and the run
// edge exits the moment this effect completes, so a write that had not drained
// would truncate `id=$(kolu create --toplevel)` to nothing. A hung-up consumer
// (`kolu create --toplevel | head -1`) is a complete run — the terminal exists either way.

/** WHICH DIRECTORY the new terminal opens in, as ONE value with two arms.
 *
 *  Distinct from its PLACEMENT ({@link placementOf}), which is where it lands on
 *  the canvas — one word for one thing, since this file now parses both. A
 *  worktree'd split and a top-level terminal in `~` are independent choices.
 *
 *  `--cwd`, `--repo` and `--worktree` reach us as three independent `Option`s —
 *  a flat product of eight combinations, five of which are nonsense — so they
 *  are read down ONCE, here, into the two shapes that mean something. Past this
 *  function `--cwd` does not exist in worktree mode and `--repo` does not exist
 *  outside it: the combinations that used to be refused by arm-ordered runtime
 *  guards further down are now unspellable in the type, and the guards are gone
 *  rather than merely relocated. The refusal sentences are unchanged — the same
 *  three a user could hit before. */
type Directory =
  | {
      readonly kind: "worktree";
      readonly name: string;
      /** The repo to branch FROM, already resolved: `--repo` if it was given,
       *  else the padi's own cwd — which only has an answer when that padi
       *  shares our filesystem. A `string`, never `undefined`, because the one
       *  case where there is no answer (a remote `--worktree` with no `--repo`)
       *  is refused while building this value. Carrying the resolution in the
       *  TYPE is what leaves the invariant with one home: it used to be checked
       *  at two altitudes — once against the endpoint before the dial, once
       *  transport-blind after it — and the second check could never fire. */
      readonly repo: string;
    }
  | { readonly kind: "open"; readonly cwd: string | undefined };

/** Refuse a flag the user SPELLED with an empty value, before any of them is
 *  read for meaning and long before the dial.
 *
 *  This is `endpointOf`'s blank-endpoint refusal one layer down, over the flags
 *  that name something on the PADI's side, and it shares that gate's `isBlank`
 *  rule. Without it `--worktree "$NAME"` with `$NAME` unset reached
 *  `git.worktreeCreate` as a worktree named `""`, and `--cwd ""` was forwarded
 *  to `lifecycle.create` as an EXPLICIT cwd — each failing late with a sentence
 *  about a path, or worse landing somewhere nonsensical, when all that happened
 *  is that a variable was empty. `--parent ""` already failed
 *  (`resolveTerminalId` refuses an empty query), but only AFTER the dial, so it
 *  joins the others here rather than staying the one that is nearly right.
 *
 *  One table, in `cli.ts`'s declaration order, each row carrying the noun phrase
 *  its refusal reads with. The FIRST blank flag is named rather than all of them
 *  joined (`endpointOf`'s shape): the phrases are per-flag, and a pure pre-dial
 *  refusal costs nothing to hit twice. */
function refuseBlankFlags(args: CreateArgs): Effect.Effect<void, CliFailure> {
  const named = [
    ["--cwd", args.cwd, "the directory to open the terminal in"],
    ["--parent", args.parent, "the terminal to split"],
    [
      "--intent",
      args.intent,
      'the label the canvas shows for this terminal (e.g. "fix #2117")',
    ],
    ["--repo", args.repo, "the repository to branch the worktree FROM"],
    ["--worktree", args.worktree, "the branch to cut the new worktree on"],
  ] as const satisfies ReadonlyArray<
    readonly [string, string | undefined, string]
  >;
  for (const [flag, value, names] of named) {
    if (value !== undefined && isBlank(value)) {
      return Effect.fail(blankFlag(flag, names));
    }
  }
  return Effect.void;
}

/** This verb's placement refusal — the shared sentence from `@kolu/padi/render`,
 *  naming THIS command. `padi-tui create` states the same rule from the same
 *  helper, so the two faces cannot drift into two different accounts of one
 *  rule; the exclusive-pair sentence is face-independent and is imported whole
 *  ({@link PLACEMENT_FLAGS_EXCLUSIVE}). */
const PLACEMENT_REQUIRED_FLAGS = placementRequiredMessage("kolu create");

/** WHERE ON THE CANVAS the new terminal lands, parsed from the flag pair — the
 *  CLI's spelling of the wire's `TerminalPlacement`.
 *
 *  The `child-of` arm carries the RAW `--parent` query rather than a
 *  `TerminalId`, because a user hands `kolu` any unique prefix and widening it
 *  needs the live roster — which needs the dial. So the ARM is decided here,
 *  purely, before a `--host` can provision a cold box for a command that was
 *  never going to run; only the id inside it is resolved on the far side ({@link
 *  run}). Two states in, two states out, and no third: absent-and-absent is the
 *  refusal, present-and-present is the other one. */
type PlacementFlags =
  | { readonly kind: "toplevel" }
  | { readonly kind: "child-of"; readonly parentQuery: string };

function placementOf(
  args: CreateArgs,
): Effect.Effect<PlacementFlags, CliFailure> {
  const { toplevel, parent } = args;
  if (toplevel && parent !== undefined)
    return Effect.fail(failure(PLACEMENT_FLAGS_EXCLUSIVE));
  if (toplevel) return Effect.succeed({ kind: "toplevel" });
  if (parent !== undefined)
    return Effect.succeed({ kind: "child-of", parentQuery: parent });
  return Effect.fail(failure(PLACEMENT_REQUIRED_FLAGS));
}

/** Read the three directory flags down into the one shape that means something,
 *  refusing every combination that does not.
 *
 *  `localCwd` is the padi's own cwd IF that padi shares our filesystem
 *  (`endpoint.ts`'s `localCwdOf` — decidable from the endpoint, before the dial)
 *  and `undefined` when it does not. It arrives as an argument rather than being
 *  re-derived here so this stays a pure parse, and so the `--worktree` arm can
 *  resolve its repo path HERE, once — see {@link Directory}. */
function directoryOf(
  args: CreateArgs,
  localCwd: string | undefined,
): Effect.Effect<Directory, CliFailure> {
  const { cwd, repo, worktree: name } = args;

  if (name === undefined) {
    if (repo !== undefined) {
      return Effect.fail(
        failure(
          "--repo only means something with --worktree (it names the repo to branch FROM). Add --worktree <branch>, or drop --repo and pass --cwd to just open a terminal somewhere.",
        ),
      );
    }
    return Effect.succeed({ kind: "open", cwd });
  }
  if (cwd !== undefined) {
    return Effect.fail(
      failure(
        "--cwd and --worktree are mutually exclusive: a worktree create opens the terminal IN the new worktree, so a --cwd would be ignored. Pass --repo <path> to say where to branch from.",
      ),
    );
  }
  // WHERE the worktree branches from. No `--repo` and no local cwd is exactly
  // "a remote `--worktree`", refused here — before the dial, so a `--host` never
  // Nix-provisions a cold box for a command that cannot run.
  const from = repo ?? localCwd;
  if (from === undefined) {
    return Effect.fail(failure(WORKTREE_OVER_HOST_NEEDS_REPO));
  }
  return Effect.succeed({ kind: "worktree", name, repo: from });
}

/** The human sentence inside an arbitrary failure, with the `kolu: ` prefix and
 *  trailing newline stripped so {@link failure} can put them back around the
 *  bigger message.
 *
 *  `reportOf` is the run edge's own formatter — the source of truth for turning
 *  an unknown error (a tagged CLI failure, a raw rejection from the wire) into
 *  one line — so this reuses it rather than re-deciding `.stderr` vs `.message`
 *  here and drifting from it. */
const messageOf = (error: unknown): string =>
  reportOf(error)
    .trimEnd()
    .replace(/^kolu: /, "");

/** The failure for a sequence that stopped AFTER earlier steps had landed.
 *
 *  It names each survivor in the form the user can act on — the terminal as the
 *  short id `kolu kill` takes, the worktree as branch + path — and the command
 *  that removes it, because "the create failed" plus an unnamed live terminal is
 *  the same information as no report at all. `intended` is the command line that
 *  never got typed, which is only a fact worth stating when there IS a terminal
 *  sitting at a bare prompt because of it.
 *
 *  `stdoutLost` is the rare double fault: the handles could not be written to
 *  stdout either. It is folded in as one more line rather than replacing this
 *  report, because a write error that ate the names of the orphans would be the
 *  exact defect this function exists to prevent — and it must not be swallowed
 *  either. */
function stoppedPartway(
  landed: Landed,
  error: unknown,
  intended: string | undefined,
  stdoutLost: CliFailure | undefined,
): CliFailure {
  const lines = [
    messageOf(error),
    "  the create stopped PARTWAY — these already exist and were NOT rolled back:",
  ];
  // Creation order, so the list reads as the story of how far it got.
  if (landed.worktree !== undefined) {
    lines.push(
      `    worktree ${landed.worktree.branch} on disk at ${landed.worktree.path} — \`git worktree remove ${landed.worktree.path}\` removes it`,
    );
  }
  if (landed.id !== undefined) {
    const short = shortId(landed.id);
    lines.push(
      `    terminal ${short} live on the canvas — \`kolu kill ${short}\` ends it`,
    );
    if (intended !== undefined) {
      lines.push(
        `    \`${intended}\` was NOT typed — that terminal is sitting at a bare shell prompt`,
      );
    }
  }
  if (stdoutLost !== undefined) {
    lines.push(`  (and ${messageOf(stdoutLost)})`);
  }
  return failure(lines.join("\n"));
}

/** stdout for whatever EXISTS — on the failing path as well as the finishing one.
 *
 *  The case to think about is a driving loop's `id=$(kolu create --toplevel -- claude)`. If
 *  `sendInput` failed, a terminal is live and its id is the only handle to it;
 *  `$(…)` assigns the captured stdout REGARDLESS of the exit code, so printing
 *  it hands the loop's error branch something to `kolu kill`, while staying
 *  silent would leave a real resource unnameable in the one place a script
 *  reads. The exit code, not the presence of stdout, is what says whether the
 *  verb did its job — and it is non-zero either way, so a loop that checks it
 *  (the documented contract) cannot mistake this for success.
 *
 *  What makes that safe rather than a lie is the payload itself: it carries only
 *  the steps that LANDED, so `--json` on a stopped run has `id` but no `ran`,
 *  which is precisely the truth "the terminal exists, the command never ran". A
 *  loop that ignores the exit code is already broken — it cannot tell a dropped
 *  link from a success either — and giving it an empty id would not fix it, only
 *  hide the terminal it now owns. */
const emitHandles = (
  json: boolean,
  landed: Landed,
): Effect.Effect<void, CliFailure> => {
  if (json) return writeJson(landed, "the create result");
  // Plain mode's whole payload IS the id; with no terminal there is nothing to
  // write, and an empty line would be a value a `$(…)` would happily capture.
  return landed.id === undefined
    ? Effect.void
    : writeOut(`${landed.id}\n`, "the new terminal's id");
};

/**
 * Create a terminal and (optionally) launch an agent in it.
 *
 * Fails on the ERROR CHANNEL for every refusal — never `process.exit` — so the
 * run edge (`main.ts`) owns the code, the dial's scope still releases on the way
 * out, and a test can run this verb as a value.
 */
export function run(
  endpoint: Endpoint,
  args: CreateArgs,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const { intent } = args;

    // ── The pure gates, BEFORE the dial ──────────────────────────────────
    // Each one names a flag that would otherwise be silently ignored — or, for
    // the first, silently believed — and each is decidable from argv (plus the
    // endpoint) alone, so a typo fails instantly instead of after
    // Nix-provisioning a cold `--host`. Blankness is checked FIRST: an empty
    // value is not a flag to read for meaning, it is a variable that did
    // not expand. The `--worktree over --host needs --repo` refusal is inside
    // the directory parse, where resolving the repo path is what raises it.
    //
    // The PLACEMENT gate runs here too, and its "you said neither" refusal is
    // the one gate that fires on a command with no flags at all — which is
    // exactly the point: `kolu create` alone used to be a legal, silent
    // top-level create.
    yield* refuseBlankFlags(args);
    const placementFlags = yield* placementOf(args);
    const directory = yield* directoryOf(args, localCwdOf(endpoint));

    // The shell RE-PARSES this line, so rebuild it with `shellJoin` (the repo's
    // POSIX-quote source of truth), not a bare `argv.join(" ")`: a `join` would
    // let the shell re-split a single argv token carrying spaces / quotes / `$`
    // / `*` / `;` (one `claude "review this PR"` prompt argument would shatter
    // into three words). `shellJoin` re-quotes each token so a POSIX shell
    // reproduces the exact argv. It is built up here, before the dial, because
    // it is pure — and because a failure report needs it too.
    const intended = args.argv.length > 0 ? shellJoin(args.argv) : undefined;

    const outcome: Outcome = yield* Effect.catchIf(
      withPadi(endpoint, (conn) =>
        Effect.gen(function* () {
          // The ARM was decided before the dial; only the id inside `child-of`
          // needs the live roster to widen a user-typed prefix. `TOPLEVEL_PLACEMENT`
          // is padi's own frozen singleton, so the CLI states the wire's value
          // rather than a second spelling of it.
          const placement: TerminalPlacement =
            placementFlags.kind === "toplevel"
              ? TOPLEVEL_PLACEMENT
              : {
                  kind: "child-of",
                  parentId: yield* resolveTerminal(
                    conn,
                    placementFlags.parentQuery,
                    { flag: "--parent" },
                  ),
                };

          // ── Step 1: the worktree ───────────────────────────────────────
          // Nothing exists yet if this fails, so its error IS the whole truth
          // and goes up unadorned — no survivors to name.
          let cwd: string | undefined;
          let worktree: Landed["worktree"];
          if (directory.kind === "worktree") {
            const wt = yield* conn.client.surface.git.worktreeCreate({
              repoPath: directory.repo,
              name: directory.name,
            });
            worktree = { path: wt.path, branch: wt.branch };
            // The worktree IS the cwd — that is what "open the terminal there"
            // means, and why the two flags refuse each other in `directoryOf`.
            cwd = wt.path;
          } else {
            // WHERE the new terminal opens depends on whether this padi shares
            // our filesystem — the one co-location fact `conn.localCwd` carries
            // (`endpoint.ts`'s `localCwdOf`, read again on the far side of the
            // dial). A LOCAL padi runs on THIS machine, so `localCwd` is
            // `process.cwd()`, a real path there (the tmux convention: a new
            // terminal opens where you are); a REMOTE one (`--host`) runs
            // elsewhere, so `localCwd` is undefined and padi defaults to the
            // remote user's home. An explicit `--cwd` outranks both — it is a
            // path on the PADI's machine, which is the only machine any of
            // these paths are ever about.
            cwd = directory.cwd ?? conn.localCwd;
          }

          // ── Step 2: the terminal ───────────────────────────────────────
          // From here a failure is NOT the whole truth — the worktree is
          // already on disk — so it leaves as a `Stopped` the reporting layer
          // can pair with what landed ({@link orStopped}), rather than as an
          // exception that erases it.
          //
          // Spread discipline, not `{cwd, intent}`: every OPTIONAL field here is
          // a `Schema.optionalKey`, so an explicit `undefined` decodes as a
          // FAILURE rather than as "absent". The key is present or it is not.
          // `placement` is the one REQUIRED field and is therefore stated flat —
          // there is no shape of this call that omits it.
          const { id } = yield* orStopped(
            conn.client.surface.lifecycle.create({
              placement,
              ...(cwd !== undefined ? { cwd } : {}),
              ...(intent !== undefined ? { intent } : {}),
            }),
            { worktree },
          );

          // ── Step 3: the command ────────────────────────────────────────
          // PTY input is buffered — the shell reads `<intended>\r` at its first
          // prompt once rc init completes (the same latent slow-rc race the
          // canvas worktree flow accepts). A terminal is live from here on, so
          // this failure too is carried out with the terminal's id.
          if (intended !== undefined) {
            yield* orStopped(
              conn.client.surface.lifecycle.sendInput({
                id,
                data: `${intended}\r`,
              }),
              { id, worktree },
            );
          }

          return {
            kind: "created",
            result: { id, worktree, ran: intended },
            placement,
          } satisfies Outcome;
        }),
      ),
      // …and back to a value, at the dial boundary: everything below reports on
      // an outcome, and a genuine failure (a step-1 worktree error, a bad
      // `--parent`) re-fails untouched.
      isStopped,
      Effect.succeed,
    );

    if (outcome.kind === "stopped") {
      // The survivor report is the whole point of this path, so a stdout that
      // ALSO failed must not win the error channel and take the orphans' names
      // with it — it is carried into the same report instead.
      const wrote = yield* Effect.result(
        emitHandles(args.json, outcome.landed),
      );
      return yield* Effect.fail(
        stoppedPartway(
          outcome.landed,
          outcome.error,
          intended,
          wrote._tag === "Failure" ? wrote.failure : undefined,
        ),
      );
    }

    const { result, placement } = outcome;
    // stdout is JUST the id — `id=$(kolu create --toplevel)` — or the whole
    // record under `--json`.
    yield* emitHandles(args.json, result);
    if (args.json) return;

    // …and the story goes to stderr, one clause per thing that actually
    // happened. Placement is ALWAYS one of those things now — a top-level
    // create is a decision the user made, not the absence of one, so the
    // trailer says so instead of falling silent.
    const bits = [`— created ${shortId(result.id)}`];
    bits.push(
      placement.kind === "child-of"
        ? `split of ${shortId(placement.parentId)}`
        : "top-level",
    );
    if (result.worktree !== undefined) {
      bits.push(
        `worktree ${result.worktree.branch} at ${result.worktree.path}`,
      );
    }
    if (result.ran !== undefined) bits.push(`running \`${result.ran}\``);
    yield* writeErr(`${bits.join(" · ")}\n`);
  });
}
