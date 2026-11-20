import {
  parsePlacementFlags,
  type StatedPlacementFlags,
} from "@kolu/padi/render";
import type { TerminalPlacement } from "@kolu/padi-client/surface";
import { shellJoin } from "@kolu/shell-quote";
import { Effect } from "effect";
import type { PadiTuiClient } from "./connect.ts";
import { type CliFailure, failure } from "./exit.ts";

/** PURE, and it must stay pure: `cmdCreate` runs it BEFORE `connectTo`, so a bare
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

export interface CreateResult {
  id: string;
  worktree?: { path: string; branch: string };
  ran?: string;
}

export function runCreate(
  client: PadiTuiClient,
  opts: {
    placement: TerminalPlacement;
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
      placement: opts.placement,
      ...(cwd !== undefined ? { cwd } : {}),
    });

    let ran: string | undefined;
    if (opts.argv.length > 0) {
      ran = shellJoin(opts.argv);
      yield* client.surface.lifecycle.sendInput({
        id,
        data: `${ran as string}\r`,
      });
    }

    return { id, worktree, ran };
  });
}
