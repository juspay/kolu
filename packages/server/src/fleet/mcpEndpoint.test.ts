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
 *
 * It is also where the ONE-CLIENT defect is pinned. A stateful transport
 * answers exactly one `initialize`; a door that minted one at boot served the
 * first MCP client it ever saw and answered every later one `400 Server
 * already initialized` — so an adapter respawn, which is the case the
 * conductor's corpse arm exists for, left the replacement conversation with
 * no tools for the life of kolu-server. Two tests below say that in the only
 * way that catches it: a second `initialize` on the same endpoint, and two
 * clients at once.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type FleetMcpEndpoint, startFleetMcpEndpoint } from "./mcpEndpoint.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

/** Every endpoint this file started, closed whatever an assertion did — a
 *  listener left bound outlives the test file and the next run picks a
 *  different ephemeral port while this one keeps a socket. */
const started: Array<FleetMcpEndpoint> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((one) => one.close()));
  faces.splice(0, faces.length);
});

/** Every face the door served, in the order it served them. The count is the
 *  assertion that matters: ONE PER SESSION, because a stateful transport is
 *  one client's and the registry behind it is one client's fleet. */
const faces: Array<{ closed: boolean }> = [];

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

  test("answers a SECOND initialize on the same endpoint — an adapter respawn", async () => {
    const endpoint = await door();
    const first = await connect(endpoint.url, endpoint.token);
    expect(first.getServerVersion()?.name).toBe("kolu-fleet-test");
    await first.close();

    // The SDK client's `close` does NOT send the protocol's `DELETE`, so this
    // is the respawn exactly as it happens: a session the door still holds and
    // a brand-new client saying `initialize` at the same URL. A door with ONE
    // transport answers this `400 Invalid Request: Server already initialized`
    // and the replacement conversation has no tools, forever.
    const second = await connect(endpoint.url, endpoint.token);
    expect(second.getServerVersion()?.name).toBe("kolu-fleet-test");
    // Round-trips a real request, not just the handshake: a session that was
    // registered under the wrong id would answer `initialize` and then 404.
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

    // Each still answers AFTER the other has connected — the second handshake
    // did not take the first's transport away from it.
    await expect(one.ping()).resolves.toEqual({});
    await expect(two.ping()).resolves.toEqual({});

    // Two faces, not one shared one: the watch registry behind a face is a
    // client's own fleet, and a shared one would let either close the other's
    // watch by name.
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

    // The protocol's own session termination. Without the drop-on-close, every
    // adapter this process ever spawned would leave a face behind holding
    // fleet subscriptions nobody reads.
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

    // 404 is the word the SDK's transport uses for a session it does not hold,
    // and an MCP client's rule on it is to initialize again — which this door
    // will then answer.
    const stale = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        ...headers,
        "mcp-session-id": "not-a-session-this-door-minted",
      },
      body: ping,
    });
    expect(stale.status).toBe(404);

    // A ping with no session named is not a handshake, and the door does not
    // invent a session for it — the proof the conductor runs demands an
    // answer that means "I will serve you", and this is not one.
    const unnamed = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: ping,
    });
    expect(unnamed.status).toBe(400);

    // Neither built a face: a door that served one per stray request would
    // leak a fleet subscription to anything that knocked with the token.
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
