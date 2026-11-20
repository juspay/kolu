import { padiSurface } from "@kolu/padi-client/surface";
import {
  type SurfaceClientCallable,
  serveSurfaceAsMcp,
  ToolFailure,
} from "@kolu/surface-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { refuseBlankFields, resolveCreateDirectory } from "./create.ts";
import { KOLU_MCP_EXPOSE } from "./expose.ts";
import { KOLU_MCP_TOOLS } from "./tools.ts";

const ID = "00000000-0000-4000-8000-000000000000";
const PARENT_ID = "11111111-1111-4111-8111-111111111111";

describe("resolveCreateDirectory — the directory gate matrix", () => {
  it("no directory fields → open, nowhere in particular", () => {
    expect(resolveCreateDirectory({})).toEqual({
      kind: "open",
      cwd: undefined,
    });
  });

  it("cwd alone → open there", () => {
    expect(resolveCreateDirectory({ cwd: "/somewhere" })).toEqual({
      kind: "open",
      cwd: "/somewhere",
    });
  });

  it("repo + worktree → the worktree arm", () => {
    expect(resolveCreateDirectory({ repo: "/r", worktree: "fix-1" })).toEqual({
      kind: "worktree",
      repo: "/r",
      name: "fix-1",
    });
  });

  const refusalOf = (run: () => unknown): unknown => {
    try {
      run();
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      return (e as ToolFailure).detail;
    }
    return expect.unreachable("must refuse");
  };

  it.each([
    [
      "repo without worktree",
      { repo: "/r" },
      { kind: "repo-without-worktree" },
    ],
    [
      "worktree without repo",
      { worktree: "fix-1" },
      { kind: "worktree-needs-repo" },
    ],
    [
      "cwd and worktree together",
      { cwd: "/x", repo: "/r", worktree: "fix-1" },
      { kind: "cwd-and-worktree" },
    ],
    [
      "a relative repo",
      { repo: "some/repo", worktree: "fix-1" },
      { kind: "relative-repo", repo: "some/repo" },
    ],
  ])("refuses %s as data", (_name, args, detail) => {
    expect(refusalOf(() => resolveCreateDirectory(args))).toEqual(detail);
  });

  it.each([
    ["worktree", { repo: "/r", worktree: "  " }],
    ["cwd", { cwd: "" }],
    ["run", { run: " " }],
    ["intent", { intent: "  " }],
    ["repo", { repo: " ", worktree: "fix-1" }],
  ])("refuses a blank `%s` as data", (field, args) => {
    expect(refusalOf(() => refuseBlankFields(args as never))).toEqual({
      kind: "blank-field",
      field,
    });
  });
});

