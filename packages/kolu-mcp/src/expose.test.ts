import { padiSurface } from "@kolu/padi-client/surface";
import {
  resolveExpose,
  type RootedSurfaceClients,
  serveSurfaceAsMcp,
} from "@kolu/surface-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { KOLU_MCP_DENIED, KOLU_MCP_EXPOSE } from "./expose.ts";
import { KOLU_MCP_TOOLS } from "./tools.ts";

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
    const resolved = resolveExpose(
      padiSurface.spec,
      KOLU_MCP_EXPOSE,
      undefined,
    );
    expect(resolved.resources.map((r) => r.key).sort()).toEqual([
      "daemonStatus",
      "identity",
      "status",
      "terminals",
      "urgency",
    ]);
    expect(resolved.tools.map((t) => t.name).sort()).toEqual([
      "diagnostics_read",
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_kill",
      "screen_history",
      "watch_close",
    ]);
    const mutating = resolved.tools.filter((t) => t.mutates).map((t) => t.name);
    expect(mutating.sort()).toEqual(["lifecycle_kill", "watch_close"]);
  });

  it("the bespoke registry carries the nine face-local tools", () => {
    expect(Object.keys(KOLU_MCP_TOOLS).sort()).toEqual([
      "agent_say",
      "lifecycle_create",
      "lifecycle_sendInput",
      "screen_image",
      "screen_text",
      "wait_agentState",
      "wait_outputSettled",
      "watch_next",
      "watch_open",
    ]);
    expect(KOLU_MCP_TOOLS.lifecycle_create?.mutates).toBe(true);
    expect(KOLU_MCP_TOOLS.lifecycle_sendInput?.mutates).toBe(true);
    expect(KOLU_MCP_TOOLS.agent_say?.mutates).toBe(true);
    expect(KOLU_MCP_TOOLS.screen_text?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.screen_image?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.wait_outputSettled?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.wait_agentState?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.watch_next?.mutates).toBe(false);
    expect(KOLU_MCP_TOOLS.watch_open?.mutates).toBe(true);
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

  it("no denied member is served under its own wire name by a bespoke tool", () => {
    for (const { member } of KOLU_MCP_DENIED) {
      const wireName = member.replace(".", "_");
      expect(
        wireName in KOLU_MCP_TOOLS,
        `denied member "${member}" is served by bespoke tool "${wireName}"`,
      ).toBe(false);
    }
  });

  it("each SUPERSEDED procedure is absent from the map and served by its same-named bespoke tool", () => {
    for (const member of [
      "screen.text",
      "lifecycle.sendInput",
      "lifecycle.create",
      "watch.open",
    ]) {
      expect(member in KOLU_MCP_EXPOSE, `${member} is exposed raw`).toBe(false);
      expect(
        member.replace(".", "_") in KOLU_MCP_TOOLS,
        `${member} has no bespoke tool`,
      ).toBe(true);
    }
  });
});

describe("the served face — default deny at the wire", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  async function servedFace(
    client?: () => RootedSurfaceClients,
  ): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveSurfaceAsMcp({
      core: { surface: padiSurface, expose: KOLU_MCP_EXPOSE },
      client:
        client ??
        (() => {
          throw new Error("this assertion must not dial padi");
        }),
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
      "agent_say",
      "diagnostics_read",
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_create",
      "lifecycle_kill",
      "lifecycle_sendInput",
      "screen_history",
      "screen_image",
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
    await expect(
      mcp.subscribeResource({ uri: "surface://streams/activity" }),
    ).rejects.toThrow(/cannot subscribe to unknown resource/);
    await expect(
      mcp.subscribeResource({ uri: "surface://streams/terminalAttach" }),
    ).rejects.toThrow(/cannot subscribe to unknown resource/);
  });

  it("calling a DENIED procedure fails as unknown — for every denied verb", async () => {
    const mcp = await servedFace();
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
    const mcp = await servedFace(() => ({ core: { surface: {} } }));

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
    expect(String((res.content as { text: string }[])[0]?.text)).toContain(
      "can't be combined",
    );
  });
});
