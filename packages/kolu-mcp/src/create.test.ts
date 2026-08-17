/**
 * `lifecycle_create` — the worktree-capable bespoke create, pinned at both
 * altitudes:
 *
 *   1. the PURE directory gate (`resolveCreateDirectory`) — the CLI's
 *      combination matrix, refused as data;
 *   2. the WIRE — a served face with a recording fake padi proves the
 *      worktree → create → sendInput composition (order, arguments, the
 *      worktree's path becoming the terminal's cwd, `run` typed with its
 *      submit), that a refusal reaches the agent as `structuredContent`,
 *      and that a sequence stopping partway names the survivors as data
 *      (`stopped-partway` + `landed`) instead of erasing them.
 */

import {
  FIRST_MESSAGE_SETTLE_MS,
  padiSurface,
  SubmitRefused,
} from "@kolu/padi/surface";
import {
  serveSurfaceAsMcp,
  type SurfaceClientCallable,
  ToolFailure,
} from "@kolu/surface-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { refuseBlankFields, resolveCreateDirectory } from "./create.ts";
import { KOLU_MCP_EXPOSE } from "./expose.ts";
import { KOLU_MCP_TOOLS } from "./serve.ts";

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

  /** Assert a gate refuses as DATA — the `ToolFailure` an agent reads out of
   *  `structuredContent`, not a sentence it would have to parse. */
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
      // An agent's relative path has no base it chose: this server's cwd is
      // wherever its MCP host spawned it, so resolving against it would cut a
      // worktree in a repository nobody named.
      "a relative repo",
      { repo: "some/repo", worktree: "fix-1" },
      { kind: "relative-repo", repo: "some/repo" },
    ],
  ])("refuses %s as data", (_name, args, detail) => {
    expect(refusalOf(() => resolveCreateDirectory(args))).toEqual(detail);
  });

  // Blankness is its own gate, ahead of the directory read: an empty value is
  // not an argument to interpret, it is a variable that did not expand. The
  // wire refuses `intent: ""` but accepts `"  "`, which is why `intent` — not a
  // directory field at all — is covered here too.
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

  /** A recording fake padi: every surface call lands in `calls` in program
   *  order, and each verb's answer (or failure) is the test's to choose. The
   *  members return EFFECTS, as the real dialed client's procedures do. */
  function fakePadi(behavior?: {
    createFails?: Error;
    sendInputFails?: Error;
    submitInputFails?: unknown;
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
          submitInput: (input: unknown) =>
            Effect.suspend(() => {
              calls.push({ verb: "lifecycle.submitInput", input });
              return behavior?.submitInputFails !== undefined
                ? Effect.fail(behavior.submitInputFails)
                : Effect.succeed({ readyAfterMs: 12, settledAfterMs: 34 });
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
      surface: padiSurface,
      client: () => client,
      expose: KOLU_MCP_EXPOSE,
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
    // The worktree IS the cwd; the tool-only fields never reach the wire.
    expect(calls[1]!.input).toEqual({
      placement: { kind: "toplevel" },
      cwd: "/r/.worktrees/fix-1",
      intent: "fix #1",
    });
    // …and the command is TYPED, with its submit, never a spawn argv.
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
    // The placement rides through to the wire verbatim — this face forwards the
    // agent's stated intent, it does not re-decide it.
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
    // The rule this PR exists for, at the face an agent actually calls. The
    // refusal is the shared wire schema's, so the sentence an agent gets here is
    // byte-identical to the one padi would have sent — and it arrives before any
    // verb runs, so a driver's retry has nothing to clean up.
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
    // A model that invents `{"kind":"split"}` is the same failure as omitting
    // the field — it did not learn the vocabulary — so it gets the same answer
    // rather than a schema-shaped one it would have to decode.
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
    // The mirror of the case above: with no worktree ahead of it, a failing
    // `lifecycle.create` has produced nothing. Reporting "these already exist"
    // over an empty list would be a false alarm, and `stopped-partway`'s
    // documented recovery ("act on what landed") would name nothing.
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

  it("run + message is create → sendInput → submitInput, the brief as ONE paste", async () => {
    // The whole point of the addition: spawn and dispatch in one call. The
    // ORDER is the contract — the brief goes through `submitInput` (which waits
    // for the prompt) after the run line, never as a second raw write.
    const { calls, client } = fakePadi();
    const mcp = await servedFace(client);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        placement: { kind: "toplevel" },
        run: "claude",
        message: "read /tmp/brief.md\nand take it end-to-end",
      },
    });

    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent).toMatchObject({
      id: ID,
      ran: "claude",
      briefed: "read /tmp/brief.md\nand take it end-to-end",
    });
    expect(calls.map((c) => c.verb)).toEqual([
      "lifecycle.create",
      "lifecycle.sendInput",
      "lifecycle.submitInput",
    ]);
    const brief = calls[2]!.input as { data: string; settleMs: number };
    // Bracketed-paste, because a multiline brief typed raw is N submits — and
    // the WIDER window, because a booting agent is silent before its first paint.
    expect(brief.data).toBe(
      "\x1b[200~read /tmp/brief.md\nand take it end-to-end\x1b[201~",
    );
    expect(brief.settleMs).toBe(FIRST_MESSAGE_SETTLE_MS);
  });

  // ── A brief that did not land: WHICH recovery the report names ──────────
  // The dangerous half of `stopped-partway`. "That agent is live and idle,
  // dispatch it" is right for a refusal that typed nothing and harmful for one
  // that left the brief staged in the input box: obeying it types the brief a
  // second time and the agent reads it twice. The sentence is therefore read off
  // padi's own `submitLeftTextStaged`, and these cases are what stops it drifting
  // back into a constant.
  const briefFailing = async (
    phase: "ready" | "settle",
    reason: "busy" | "gone",
  ) => {
    const { client } = fakePadi({
      submitInputFails: new SubmitRefused({
        id: ID,
        phase,
        reason,
        waitedMs: 9,
      }),
    });
    const mcp = await servedFace(client);
    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        placement: { kind: "toplevel" },
        run: "claude",
        message: "read /tmp/brief.md and take it end-to-end",
      },
    });
    expect(res.isError).toBe(true);
    return {
      text: String((res.content as { text: string }[])[0]?.text),
      detail: res.structuredContent as Record<string, unknown>,
    };
  };

  it("a settle-phase refusal reports the brief as STAGED — Enter, never a re-send", async () => {
    const { text, detail } = await briefFailing("settle", "busy");
    expect(detail).toMatchObject({
      kind: "stopped-partway",
      notDelivered: "read /tmp/brief.md and take it end-to-end",
      staged: true,
    });
    expect(text).toContain("typed but NOT submitted");
    expect(text).toContain('key: "Enter"');
    // The harmful instruction must be ABSENT, not merely outweighed by a
    // caveat — a report carrying both can be obeyed wrongly.
    expect(text).not.toContain("submit: true");
  });

  it("a ready-phase refusal reports an empty box — dispatch it, nothing was typed", async () => {
    const { text, detail } = await briefFailing("ready", "busy");
    expect(detail).toMatchObject({ staged: false });
    expect(text).toContain("NOTHING was typed");
    expect(text).toContain("submit: true");
  });

  it("a terminal that DIED mid-delivery is not staged — there is no box left", async () => {
    // The finding that reproduced: `phase === "settle"` alone would answer
    // `true` here, sending a driver to press Enter into a terminal that is gone
    // while withholding the re-dispatch that would actually deliver the message.
    const { detail } = await briefFailing("settle", "gone");
    expect(detail).toMatchObject({ staged: false });
  });
});
