import { TOPLEVEL_PLACEMENT } from "@kolu/padi-client/surface";
import { shellSplit } from "@kolu/shell-quote";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CliFailure } from "./exit.ts";
import {
  type CreateClient,
  type CreateSite,
  directoryOf,
  placementGate,
  runCreate,
} from "./create.ts";

function stubClient(): {
  client: CreateClient;
  sent: string[];
  created: Array<Record<string, unknown>>;
} {
  const sent: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const client: CreateClient = {
    surface: {
      lifecycle: {
        create: vi.fn((input: Record<string, unknown>) =>
          Effect.sync(() => {
            created.push(input);
            return { id: "t-new", pid: 4242 };
          }),
        ),
        sendInput: vi.fn(({ data }: { id: string; data: string }) =>
          Effect.sync(() => {
            sent.push(data);
          }),
        ),
      },
      git: {
        worktreeCreate: vi.fn(() =>
          Effect.succeed({ path: "/wt", branch: "feat" }),
        ),
      },
    },
  };
  return { client, sent, created };
}

function relaunchedArgv(sent: string[]): string[] {
  expect(sent).toHaveLength(1);
  const line = sent[0];
  if (line === undefined) throw new Error("no input was sent");
  expect(line.endsWith("\r")).toBe(true);
  return shellSplit(line.slice(0, -1));
}

describe("runCreate — the launched command round-trips the argv", () => {
  it("preserves a single argument that carries spaces (a prompt)", async () => {
    const { client, sent } = stubClient();
    const argv = ["claude", "review this PR"];
    const result = await Effect.runPromise(
      runCreate(client, {
        placement: TOPLEVEL_PLACEMENT,
        directory: { kind: "default" },
        argv,
      }),
    );

    expect(relaunchedArgv(sent)).toEqual(argv);
    expect(result.ran).toBe(`claude 'review this PR'`);
  });

  it("preserves quotes, `$`, `*`, `;` and other shell metacharacters", async () => {
    const { client, sent } = stubClient();
    const argv = ["sh", "-c", `echo "$HOME"/* ; rm -rf 'a b'`];
    await Effect.runPromise(
      runCreate(client, {
        placement: TOPLEVEL_PLACEMENT,
        directory: { kind: "default" },
        argv,
      }),
    );
    expect(relaunchedArgv(sent)).toEqual(argv);
  });

  it("preserves an empty argument", async () => {
    const { client, sent } = stubClient();
    const argv = ["cmd", "", "tail"];
    await Effect.runPromise(
      runCreate(client, {
        placement: TOPLEVEL_PLACEMENT,
        directory: { kind: "default" },
        argv,
      }),
    );
    expect(relaunchedArgv(sent)).toEqual(argv);
  });

  it("sends nothing when no argv was given (a bare terminal)", async () => {
    const { client, sent } = stubClient();
    const result = await Effect.runPromise(
      runCreate(client, {
        placement: TOPLEVEL_PLACEMENT,
        directory: { kind: "default" },
        argv: [],
      }),
    );
    expect(sent).toHaveLength(0);
    expect(result.ran).toBeUndefined();
  });
});

describe("runCreate — the create payload states placement and OMITS absent optional keys", () => {
  it("omits cwd when it was not chosen, and still states placement", async () => {
    const { client, created } = stubClient();
    await Effect.runPromise(
      runCreate(client, {
        placement: TOPLEVEL_PLACEMENT,
        directory: { kind: "default" },
        argv: [],
      }),
    );
    expect(created).toHaveLength(1);
    expect(Object.keys(created[0] ?? {})).toEqual(["placement"]);
    expect(created[0]).toEqual({ placement: { kind: "toplevel" } });
  });

  it("carries a split's parent inside the placement, not as a loose key", async () => {
    const { client, created } = stubClient();
    await Effect.runPromise(
      runCreate(client, {
        placement: { kind: "child-of", parentId: "t-parent" as TerminalId },
        directory: { kind: "default" },
        argv: [],
      }),
    );
    expect(created[0]).toEqual({
      placement: { kind: "child-of", parentId: "t-parent" },
    });
  });

  it("takes cwd from the materialized worktree", async () => {
    const { client, created } = stubClient();
    await Effect.runPromise(
      runCreate(client, {
        placement: TOPLEVEL_PLACEMENT,
        directory: { kind: "worktree", repoPath: "/repo", name: "feat" },
        argv: [],
      }),
    );
    expect(created[0]).toEqual({
      placement: { kind: "toplevel" },
      cwd: "/wt",
    });
  });
});

describe("placementGate — padi-tui's PRE-DIAL wiring of the shared rule", () => {
  const refusalOf = (flags: {
    toplevel: boolean;
    parent: string | undefined;
  }): string => {
    const exit = Effect.runSyncExit(placementGate(flags));
    return Exit.isFailure(exit)
      ? ((Cause.squash(exit.cause) as { readonly stderr?: string }).stderr ??
          "")
      : "";
  };

  it("refuses a bare `padi-tui create`, naming THIS command", () => {
    const text = refusalOf({ toplevel: false, parent: undefined });
    expect(text).toContain("--toplevel");
    expect(text).toContain("--parent <id>");
    expect(text).toContain("`padi-tui create --toplevel`");
    expect(text).not.toContain("kolu create");
  });

  it("refuses BOTH flags", () => {
    expect(refusalOf({ toplevel: true, parent: "3f9c" })).toContain(
      "mutually exclusive",
    );
  });

  it("refuses a BLANK --parent BEFORE the dial — the `--host` case", () => {
    expect(refusalOf({ toplevel: false, parent: "" })).toContain(
      "--parent was passed with an empty value",
    );
  });

  it("passes exactly one flag through as its arm, touching no client", () => {
    expect(
      Effect.runSync(placementGate({ toplevel: true, parent: undefined })),
    ).toEqual({ kind: "toplevel" });
    expect(
      Effect.runSync(placementGate({ toplevel: false, parent: "3f9c" })),
    ).toEqual({ kind: "child-of", parentQuery: "3f9c" });
  });
});

describe("directoryOf — WHERE the new terminal opens", () => {
  const local: CreateSite = { kind: "local", cwd: "/here" };
  const remote: CreateSite = { kind: "remote" };

  const refusalOf = (
    site: CreateSite,
    flags: { worktree: string | undefined; repo: string | undefined },
  ): string => {
    const exit = Effect.runSyncExit(directoryOf(site, flags));
    if (!Exit.isFailure(exit)) return "";
    const error = Cause.squash(exit.cause);
    return error instanceof CliFailure ? error.stderr : "";
  };

  it("opens a plain create in the local cwd, and leaves a remote padi its own default", () => {
    expect(
      Effect.runSync(
        directoryOf(local, { worktree: undefined, repo: undefined }),
      ),
    ).toEqual({ kind: "cwd", cwd: "/here" });
    expect(
      Effect.runSync(
        directoryOf(remote, { worktree: undefined, repo: undefined }),
      ),
    ).toEqual({ kind: "default" });
  });

  it("cuts a worktree off the local cwd when --repo is absent", () => {
    expect(
      Effect.runSync(directoryOf(local, { worktree: "feat", repo: undefined })),
    ).toEqual({ kind: "worktree", repoPath: "/here", name: "feat" });
  });

  it("refuses a REMOTE --worktree with no --repo, touching no client", () => {
    expect(refusalOf(remote, { worktree: "feat", repo: undefined })).toContain(
      "--worktree over --host needs --repo",
    );
  });
});