describe("lifecycle_create at the wire — the CLI composition, one tool call", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  function fakePadi(behavior?: {
    createFails?: Error;
    sendInputFails?: Error;
  }) {
    const calls: { verb: string; input: unknown }[] = [];
    const client = {
      surface: {
        git: {
          worktreeCreate: (input: { repoPath: string; name: string }) =>
            Effect.sync(() => {
              calls.push({ verb: "git.worktreeCreate", input });
              return {
                path: `${input.repoPath}/.worktrees/${input.name}`,
                branch: input.name,
              };
            }),
        },
        lifecycle: {
          create: (input: unknown) =>
            Effect.suspend(() => {
              calls.push({ verb: "lifecycle.create", input });
              return behavior?.createFails !== undefined
                ? Effect.fail(behavior.createFails)
                : Effect.succeed({ id: ID, pid: 4242 });
            }),
          sendInput: (input: unknown) =>
            Effect.suspend(() => {
              calls.push({ verb: "lifecycle.sendInput", input });
              return behavior?.sendInputFails !== undefined
                ? Effect.fail(behavior.sendInputFails)
                : Effect.void;
            }),
        },
      },
    } as unknown as SurfaceClientCallable;
    return { calls, client };
  }

  async function servedFace(client: SurfaceClientCallable): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveSurfaceAsMcp({
      core: { surface: padiSurface, expose: KOLU_MCP_EXPOSE },
      client: () => ({ core: client }),
      tools: KOLU_MCP_TOOLS,
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  it("repo + worktree + run compose worktree → create → sendInput, worktree path as cwd", async () => {
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        placement: { kind: "toplevel" },
        repo: "/r",
        worktree: "fix-1",
        run: "claude",
        intent: "fix #1",
      },
    });

    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent).toEqual({
      id: ID,
      pid: 4242,
      worktree: { path: "/r/.worktrees/fix-1", branch: "fix-1" },
      ran: "claude",
    });
    expect(calls.map((c) => c.verb)).toEqual([
      "git.worktreeCreate",
      "lifecycle.create",
      "lifecycle.sendInput",
    ]);
    expect(calls[0]!.input).toEqual({ repoPath: "/r", name: "fix-1" });
    expect(calls[1]!.input).toEqual({
      placement: { kind: "toplevel" },
      cwd: "/r/.worktrees/fix-1",
      intent: "fix #1",
    });
    expect(calls[2]!.input).toEqual({ id: ID, data: "claude\r" });
  });

  it("a create carrying ONLY its placement works — nothing else is needed", async () => {
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "toplevel" } },
    });

    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent).toEqual({ id: ID, pid: 4242 });
    expect(calls.map((c) => c.verb)).toEqual(["lifecycle.create"]);
    expect(calls[0]!.input).toEqual({ placement: { kind: "toplevel" } });
  });

  it("a split names its parent inside the placement, and that is all it needs", async () => {
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "child-of", parentId: PARENT_ID } },
    });

    expect(res.isError ?? false).toBe(false);
    expect(calls[0]!.input).toEqual({
      placement: { kind: "child-of", parentId: PARENT_ID },
    });
  });

  it("REFUSES a create with no placement, naming both spellings — nothing dials padi", async () => {
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { intent: "review the PR" },
    });

    expect(res.isError).toBe(true);
    const text = String((res.content as { text: string }[])[0]?.text);
    expect(text).toContain('{"kind":"toplevel"}');
    expect(text).toContain('{"kind":"child-of","parentId":"<terminal id>"}');
    expect(text).toContain("there is no default");
    expect(calls).toEqual([]);
  });

  it("REFUSES a placement that names a third arm, with the same sentence", async () => {
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "split", parentId: PARENT_ID } },
    });

    expect(res.isError).toBe(true);
    expect(String((res.content as { text: string }[])[0]?.text)).toContain(
      '{"kind":"child-of","parentId":"<terminal id>"}',
    );
    expect(calls).toEqual([]);
  });

  it("REFUSES a `child-of` with no parentId — half a statement is not one", async () => {
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "child-of" } },
    });

    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("a directory refusal reaches the agent as DATA, before anything dials padi", async () => {
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "toplevel" }, worktree: "fix-1" },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ kind: "worktree-needs-repo" });
    expect(calls).toEqual([]);
  });

  it("a create that fails AFTER the worktree landed names the survivor as data", async () => {
    const { client } = fakePadi({
      createFails: new Error("terminal budget exhausted"),
    });
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        placement: { kind: "toplevel" },
        repo: "/r",
        worktree: "fix-1",
        run: "claude",
      },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({
      kind: "stopped-partway",
      landed: {
        worktree: { path: "/r/.worktrees/fix-1", branch: "fix-1" },
      },
    });
    const text = String((res.content as { text: string }[])[0]?.text);
    expect(text).toContain("terminal budget exhausted");
    expect(text).toContain("NOT rolled back");
    expect(text).toContain("/r/.worktrees/fix-1");
  });

  it("a create with NOTHING behind it fails as the daemon's own error, not as a survivors report", async () => {
    const { client } = fakePadi({
      createFails: new Error("terminal budget exhausted"),
    });
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { placement: { kind: "toplevel" } },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBe(undefined);
    const text = String((res.content as { text: string }[])[0]?.text);
    expect(text).toContain("terminal budget exhausted");
    expect(text).not.toContain("PARTWAY");
  });

  it("a sendInput that fails AFTER the terminal landed names id + worktree + the untyped command", async () => {
    const { client } = fakePadi({
      sendInputFails: new Error("pty write failed"),
    });
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        placement: { kind: "toplevel" },
        repo: "/r",
        worktree: "fix-1",
        run: "claude",
      },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({
      kind: "stopped-partway",
      landed: {
        id: ID,
        worktree: { path: "/r/.worktrees/fix-1", branch: "fix-1" },
      },
      notTyped: "claude",
    });
    const text = String((res.content as { text: string }[])[0]?.text);
    expect(text).toContain("bare shell prompt");
  });
});
