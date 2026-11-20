import { refusingAsleep } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
import { isAbsolute } from "node:path";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  PadiCreateInputSchema,
  PLACEMENT_REQUIRED,
} from "@kolu/padi-client/surface";
import {
  type BespokeTool,
  messageOf,
  ToolFailure,
} from "@kolu/surface-mcp/tools";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import { isValidWorktreeName, WORKTREE_NAME_MESSAGE } from "kolu-git/schemas";

export const CreateArgsSchema = Schema.Struct({
  ...PadiCreateInputSchema.fields,
  placement: PadiCreateInputSchema.fields.placement.annotate({
    description: PLACEMENT_REQUIRED,
  }),
  repo: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Absolute path (on the machine the padi runs on) of the repository to branch the worktree FROM. Required with `worktree`; a relative path is refused, because this server's working directory is wherever its host spawned it and is not a directory you chose.",
    }),
  ),
  worktree: Schema.optionalKey(
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

interface LandedWorktree {
  readonly path: string;
  readonly branch: string;
}

interface Landed {
  readonly id?: TerminalId;
  readonly worktree?: LandedWorktree;
}

export type CreateRefusal =
  | { readonly kind: "blank-field"; readonly field: string }
  | { readonly kind: "cwd-and-worktree" }
  | { readonly kind: "repo-without-worktree" }
  | { readonly kind: "worktree-needs-repo" }
  | { readonly kind: "relative-repo"; readonly repo: string }
  | {
      readonly kind: "stopped-partway";
      readonly landed: Landed;
      readonly notTyped?: string;
    };

const refuse = (
  message: string,
  detail: CreateRefusal,
): ToolFailure<CreateRefusal> => new ToolFailure(message, detail);

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

export type CreateDirectory =
  | { readonly kind: "worktree"; readonly repo: string; readonly name: string }
  | { readonly kind: "open"; readonly cwd: string | undefined };

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

function stoppedPartway(
  landed: Landed,
  error: unknown,
  notTyped?: string,
): ToolFailure<CreateRefusal> {
  const lines = [
    messageOf(error),
    "the create stopped PARTWAY — these already exist and were NOT rolled back:",
  ];
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

export interface CreateResult {
  readonly id: TerminalId;
  readonly pid: number;
  readonly worktree?: LandedWorktree;
  readonly ran?: string;
}

const composeCreate = (
  directory: CreateDirectory,
  args: CreateArgs,
  padi: PadiSurfaceClient,
): Effect.Effect<CreateResult, unknown> =>
  Effect.gen(function* () {
    const {
      cwd: _cwd,
      repo: _repo,
      worktree: _wt,
      run,
      placement,
      ...createRest
    } = args;

    const worktree =
      directory.kind === "worktree"
        ? yield* padi.surface.git.worktreeCreate({
            repoPath: directory.repo,
            name: directory.name,
          })
        : undefined;
    const cwd =
      worktree?.path ?? (directory.kind === "open" ? directory.cwd : undefined);

    const creating = padi.surface.lifecycle.create({
      placement,
      ...(cwd !== undefined ? { cwd } : {}),
      ...createRest,
    });
    const created = yield* worktree === undefined
      ? creating
      : Effect.mapError(creating, (error) =>
          stoppedPartway({ worktree }, error),
        );

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

export const createTool: BespokeTool = {
  input: CreateArgsSchema,
  mutates: true,
  title: "Create a terminal",
  description:
    'Open a new terminal and return its id. `placement` is REQUIRED and has no default — say `{"kind":"toplevel"}` for a tile of its own, or `{"kind":"child-of","parentId":"<terminal id>"}` to open it as a split INSIDE that terminal; the canvas and the Dock read that edge as who-works-for-whom, so guessing it flattens the hierarchy. Optionally: in a FRESH GIT WORKTREE (repo + worktree ⇒ cut at <repo>/.worktrees/<name>, terminal opens in it), labelled on the canvas (intent), and typing a command at its first shell prompt (run, submitted with Enter). One call replaces `kolu create --toplevel --repo … --worktree … -- <cmd>`. The terminal always gets the rc-hooked shell; `run` is typed input, not a spawn argv. A failure after the worktree or terminal landed names the survivors in structuredContent (stopped-partway) — nothing is rolled back.',
  handler: (args, client) => {
    const a = args as CreateArgs;
    refuseBlankFields(a);
    const directory = resolveCreateDirectory(a);
    return refusingAsleep(composeCreate(directory, a, padiOf(client)));
  },
};
