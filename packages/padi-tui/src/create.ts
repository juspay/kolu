/**
 * `padi-tui create` — spawn a terminal on the host padi owns at a STATED
 * placement (a tile of its own, or a split of another), optionally in a fresh
 * git worktree (`--worktree <branch>`), and
 * optionally launch an agent in it (`-- <argv>`). Every step is a thin wrapper
 * over a `padiSurface` procedure that has existed since W1 — `git.worktreeCreate`,
 * `lifecycle.create`, `lifecycle.sendInput` — composed exactly the way the canvas
 * `useWorktreeOps` composes them, so a worktree'd agent created here is
 * byte-identical to one created from the browser (both land as canvas tiles).
 */

import {
  parsePlacementFlags,
  type StatedPlacementFlags,
} from "@kolu/padi/render";
import {
  FIRST_MESSAGE_SETTLE_MS,
  type TerminalPlacement,
} from "@kolu/padi/surface";
import { encodeSend, type SendVocabulary } from "@kolu/terminal-protocol";
import { shellJoin } from "@kolu/shell-quote";
import { Effect } from "effect";
import type { PadiTuiClient } from "./connect.ts";
import { type CliFailure, failure } from "./exit.ts";

/** `padi-tui create`'s PLACEMENT gate — the shared decision, wearing this face's
 *  name and this face's failure type.
 *
 *  It lives HERE rather than inline in `cmdCreate` for one reason: `main.ts` calls
 *  `cli(…)` at module scope, so importing it parses `process.argv` and nothing in
 *  it can be reached by a test. The gate was the one load-bearing pure step on that
 *  side of the line — `kolu create`'s equivalent is pinned through its own `run`,
 *  and this one was pinned nowhere. A rule enforced on two faces needs its wiring
 *  proven on both, not just its shared middle.
 *
 *  PURE, and it must stay pure: `cmdCreate` runs it BEFORE `connectTo`, so a bare
 *  `padi-tui create` fails instantly instead of after `--host` has Nix-provisioned
 *  a cold box for a command that was never going to run. */
export function placementGate(flags: {
  readonly toplevel: boolean;
  readonly parent: string | undefined;
}): Effect.Effect<StatedPlacementFlags, CliFailure> {
  const read = parsePlacementFlags("padi-tui create", flags);
  return read.kind === "refused"
    ? Effect.fail(failure(read.message))
    : Effect.succeed(read);
}

/** This face's spelling of the shared send policy — the flag a refusal names,
 *  and the ritual it quotes. The RULES are `@kolu/terminal-protocol`'s, shared
 *  with every other face, so one intent gets one answer whichever binary a
 *  script reaches for. */
const PADI_TUI_SEND_VOCABULARY: SendVocabulary = {
  keyName: "--key",
  submitRitual:
    "  padi-tui send <id> --file brief.md   # 1. the text\n" +
    "  padi-tui wait <id> --until idle:300  # 2. observe the TUI settle\n" +
    "  padi-tui send <id> --key Enter       # 3. submit",
};

/** What `create` did — the new terminal's id, the worktree it materialized (if
 *  `--worktree`), and the agent command it launched (if `-- <argv>`). */
export interface CreateResult {
  id: string;
  worktree?: { path: string; branch: string };
  ran?: string;
  /** The first message, present only once it was actually SUBMITTED (`--message`).
   *  A run that reports `briefed` has put the worker to work; one that does not,
   *  has not — there is no "delivered, probably" reading. */
  briefed?: string;
}

/**
 * Create a terminal and (optionally) launch an agent in it. Order matters:
 *   1. `--worktree` materializes a fresh worktree ON THE HOST first — a worktree
 *      on the wrong machine is unspellable, since `git.worktreeCreate` runs
 *      host-side — and its path becomes the new terminal's cwd;
 *   2. `lifecycle.create` spawns the terminal at the STATED `placement` (a
 *      `child-of` arm → a split tile; padi runs its own shell-init spawn policy,
 *      so this needs no argv);
 *   3. if an agent argv was given (after `--`), `lifecycle.sendInput` writes
 *      `<argv>\r` so the shell runs it at its first prompt — the same
 *      initial-command path the canvas worktree flow uses;
 *   4. if a `--message` was given, `lifecycle.submitInput` delivers it once that
 *      agent reaches its prompt — the one-call dispatch, same as `kolu create
 *      --message` and `lifecycle_create { message }`.
 *
 * Step 4 is here for the reason the placement rule is: a capability exists on
 * EVERY face or it does not exist. This binary is on its way out, and that is an
 * argument for not GROWING it, not for letting it answer the same intent
 * differently while it is still shipped — a script that reaches for `padi-tui`
 * should get the same delivery discipline `kolu` gives, or a loud refusal, never
 * a silently-dropped brief.
 */
