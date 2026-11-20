import {
  parsePlacementFlags,
  type StatedPlacementFlags,
  shortId,
} from "@kolu/padi/render";
import {
  type TerminalPlacement,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { shellJoin } from "@kolu/shell-quote";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Command } from "effect/cli";
import type { createFlags } from "../cli.ts";
import { type Endpoint, localCwdOf, withPadi } from "../endpoint.ts";
import {
  blankFlag,
  type CliFailure,
  failure,
  isBlank,
  renderDiagnostic,
} from "../exit.ts";
import { resolveTerminal, writeErr, writeJson, writeOut } from "./shared.ts";

export type CreateArgs = Command.Command.Config.Infer<typeof createFlags>;

interface Landed {
  readonly id?: TerminalId;
  readonly worktree?: { readonly path: string; readonly branch: string };
  readonly ran?: string;
}

interface CreateResult extends Landed {
  readonly id: TerminalId;
}

type PartialCreate = Landed;

type Outcome =
  | {
      readonly kind: "created";
      readonly result: CreateResult;
      readonly placement: TerminalPlacement;
    }
  | {
      readonly kind: "stopped";
      readonly landed: PartialCreate;
      readonly error: unknown;
    };

const WORKTREE_OVER_HOST_NEEDS_REPO =
  "--worktree over --host needs --repo <path on the host>: the worktree is cut on the REMOTE machine, so it can't default to your local directory. Pass --repo with an absolute path on the host.";

type Directory =
  | {
      readonly kind: "worktree";
      readonly name: string;
      readonly repo: string;
    }
  | { readonly kind: "open"; readonly cwd: string | undefined };

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

function placementOf(
  args: CreateArgs,
): Effect.Effect<StatedPlacementFlags, CliFailure> {
  const read = parsePlacementFlags("kolu create", args);
  return read.kind === "refused"
    ? Effect.fail(failure(read.message))
    : Effect.succeed(read);
}

interface DirectoryFlags {
  readonly cwd: string | undefined;
  readonly repo: string | undefined;
  readonly worktree: string | undefined;
}

function directoryOf(
  flags: DirectoryFlags,
  localCwd: string | undefined,
): Effect.Effect<Directory, CliFailure> {
  const { cwd, repo, worktree: name } = flags;

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
  const from = repo ?? localCwd;
  if (from === undefined) {
    return Effect.fail(failure(WORKTREE_OVER_HOST_NEEDS_REPO));
  }
  return Effect.succeed({ kind: "worktree", name, repo: from });
}

const messageOf = (error: unknown): string =>
  renderDiagnostic(error)
    .trimEnd()
    .replace(/^kolu: /, "");

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

const writeHandles = (
  json: boolean,
  landed: Landed,
): Effect.Effect<void, CliFailure> => {
  if (json) return writeJson(landed, "the create result");
  return landed.id === undefined
    ? Effect.void
    : writeOut(`${landed.id}\n`, "the new terminal's id");
};

const emitSurvivingHandles = (
  json: boolean,
  partial: PartialCreate,
): Effect.Effect<void, CliFailure> => writeHandles(json, partial);

const emitCreated = (
  json: boolean,
  result: CreateResult,
): Effect.Effect<void, CliFailure> => writeHandles(json, result);

export function run(
  endpoint: Endpoint,
  args: CreateArgs,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const { intent } = args;

    yield* refuseBlankFlags(args);
    const placementFlags = yield* placementOf(args);
    const directory = yield* directoryOf(args, localCwdOf(endpoint));

    const intended = args.argv.length > 0 ? shellJoin(args.argv) : undefined;

    const outcome: Outcome = yield* withPadi(endpoint, (conn) =>
      Effect.gen(function* () {
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

        let cwd: string | undefined;
        let worktree: Landed["worktree"];
        if (directory.kind === "worktree") {
          const wt = yield* conn.client.surface.git.worktreeCreate({
            repoPath: directory.repo,
            name: directory.name,
          });
          worktree = { path: wt.path, branch: wt.branch };
          cwd = wt.path;
        } else {
          cwd = directory.cwd ?? conn.localCwd;
        }

        const created = yield* Effect.result(
          conn.client.surface.lifecycle.create({
            placement,
            ...(cwd !== undefined ? { cwd } : {}),
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

        if (intended !== undefined) {
          const typed = yield* Effect.result(
            conn.client.surface.lifecycle.sendInput({
              id,
              data: `${intended}\r`,
            }),
          );
          if (typed._tag === "Failure") {
            return {
              kind: "stopped",
              landed: { id, worktree },
              error: typed.failure,
            } satisfies Outcome;
          }
        }

        return {
          kind: "created",
          result: { id, worktree, ran: intended },
          placement,
        } satisfies Outcome;
      }),
    );

    if (outcome.kind === "stopped") {
      const wrote = yield* Effect.result(
        emitSurvivingHandles(args.json, outcome.landed),
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
    yield* emitCreated(args.json, result);
    if (args.json) return;

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
