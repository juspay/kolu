/**
 * `POST /api/reconnect` route-level tests — the recovery path's three branches.
 *
 * The route mutates host-session state (`session.reconnect()`), so each guard
 * needs a test, not a "watched it work" claim:
 *
 *   - unknown host  → 404, no rearm
 *   - cross-site Origin → 403, no rearm (CSWSH gate; the side effect must NOT run)
 *   - allowed Origin + known host → 200 and the session is re-armed
 *
 * Driven through a real Hono app with `registerReconnectRoute` wired exactly as
 * `main.ts` does, over a stub registry — so the gate / 404 / rearm wiring is the
 * thing under test, not a re-implementation of it.
 */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  type ReconnectRegistry,
  registerReconnectRoute,
} from "./reconnectRoute.ts";

/** A stub registry over a fixed host set. Records `reconnect()` calls so a test
 *  can assert the side effect ran (or, for a rejected request, did NOT). */
function stubRegistry(hosts: string[]) {
  const reconnected: string[] = [];
  const sessions = new Map(
    hosts.map((h) => [h, { reconnect: () => reconnected.push(h) }]),
  );
  const registry: ReconnectRegistry = {
    has: (host) => sessions.has(host),
    getSession: (host) => sessions.get(host),
  };
  return { registry, reconnected };
}

function appFor(registry: ReconnectRegistry, allowedOrigins: string[] = []) {
  const app = new Hono();
  registerReconnectRoute(app, { registry, allowedOrigins, log: () => {} });
  return app;
}

describe("POST /api/reconnect", () => {
  it("404s an unknown host without re-arming anything", async () => {
    const { registry, reconnected } = stubRegistry(["box-a"]);
    const res = await appFor(registry).request("/api/reconnect?host=ghost", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(reconnected).toEqual([]);
  });

  it("404s a missing host param", async () => {
    const { registry, reconnected } = stubRegistry(["box-a"]);
    const res = await appFor(registry).request("/api/reconnect", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    expect(reconnected).toEqual([]);
  });

  it("403s a cross-site Origin and never re-arms (CSWSH gate)", async () => {
    const { registry, reconnected } = stubRegistry(["box-a"]);
    // Origin differs from Host → cross-site, not in the allowlist → rejected
    // BEFORE the host is even looked up. A known host must NOT save it.
    const res = await appFor(registry).request("/api/reconnect?host=box-a", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "fleet.local" },
    });
    expect(res.status).toBe(403);
    expect(reconnected).toEqual([]);
  });

  it("re-arms a known host for a same-origin request", async () => {
    const { registry, reconnected } = stubRegistry(["box-a"]);
    // Origin host matches the request Host → same-origin → passes the gate.
    const res = await appFor(registry).request("/api/reconnect?host=box-a", {
      method: "POST",
      headers: { origin: "https://fleet.local", host: "fleet.local" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(reconnected).toEqual(["box-a"]);
  });

  it("re-arms a known host for an allow-listed cross-site Origin", async () => {
    const { registry, reconnected } = stubRegistry(["box-a"]);
    const res = await appFor(registry, ["https://proxy.example"]).request(
      "/api/reconnect?host=box-a",
      {
        method: "POST",
        headers: { origin: "https://proxy.example", host: "fleet.local" },
      },
    );
    expect(res.status).toBe(200);
    expect(reconnected).toEqual(["box-a"]);
  });

  it("crashes fail-loud when a known host has no session (no silent ok)", async () => {
    // `has` says yes but `getSession` returns undefined — the invariant break the
    // route must surface as a throw, never a quiet `{ ok: true }`.
    const registry: ReconnectRegistry = {
      has: () => true,
      getSession: () => undefined,
    };
    const onError = vi.fn();
    const app = new Hono();
    app.onError((err) => {
      onError(err);
      return new Response("boom", { status: 500 });
    });
    registerReconnectRoute(app, {
      registry,
      allowedOrigins: [],
      log: () => {},
    });
    const res = await app.request("/api/reconnect?host=box-a", {
      method: "POST",
    });
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });
});
