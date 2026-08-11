/**
 * The v1 expose map + the NAMED DENIALS, pinned end-to-end:
 *
 *   - the map resolves against the REAL padiSurface spec (a renamed member
 *     fails at resolve, not at an agent's first call);
 *   - the served face advertises EXACTLY the ratified tool + resource set;
 *   - every named denial is (a) a real spec member — a denial naming nothing
 *     is stale — (b) absent from the map, and (c) UNREACHABLE through a live
 *     served face: calling a denied procedure fails as unknown, subscribing a
 *     denied stream fails as unknown (default deny, proven at the wire).
 */

import { padiSurface } from "@kolu/padi/surface";
import {
  resolveExpose,
  serveSurfaceAsMcp,
  type SurfaceClientCallable,
} from "@kolu/surface-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { KOLU_MCP_DENIED, KOLU_MCP_EXPOSE } from "./expose.ts";
import { KOLU_MCP_TOOLS } from "./serve.ts";

/** Every member path the spec declares: top-level primitive keys plus
 *  `<ns>.<verb>` for procedures — the universe a denial must name into. */
function specMembers(): Set<string> {
  const spec = padiSurface.spec;
  const members = new Set<string>([
    ...Object.keys(spec.cells ?? {}),
    ...Object.keys(spec.collections ?? {}),
    ...Object.keys(spec.streams ?? {}),
    ...Object.keys(spec.events ?? {}),
  ]);
  for (const [ns, verbs] of Object.entries(spec.procedures ?? {})) {
    for (const verb of Object.keys(verbs as Record<string, unknown>)) {
      members.add(`${ns}.${verb}`);
    }
  }
  return members;
}

describe("KOLU_MCP_EXPOSE — the ratified v1 map", () => {
  it("resolves against the real padiSurface spec", () => {
    const resolved = resolveExpose(padiSurface.spec, KOLU_MCP_EXPOSE);
    expect(resolved.resources.map((r) => r.key).sort()).toEqual([
      "daemonStatus",
      "identity",
      "status",
      "terminals",
      "urgency",
    ]);
    expect(resolved.tools.map((t) => t.name).sort()).toEqual([
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_create",
      "lifecycle_kill",
      "screen_history",
      "watch_close",
      "watch_open",
    ]);
    // The read/write split is the authz bit the host renders — pin it. The two
    // watch verbs MUTATE: they create and destroy daemon-side state that
    // outlives the call, which is exactly what a standing subscription is.
    const mutating = resolved.tools.filter((t) => t.mutates).map((t) => t.name);
    expect(mutating.sort()).toEqual([
      "lifecycle_create",
      "lifecycle_kill",
      "watch_close",
      "watch_open",
    ]);
  });

  it("the bespoke registry carries the five face-local tools", () => {
    expect(Object.keys(KOLU_MCP_TOOLS).sort()).toEqual([
      "lifecycle_sendInput",
      "screen_text",
      "wait_agentState",
      "wait_outputSettled",
      "watch_next",
    ]);
    // The wait/watch reads + snapshot read are read-only; the send mutates.
    // `watch_next` DRAINS a queue, which is a daemon-side write — but it is
    // declared read-only deliberately: what it mutates is the caller's OWN
    // cursor, and marking it mutating would put a confirmation prompt in front
    // of the one call a supervisor makes in a loop.
    expect(KOLU_MCP_TOOLS.lifecycle_sendInput?.mutates).toBe(true);
    expect(KOLU_MCP_TOOLS.screen_text?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.wait_outputSettled?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.wait_agentState?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.watch_next?.mutates).toBe(false);
  });
});

describe("KOLU_MCP_DENIED — every denial is real, absent, and unreachable", () => {
  it("each denied member exists on the spec (a denial naming nothing is stale)", () => {
    const members = specMembers();
    for (const { member } of KOLU_MCP_DENIED) {
      expect(
        members.has(member),
        `denied member "${member}" is not on padiSurface — stale denial`,
      ).toBe(true);
    }
  });

  it("no denied member appears in the expose map", () => {
    const exposed = new Set(Object.keys(KOLU_MCP_EXPOSE));
    for (const { member } of KOLU_MCP_DENIED) {
      expect(exposed.has(member), `denied member "${member}" is exposed`).toBe(
        false,
      );
    }
  });
});

