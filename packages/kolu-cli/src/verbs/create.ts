/**
 * `kolu create` — spawn a terminal on the padi we dialed, optionally as a split
 * tile (`--parent`), in a fresh git worktree (`--worktree`), labelled on the
 * canvas (`--intent`), and optionally running an agent in it (`-- <argv>`).
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
 * `id=$(kolu create)` is the whole scripting story. The human trailer — what was
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
 * The three that decide WHERE the terminal opens are folded into one parse
 * ({@link placementOf}) whose result makes the illegal combinations
 * unspellable; the rest are PURE checks before the dial, so a typo never
 * provisions a cold ssh host, except the one co-location fact that needs the
 * transport and is checked just after it.
 */

import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { readTerminalKeys } from "@kolu/padi/read";
import { resolveTerminalId, shortId } from "@kolu/padi/render";
import { shellJoin } from "@kolu/shell-quote";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { createFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { type CliFailure, failure, reportOf } from "../exit.ts";
import { writeErr, writeOut } from "./shared.ts";

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
      readonly parentId: TerminalId | undefined;
    }
  | {
      readonly kind: "stopped";
      readonly landed: Landed;
      readonly error: unknown;
    };

/** The one `--worktree over --host needs --repo` message. A remote `--worktree`
 *  cannot default to `conn.localCwd` for the reason that makes the whole flag
 *  work: the worktree is cut on the REMOTE machine by `git.worktreeCreate`, so a
 *  local path would name a repo on the wrong host. */
const WORKTREE_OVER_HOST_NEEDS_REPO =
  "--worktree over --host needs --repo <path on the host>: the worktree is cut on the REMOTE machine, so it can't default to your local directory. Pass --repo with an absolute path on the host.";

// stdout/stderr are `./shared.ts`'s. The draining sink matters even for one
// short line: `process.stdout` is ASYNCHRONOUS when it is a pipe, and the run
// edge exits the moment this effect completes, so a write that had not drained
// would truncate `id=$(kolu create)` to nothing. A hung-up consumer
// (`kolu create | head -1`) is a complete run — the terminal exists either way.

/** WHERE the new terminal opens, as ONE value with two arms.
 *
 *  `--cwd`, `--repo` and `--worktree` reach us as three independent `Option`s —
 *  a flat product of eight combinations, five of which are nonsense — so they
 *  are read down ONCE, here, into the two shapes that mean something. Past this
 *  function `--cwd` does not exist in worktree mode and `--repo` does not exist
 *  outside it: the combinations that used to be refused by arm-ordered runtime
 *  guards further down are now unspellable in the type, and the guards are gone
 *  rather than merely relocated. The refusal sentences are unchanged — the same
 *  three a user could hit before. */
type Placement =
  | {
      readonly kind: "worktree";
      readonly name: string;
      /** Absent means "branch from wherever the padi's cwd is", which only has
       *  an answer when the padi shares our filesystem — see the `--host` gate
       *  in {@link run} and its transport-blind twin. */
      readonly repo: string | undefined;
    }
  | { readonly kind: "open"; readonly cwd: string | undefined };

function placementOf(args: CreateArgs): Effect.Effect<Placement, CliFailure> {
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
  return Effect.succeed({ kind: "worktree", name, repo });
}

/** Resolve `--parent` — an id or any unique PREFIX of one, the short id `kolu ls`
 *  prints — against the live terminal keys, failing loudly on no-match or
 *  ambiguity. NOT `./shared.ts`'s `resolveTerminal`: both failures name the FLAG
 *  (`--parent: no terminal matching …`), because the id that was wrong here is
 *  one of two arguments rather than the verb's subject. */
