import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type FleetMcpEndpoint, startFleetMcpEndpoint } from "./mcpEndpoint.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

const started: Array<FleetMcpEndpoint> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((one) => one.close()));
  faces.splice(0, faces.length);
});

const faces: Array<{ closed: boolean }> = [];

const bare = async (
  transport: Transport,
): Promise<{ close: () => Promise<void> }> => {
  const server = new Server(
    { name: "kolu-fleet-test", version: "0.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  await server.connect(transport);
  const face = { closed: false };
  faces.push(face);
  return {
    close: async () => {
      face.closed = true;
      await server.close();
    },
  };
};

const door = async (): Promise<FleetMcpEndpoint> => {
  const endpoint = await startFleetMcpEndpoint({ serve: bare, log: silent });
  started.push(endpoint);
  return endpoint;
};

const connect = async (url: string, bearer: string | null): Promise<Client> => {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit:
        bearer === null
          ? {}
          : { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  return client;
};

describe("the fleet MCP door", () => {
  test("binds loopback on an ephemeral port, at /mcp and nowhere else", async () => {
    const endpoint = await door();
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(endpoint.token).toMatch(/^[0-9a-f]{64}$/);

    const elsewhere = await fetch(endpoint.url.replace("/mcp", "/"), {
      headers: { Authorization: `Bearer ${endpoint.token}` },
    });
    expect(elsewhere.status).toBe(404);
  });

  test("answers an initialize round trip when the bearer is right", async () => {
    const endpoint = await door();
    const client = await connect(endpoint.url, endpoint.token);
    expect(client.getServerVersion()).toEqual({
      name: "kolu-fleet-test",
      version: "0.0.0",
    });
    await client.close();
  });

  test("refuses a request with no token, and one with the wrong token", async () => {
    const endpoint = await door();

    await expect(connect(endpoint.url, null)).rejects.toThrow();

    await expect(connect(endpoint.url, "0".repeat(64))).rejects.toThrow();

    const short = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer nope",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(short.status).toBe(401);
    expect(short.headers.get("www-authenticate")).toBe("Bearer");

    const client = await connect(endpoint.url, endpoint.token);
    expect(client.getServerVersion()?.name).toBe("kolu-fleet-test");
    await client.close();
  });

  test("answers a SECOND initialize on the same endpoint — an adapter respawn", async () => {
    const endpoint = await door();
    const first = await connect(endpoint.url, endpoint.token);
    expect(first.getServerVersion()?.name).toBe("kolu-fleet-test");
    await first.close();

    const second = await connect(endpoint.url, endpoint.token);
    expect(second.getServerVersion()?.name).toBe("kolu-fleet-test");
    await expect(second.ping()).resolves.toEqual({});
    await second.close();

    expect(faces).toHaveLength(2);
  });

  test("serves two clients AT ONCE, each on its own face", async () => {
    const endpoint = await door();
    const [one, two] = await Promise.all([
      connect(endpoint.url, endpoint.token),
      connect(endpoint.url, endpoint.token),
    ]);

    await expect(one.ping()).resolves.toEqual({});
    await expect(two.ping()).resolves.toEqual({});

    expect(faces).toHaveLength(2);

    await Promise.all([one.close(), two.close()]);
  });

  test("a terminated session takes its face with it, and the door keeps serving", async () => {
    const endpoint = await door();
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.token}` },
      },
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);

    await transport.terminateSession();
    await vi.waitFor(() => {
      expect(faces[0]?.closed).toBe(true);
    });
    await client.close();

    const next = await connect(endpoint.url, endpoint.token);
    await expect(next.ping()).resolves.toEqual({});
    await next.close();
  });

  test("refuses a session it does not hold, and a first word that is not `initialize`", async () => {
    const endpoint = await door();
    const headers = {
      Authorization: `Bearer ${endpoint.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

    const stale = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        ...headers,
        "mcp-session-id": "not-a-session-this-door-minted",
      },
      body: ping,
    });
    expect(stale.status).toBe(404);

    const unnamed = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: ping,
    });
    expect(unnamed.status).toBe(400);

    expect(faces).toHaveLength(0);
  });

  test("closing the door closes every live session's face", async () => {
    const endpoint = await door();
    await Promise.all([
      connect(endpoint.url, endpoint.token),
      connect(endpoint.url, endpoint.token),
    ]);
    expect(faces).toHaveLength(2);

    await endpoint.close();
    expect(faces.map((one) => one.closed)).toEqual([true, true]);
  });
});
