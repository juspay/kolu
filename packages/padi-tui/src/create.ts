import {
  parsePlacementFlags,
  type StatedPlacementFlags,
} from "@kolu/padi/render";
import type { TerminalPlacement } from "@kolu/padi-client/surface";
import { shellJoin } from "@kolu/shell-quote";
import { Effect } from "effect";
import type { PadiTuiClient } from "./connect.ts";
import { type CliFailure, failure } from "./exit.ts";

export function placementGate(flags: {
  readonly toplevel: boolean;
  readonly parent: string | undefined;
}): Effect.Effect<StatedPlacementFlags, CliFailure> {
  const read = parsePlacementFlags("padi-tui create", flags);
  return read.kind === "refused"
    ? Effect.fail(failure(read.message))
    : Effect.succeed(read);
}

export type CreateSite =
  | { readonly kind: "local"; readonly cwd: string }
  | { readonly kind: "remote" };

export type CreateDirectory =
  | {
      readonly kind: "worktree";
      readonly repoPath: string;
      readonly name: string;
    }
  | { readonly kind: "cwd"; readonly cwd: string }
  | { readonly kind: "default" };

export function directoryOf(
  site: CreateSite,
  flags: {
    readonly worktree: string | undefined;
    readonly repo: string | undefined;
  },
): Effect.Effect<CreateDirectory, CliFailure> {
  if (flags.worktree === undefined) {
    return Effect.succeed(
      site.kind === "local"
        ? { kind: "cwd", cwd: site.cwd }
        : { kind: "default" },
    );
  }
  const repoPath = flags.repo ?? (site.kind === "local" ? site.cwd : undefined);
  if (repoPath === undefined) {
    return Effect.fail(
      failure(
        "--worktree over --host needs --repo <path on the host>: the worktree is cut on the REMOTE machine, so it can't default to your local directory. Pass --repo with an absolute path on the host.",
      ),
    );
  }
  return Effect.succeed({ kind: "worktree", repoPath, name: flags.worktree });
}

export type CreateClient = {
  readonly surface: {
    readonly lifecycle: Pick<
      PadiTuiClient["surface"]["lifecycle"],
      "create" | "sendInput"
    >;
    readonly git: Pick<PadiTuiClient["surface"]["git"], "worktreeCreate">;
  };
};

export interface CreateResult {
  id: string;
  worktree?: { path: string; branch: string };
  ran?: string;
}

export function runCreate(
  client: CreateClient,
  opts: {
    placement: TerminalPlacement;
    directory: CreateDirectory;
    argv: readonly string[];
  },
): Effect.Effect<CreateResult, unknown> {
  return Effect.gen(function* () {
    const { directory } = opts;
    let cwd = directory.kind === "cwd" ? directory.cwd : undefined;
    let worktree: CreateResult["worktree"];
    if (directory.kind === "worktree") {
      const wt = yield* client.surface.git.worktreeCreate({
        repoPath: directory.repoPath,
        name: directory.name,
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
      yield* client.surface.lifecycle.sendInput({ id, data: `${ran}\r` });
    }

    return { id, worktree, ran };
  });
}
