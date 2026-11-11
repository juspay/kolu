/**
 * THE DOOR, AND ITS GATE — proven through the real transports on both sides.
 *
 * The thing worth testing here is not that a string compares equal: it is that
 * the MCP `initialize` handshake really round-trips over `StreamableHTTP` when
 * the bearer is right, and really does NOT when it is absent or wrong. So this
 * drives the SDK's own client against the SDK's own server transport over a
 * real loopback socket. A hand-rolled `fetch` of the token check would pass
 * while the transport was wired to the wrong path, the wrong method, or no
 * session at all.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, test } from "vitest";
import { type FleetMcpEndpoint, startFleetMcpEndpoint } from "./mcpEndpoint.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

/** Every endpoint this file started, closed whatever an assertion did — a
 *  listener left bound outlives the test file and the next run picks a
 *  different ephemeral port while this one keeps a socket. */
const started: Array<FleetMcpEndpoint> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((one) => one.close()));
});

/** A real MCP server with nothing on it — the face is somebody else's subject
 *  (`kolu-mcp`'s fleet tests). What this file needs is a server that completes
 *  a handshake. */
const bare = async (
  transport: Transport,
): Promise<{ close: () => Promise<void> }> => {
  const server = new Server(
    { name: "kolu-fleet-test", version: "0.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  await server.connect(transport);
  return { close: () => server.close() };
};

const door = async (): Promise<FleetMcpEndpoint> => {
  const endpoint = await startFleetMcpEndpoint({ serve: bare, log: silent });
  started.push(endpoint);
  return endpoint;
};

/** Connect the SDK client, which IS an `initialize` round trip: it resolves
 *  only after the server has answered with its `serverInfo`. */
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

    // Everything that is not the one route is a 404 — with the RIGHT token, so
    // the answer is about the path and nothing else.
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

    // NO credential at all — loopback is not a gate, and this is the proof of
    // that sentence: another process on this box reaches the socket and still
    // gets nothing.
    await expect(connect(endpoint.url, null)).rejects.toThrow();

    // A WRONG one, of the same length as the real thing, so the refusal cannot
    // be a length check passing for a comparison.
    await expect(connect(endpoint.url, "0".repeat(64))).rejects.toThrow();

    // ... and a wrong one of a DIFFERENT length, which is where a bare
    // `timingSafeEqual` would have thrown instead of answering 401.
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

    // The door is still serving after all three — a refusal is a refusal, not
    // a listener that fell over.
    const client = await connect(endpoint.url, endpoint.token);
    expect(client.getServerVersion()?.name).toBe("kolu-fleet-test");
    await client.close();
  });
});