function resolveParent(
  client: PadiSurfaceClient,
  query: string,
): Effect.Effect<TerminalId, unknown> {
  return Effect.flatMap(readTerminalKeys(client), (ids) => {
    const result = resolveTerminalId(query, ids);
    if (result.kind === "found") return Effect.succeed(result.id);
    if (result.kind === "none") {
      return Effect.fail(
        failure(
          `--parent: no terminal matching "${query}" — \`kolu ls\` shows the live ones.`,
        ),
      );
    }
    return Effect.fail(
      failure(
        `--parent: "${query}" matches ${result.matches.length} terminals — type more characters:\n  ${result.matches
          .map(shortId)
          .join("\n  ")}`,
      ),
    );
  });
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
 *  The case to think about is a driving loop's `id=$(kolu create -- claude)`. If
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
  if (json) {
    return writeOut(
      `${JSON.stringify(landed, null, 2)}\n`,
      "the create result",
    );
  }
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
    const { parent, intent } = args;

    // ── The pure gates, BEFORE the dial ──────────────────────────────────
    // Each one names a flag that would otherwise be silently ignored, and each
    // is decidable from argv alone — so a typo fails instantly instead of after
    // Nix-provisioning a cold `--host`.
    const placement = yield* placementOf(args);
    // A remote `--worktree` with no `--repo` is decidable from the ENDPOINT
    // alone, so refuse it here too — before the ssh dial Nix-provisions a cold
    // host for a command that cannot run. The transport-blind twin below
    // (`repoPath === undefined`) is the invariant; this is the fast path, and
    // both spell the one message so they cannot drift.
    if (
      endpoint.kind === "host" &&
      placement.kind === "worktree" &&
      placement.repo === undefined
    ) {
      return yield* Effect.fail(failure(WORKTREE_OVER_HOST_NEEDS_REPO));
    }
    if (intent !== undefined && intent.trim() === "") {
      return yield* Effect.fail(
        failure(
          '--intent must be a non-empty label — it is what the canvas shows for this terminal (e.g. --intent "fix #2117"). Omit the flag to create one with no label.',
        ),
      );
    }

    // The shell RE-PARSES this line, so rebuild it with `shellJoin` (the repo's
    // POSIX-quote source of truth), not a bare `argv.join(" ")`: a `join` would
    // let the shell re-split a single argv token carrying spaces / quotes / `$`
    // / `*` / `;` (one `claude "review this PR"` prompt argument would shatter
    // into three words). `shellJoin` re-quotes each token so a POSIX shell
    // reproduces the exact argv. It is built up here, before the dial, because
    // it is pure — and because a failure report needs it too.
    const intended = args.argv.length > 0 ? shellJoin(args.argv) : undefined;

    const outcome: Outcome = yield* withPadi(endpoint, (conn) =>
      Effect.gen(function* () {
        const parentId =
          parent === undefined
            ? undefined
            : yield* resolveParent(conn.client, parent);

        // ── Step 1: the worktree ─────────────────────────────────────────
        // Nothing exists yet if this fails, so its error IS the whole truth and
        // goes up unadorned — no survivors to name.
        let cwd: string | undefined;
        let worktree: Landed["worktree"];
        if (placement.kind === "worktree") {
          // The transport-blind half of the `--host` gate: `repoPath` is
          // undefined exactly when we are remote and no `--repo` was given.
          const repoPath = placement.repo ?? conn.localCwd;
          if (repoPath === undefined) {
            return yield* Effect.fail(failure(WORKTREE_OVER_HOST_NEEDS_REPO));
          }
          const wt = yield* conn.client.surface.git.worktreeCreate({
            repoPath,
            name: placement.name,
          });
          worktree = { path: wt.path, branch: wt.branch };
          // The worktree IS the cwd — that is what "open the terminal there"
          // means, and why the two flags refuse each other in `placementOf`.
          cwd = wt.path;
        } else {
          // WHERE the new terminal opens depends on whether this padi shares
          // our filesystem — the one co-location fact `conn.localCwd` carries.
          // A LOCAL padi runs on THIS machine, so `localCwd` is
          // `process.cwd()`, a real path there (the tmux convention: a new
          // terminal opens where you are); a REMOTE one (`--host`) runs
          // elsewhere, so `localCwd` is undefined and padi defaults to the
          // remote user's home. An explicit `--cwd` outranks both — it is a
          // path on the PADI's machine, which is the only machine any of these
          // paths are ever about.
          cwd = placement.cwd ?? conn.localCwd;
        }

        // ── Step 2: the terminal ─────────────────────────────────────────
        // From here a failure is NOT the whole truth — the worktree is already
        // on disk — so the error becomes a value the reporting layer can pair
        // with what landed, rather than an exception that erases it.
        //
        // Spread discipline, not `{cwd, parentId, intent}`: every optional field
        // here is a `Schema.optionalKey`, so an explicit `undefined` decodes as a
        // FAILURE rather than as "absent". The key is present or it is not.
        const created = yield* Effect.result(
          conn.client.surface.lifecycle.create({
            ...(cwd !== undefined ? { cwd } : {}),
            ...(parentId !== undefined ? { parentId } : {}),
            ...(intent !== undefined ? { intent } : {}),
          }),
        );
        if (created._tag === "Failure") {
          return {
            kind: "stopped",
            landed: { worktree },
            error: created.failure,
          } satisfies Outcome;
        }
        const { id } = created.success;

        // ── Step 3: the command ──────────────────────────────────────────
        // PTY input is buffered — the shell reads `<intended>\r` at its first
        // prompt once rc init completes (the same latent slow-rc race the
        // canvas worktree flow accepts). A terminal is live from here on, so
        // this failure too is carried as a value.
        if (intended !== undefined) {
          const sent = yield* Effect.result(
            conn.client.surface.lifecycle.sendInput({
              id,
              data: `${intended}\r`,
            }),
          );
          if (sent._tag === "Failure") {
            return {
              kind: "stopped",
              landed: { id, worktree },
              error: sent.failure,
            } satisfies Outcome;
          }
        }

        return {
          kind: "created",
          result: { id, worktree, ran: intended },
          parentId,
        } satisfies Outcome;
      }),
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

    const { result, parentId } = outcome;
    // stdout is JUST the id — `id=$(kolu create)` — or the whole record under
    // `--json`.
    yield* emitHandles(args.json, result);
    if (args.json) return;

    // …and the story goes to stderr, one clause per thing that actually
    // happened, so a bare create says one short thing and a worktree'd agent
    // says all of it.
    const bits = [`— created ${shortId(result.id)}`];
    if (parentId !== undefined) bits.push(`split of ${shortId(parentId)}`);
    if (result.worktree !== undefined) {
      bits.push(
        `worktree ${result.worktree.branch} at ${result.worktree.path}`,
      );
    }
    if (result.ran !== undefined) bits.push(`running \`${result.ran}\``);
    yield* writeErr(`${bits.join(" · ")}\n`);
  });
}
