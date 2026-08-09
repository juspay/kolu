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
 * ## Output discipline
 *
 * stdout is the DATA: exactly the new full id and nothing else, so
 * `id=$(kolu create)` is the whole scripting story. The human trailer — what was
 * created, what it split, which worktree, which command — goes to stderr, where
 * a pipe never sees it. `--json` replaces the stdout line with the full record
 * (`{id, worktree?, ran?}`) and drops the trailer, since a JSON consumer reads
 * the fields rather than the prose.
 *
 * ## Refusals, not silent overrides
 *
 * Four gates fail loud rather than degrading, in this repo's house style
 * (`endpoint.ts`'s `refuseEndpointFlags` is the same idea one layer up): a flag
 * the user spelled and we would have ignored is a defect, not a convenience.
 * Three are PURE and run before the dial, so a typo never provisions a cold ssh
 * host; the fourth needs the transport's one co-location fact and runs just
 * after.
 */

import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { readTerminalKeys } from "@kolu/padi/read";
import { resolveTerminalId, shortId } from "@kolu/padi/render";
import { shellJoin } from "@kolu/shell-quote";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Option } from "effect";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { failure } from "../exit.ts";
import { writeErr, writeOut } from "./shared.ts";

/** What the command tree parses for `kolu create` (see `cli.ts`). The optional
 *  flags arrive as `Option` — Effect CLI's spelling for "absent" — and are read
 *  down to `undefined` once, at the top of {@link run}, because the wire below
 *  distinguishes an ABSENT key from an explicit `undefined` (every optional
 *  field on `PadiCreateInputSchema` is a `Schema.optionalKey`, so passing
 *  `{cwd: undefined}` is a decode FAILURE, not a default). */
export interface CreateArgs {
  readonly argv: readonly string[];
  readonly cwd: Option.Option<string>;
  readonly parent: Option.Option<string>;
  readonly intent: Option.Option<string>;
  readonly repo: Option.Option<string>;
  readonly worktree: Option.Option<string>;
  readonly json: boolean;
}

/** What `create` did — the new terminal's full id, the worktree it materialized
 *  (`--worktree`), and the command line it typed (`-- <argv>`). The `--json`
 *  payload verbatim: `JSON.stringify` drops the absent keys, so the two shapes
 *  can't drift. */
interface CreateResult {
  readonly id: TerminalId;
  readonly worktree?: { readonly path: string; readonly branch: string };
  readonly ran?: string;
}

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
    const parent = Option.getOrUndefined(args.parent);
    const intent = Option.getOrUndefined(args.intent);
    const repo = Option.getOrUndefined(args.repo);
    const worktreeName = Option.getOrUndefined(args.worktree);
    const cwdFlag = Option.getOrUndefined(args.cwd);

    // ── The pure gates, BEFORE the dial ──────────────────────────────────
    // Each one names a flag that would otherwise be silently ignored, and each
    // is decidable from argv alone — so a typo fails instantly instead of after
    // Nix-provisioning a cold `--host`.
    if (repo !== undefined && worktreeName === undefined) {
      return yield* Effect.fail(
        failure(
          "--repo only means something with --worktree (it names the repo to branch FROM). Add --worktree <branch>, or drop --repo and pass --cwd to just open a terminal somewhere.",
        ),
      );
    }
    if (cwdFlag !== undefined && worktreeName !== undefined) {
      return yield* Effect.fail(
        failure(
          "--cwd and --worktree are mutually exclusive: a worktree create opens the terminal IN the new worktree, so a --cwd would be ignored. Pass --repo <path> to say where to branch from.",
        ),
      );
    }
    // A remote `--worktree` with no `--repo` is decidable from the ENDPOINT
    // alone, so refuse it here too — before the ssh dial Nix-provisions a cold
    // host for a command that cannot run. The transport-blind twin below
    // (`repoPath === undefined`) is the invariant; this is the fast path, and
    // both spell the one message so they cannot drift.
    if (
      endpoint.kind === "host" &&
      worktreeName !== undefined &&
      repo === undefined
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

    const created = yield* withPadi(endpoint, (conn) =>
      Effect.gen(function* () {
        const parentId =
          parent === undefined
            ? undefined
            : yield* resolveParent(conn.client, parent);

        // WHERE the new terminal opens depends on whether this padi shares our
        // filesystem — the one co-location fact `conn.localCwd` carries. A LOCAL
        // padi runs on THIS machine, so `localCwd` is `process.cwd()`, a real
        // path there (the tmux convention: a new terminal opens where you are);
        // a REMOTE one (`--host`) runs elsewhere, so `localCwd` is undefined and
        // padi defaults to the remote user's home. An explicit `--cwd` outranks
        // both — it is a path on the PADI's machine, which is the only machine
        // any of these paths are ever about.
        let cwd = cwdFlag ?? conn.localCwd;

        let worktree: CreateResult["worktree"];
        if (worktreeName !== undefined) {
          // The transport-blind half of the `--host` gate: `repoPath` is
          // undefined exactly when we are remote and no `--repo` was given.
          const repoPath = repo ?? conn.localCwd;
          if (repoPath === undefined) {
            return yield* Effect.fail(failure(WORKTREE_OVER_HOST_NEEDS_REPO));
          }
          const wt = yield* conn.client.surface.git.worktreeCreate({
            repoPath,
            name: worktreeName,
          });
          worktree = { path: wt.path, branch: wt.branch };
          // The worktree IS the cwd — that is what "open the terminal there"
          // means, and why the two flags refuse each other above.
          cwd = wt.path;
        }

        // Spread discipline, not `{cwd, parentId, intent}`: every optional field
        // here is a `Schema.optionalKey`, so an explicit `undefined` decodes as a
        // FAILURE rather than as "absent". The key is present or it is not.
        const { id } = yield* conn.client.surface.lifecycle.create({
          ...(cwd !== undefined ? { cwd } : {}),
          ...(parentId !== undefined ? { parentId } : {}),
          ...(intent !== undefined ? { intent } : {}),
        });

        let ran: string | undefined;
        if (args.argv.length > 0) {
          // The shell RE-PARSES this line, so rebuild it with `shellJoin` (the
          // repo's POSIX-quote source of truth), not a bare `argv.join(" ")`: a
          // `join` would let the shell re-split a single argv token carrying
          // spaces / quotes / `$` / `*` / `;` (one `claude "review this PR"`
          // prompt argument would shatter into three words). `shellJoin`
          // re-quotes each token so a POSIX shell reproduces the exact argv.
          ran = shellJoin(args.argv);
          // PTY input is buffered — the shell reads `<ran>\r` at its first
          // prompt once rc init completes (the same latent slow-rc race the
          // canvas worktree flow accepts).
          yield* conn.client.surface.lifecycle.sendInput({
            id,
            data: `${ran}\r`,
          });
        }

        return { result: { id, worktree, ran } as CreateResult, parentId };
      }),
    );

    const { result, parentId } = created;
    if (args.json) {
      return yield* writeOut(
        `${JSON.stringify(result, null, 2)}\n`,
        "the create result",
      );
    }

    // stdout is JUST the id — `id=$(kolu create)`.
    yield* writeOut(`${result.id}\n`, "the new terminal's id");
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