describe("the served face — default deny at the wire", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  /** Serve the REAL map + tools over an in-memory pair. The client factory
   *  REJECTS by default — none of the asserted surfaces (tools/list,
   *  resources/list, an unknown-tool call, an unknown-resource subscribe) may
   *  ever dial padi.
   *
   *  A caller passes its own factory only to reach a tool body that refuses
   *  BEFORE it touches the client: dispatch dials first, so the default factory
   *  would answer with a link failure instead of the refusal under test. */
  async function servedFace(
    client?: () => SurfaceClientCallable,
  ): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveSurfaceAsMcp({
      surface: padiSurface,
      client:
        client ??
        (() => {
          throw new Error("this assertion must not dial padi");
        }),
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

  it("advertises exactly the ratified tool set — no denied verb, ever", async () => {
    const mcp = await servedFace();
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_create",
      "lifecycle_kill",
      "lifecycle_sendInput",
      "screen_history",
      "screen_text",
      "wait_agentState",
      "wait_outputSettled",
      "watch_close",
      "watch_next",
      "watch_open",
    ]);
  });

  it("advertises exactly the ratified resources; a denied stream is not subscribable", async () => {
    const mcp = await servedFace();
    const { resources } = await mcp.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "surface://cells/identity",
      "surface://cells/status",
      "surface://cells/urgency",
      "surface://collections/daemonStatus",
      "surface://collections/terminals",
    ]);
    // activity — the named denial (no current-value snapshot) — is not exposed.
    await expect(
      mcp.subscribeResource({ uri: "surface://streams/activity" }),
    ).rejects.toThrow(/cannot subscribe to unknown resource/);
    // terminalAttach — the named denial — is not a resource and can't be
    // subscribed into existence.
    await expect(
      mcp.subscribeResource({ uri: "surface://streams/terminalAttach" }),
    ).rejects.toThrow(/cannot subscribe to unknown resource/);
  });

  it("calling a DENIED procedure fails as unknown — for every denied verb", async () => {
    const mcp = await servedFace();
    // Every dotted denial is a procedure — construct the call it would have
    // been exposed as and assert the face refuses it by name.
    const deniedTools = KOLU_MCP_DENIED.filter(({ member }) =>
      member.includes("."),
    ).map(({ member }) => member.replace(".", "_"));
    expect(deniedTools.length).toBeGreaterThan(0);
    for (const name of deniedTools) {
      const result = await mcp.callTool({ name, arguments: {} });
      expect(result.isError, `${name} must be unreachable`).toBe(true);
      expect(String((result.content as { text: string }[])[0]?.text)).toContain(
        "unknown tool",
      );
    }
  });

  it("a sendInput refusal reaches the agent as DATA, across the package seam", async () => {
    // The promise the README, the changelog and docs/mcp.mdx all make is about
    // what comes back OVER THE WIRE — and the path that delivers it spans two
    // packages: this face raises `ToolFailure`, `@kolu/surface-mcp`'s `failFrom`
    // discriminates it by NOMINAL `instanceof` across that boundary, `fail`
    // normalizes the detail, and the SDK serializes the result. Every hop but
    // this assertion is covered by a unit test on one side or the other; the
    // seam itself — the one place a nominal check can silently stop matching —
    // was covered nowhere.
    //
    // The refusal is raised before the handler touches the client, so a stub
    // that is never called is enough to get past dispatch's dial.
    const mcp = await servedFace(() => ({ surface: {} }));

    const res = await mcp.callTool({
      name: "lifecycle_sendInput",
      arguments: {
        id: "00000000-0000-4000-8000-000000000000",
        text: "hi",
        key: "Enter",
      },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ kind: "text-and-key" });
    // The prose still reads as prose, and still carries the adapter's brand.
    expect(String((res.content as { text: string }[])[0]?.text)).toContain(
      "can't be combined",
    );
  });
});