export function runCreate(
  client: PadiTuiClient,
  opts: {
    /** WHERE ON THE CANVAS the terminal lands. REQUIRED, and the wire's own sum
     *  rather than an optional `parentId`: this face is driven by scripts, which
     *  is exactly the caller that never notices a placement it did not choose. */
    placement: TerminalPlacement;
    worktree?: { repoPath: string; name: string };
    cwd?: string;
    argv: readonly string[];
    /** The first message to deliver once `argv` reaches its prompt. Needs
     *  `argv`: with nothing started the terminal is a bare shell, which would
     *  EXECUTE the brief as a command line rather than read it — refused below
     *  for the same reason both other faces refuse it. */
    message?: string;
  },
): Effect.Effect<CreateResult, unknown> {
  return Effect.gen(function* () {
    if (opts.message !== undefined && opts.argv.length === 0) {
      return yield* Effect.fail(
        new Error(
          "--message has nothing to brief — it is delivered to whatever `-- <argv>` starts, and with no argv this terminal is a bare shell, which would EXECUTE the text as a command line rather than read it. Pass `-- <agent>`, or drop --message.",
        ),
      );
    }
    let cwd = opts.cwd;
    let worktree: CreateResult["worktree"];
    if (opts.worktree !== undefined) {
      const wt = yield* client.surface.git.worktreeCreate({
        repoPath: (opts.worktree as { repoPath: string }).repoPath,
        name: (opts.worktree as { name: string }).name,
      });
      cwd = wt.path;
      worktree = { path: wt.path, branch: wt.branch };
    }

    const { id } = yield* client.surface.lifecycle.create({
      placement: opts.placement,
      ...(cwd !== undefined ? { cwd } : {}),
    });

    let ran: string | undefined;
    if (opts.argv.length > 0) {
      // The shell RE-PARSES this line, so rebuild it with `shellJoin` (the repo's
      // POSIX-quote source of truth), not a bare `argv.join(" ")`: a `join` would let
      // the shell re-split a single argv token that carries spaces / quotes / `$` /
      // `*` / `;` (e.g. one `claude "review this PR"` prompt argument would shatter
      // into three words). `shellJoin` re-quotes each token so `shellSplit` — and a
      // POSIX shell — reproduce the exact argv the user passed.
      ran = shellJoin(opts.argv);
      // PTY input is buffered — the shell reads `<ran>\r` at its first prompt once
      // rc init completes (the same latent slow-rc race the canvas flow accepts;
      // promote to a shell-ready-gated create parameter only if it bites, a contract
      // change deliberately out of scope here).
      yield* client.surface.lifecycle.sendInput({
        id,
        data: `${ran as string}\r`,
      });
    }

    // ── Step 4: the brief ──────────────────────────────────────────────────
    // Encoded through the SHARED send policy, never written raw: a brief is
    // usually multiline and must arrive as ONE bracketed paste, exactly as
    // `kolu create --message` and the MCP tool deliver the same bytes. The wider
    // quiet window is `FIRST_MESSAGE_SETTLE_MS` for the reason it exists — a
    // booting agent is silent between exec and first paint.
    let briefed: string | undefined;
    if (opts.message !== undefined) {
      const encoded = encodeSend(
        {
          kind: "text",
          text: opts.message,
          sourceLabel: "--message",
          paste: undefined,
          fromStream: false,
        },
        PADI_TUI_SEND_VOCABULARY,
      );
      if (encoded.kind === "refused") {
        return yield* Effect.fail(new Error(encoded.message));
      }
      yield* client.surface.lifecycle.submitInput({
        id,
        data: encoded.plan.write,
        settleMs: FIRST_MESSAGE_SETTLE_MS,
      });
      briefed = opts.message;
    }

    return { id, worktree, ran, briefed };
  });
}
