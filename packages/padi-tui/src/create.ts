/**
 * `padi-tui create` — spawn a terminal on the host padi owns, optionally as a
 * split tile (`--parent`) or in a fresh git worktree (`--worktree <branch>`), and
 * optionally launch an agent in it (`-- <argv>`). Every step is a thin wrapper
 * over a `padiSurface` procedure that has existed since W1 — `git.worktreeCreate`,
 * `lifecycle.create`, `lifecycle.sendInput` — composed exactly the way the canvas
 * `useWorktreeOps` composes them, so a worktree'd agent created here is
 * byte-identical to one created from the browser (both land as canvas tiles).
 */

import { shellJoin } from "@kolu/shell-quote";
import { Effect } from "effect";
import type { PadiTuiClient } from "./connect.ts";

/** What `create` did — the new terminal's id, the worktree it materialized (if
 *  `--worktree`), and the agent command it launched (if `-- <argv>`). */
export interface CreateResult {
  id: string;
  worktree?: { path: string; branch: string };
  ran?: string;
}

/**
 * Create a terminal and (optionally) launch an agent in it. Order matters:
 *   1. `--worktree` materializes a fresh worktree ON THE HOST first — a worktree
 *      on the wrong machine is unspellable, since `git.worktreeCreate` runs
 *      host-side — and its path becomes the new terminal's cwd;
 *   2. `lifecycle.create` spawns the terminal (a child of `parentId` → a split
 *      tile; padi runs its own shell-init spawn policy, so this needs no argv);
 *   3. if an agent argv was given (after `--`), `lifecycle.sendInput` writes
 *      `<argv>\r` so the shell runs it at its first prompt — the same
 *      initial-command path the canvas worktree flow uses.
 */
export function runCreate(
  client: PadiTuiClient,
  opts: {
    parentId?: string;
    worktree?: { repoPath: string; name: string };
    cwd?: string;
    argv: readonly string[];
  },
): Effect.Effect<CreateResult, unknown> {
  return Effect.gen(function* () {
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
      ...(cwd !== undefined ? { cwd } : {}),
      ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
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

    return { id, worktree, ran };
  });
}
