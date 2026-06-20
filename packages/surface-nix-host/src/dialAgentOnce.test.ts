/**
 * Unit tests for `dialAgentOnce` — the one-shot CLI dial composition. No ssh, no
 * nix: `HostSession` (the ssh/provision machinery) and `resolveSystem` (the arch
 * probe) are mocked, so the test proves the composition the primitive owns:
 *
 *   - eager drv-map parse + shape guard (missing / non-string-valued / array),
 *     thrown synchronously BEFORE a session is constructed,
 *   - the deferred resolver: arch probe → map lookup → "no <noun> derivation
 *     baked" error,
 *   - the pin → probe → markConnected → leak-safe-destroy lifecycle,
 *   - per-dial session isolation: each dial constructs its OWN unpooled
 *     `HostSession`, so repeated and concurrent same-host/binary dials never
 *     share state or cross-dispose (the F1 regression).
 *
 * The CLI wrappers (kaval-tui / arivu-tui) supply only their binary, env-var
 * name + value, drvNoun, and probe; those thin seams are tested in their own
 * packages.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pin: vi.fn(),
  markConnected: vi.fn(),
  destroy: vi.fn(),
  resolveSystem: vi.fn(),
  // `dialAgentOnce` constructs an UNPOOLED `new HostSession(...)` per dial (see
  // its F1 comment), so the mock is the constructor, not the pool getter. Each
  // `new` call records its `opts` and returns a fresh fake instance.
  HostSession: vi.fn(),
  // Every fake session instance handed out, in construction order — lets the
  // repeated/concurrent-dial tests assert each dial gets its OWN session.
  sessions: [] as Array<{
    opts: unknown;
    pin: ReturnType<typeof vi.fn>;
    markConnected: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("./arch", () => ({ resolveSystem: h.resolveSystem }));
vi.mock("./hostSession", () => ({ HostSession: h.HostSession }));

import { dialAgentOnce } from "./dialAgentOnce";

/** Make `new HostSession(opts)` mint a fresh fake whose `pin()` resolves to
 *  `client`, recording its `opts` so tests can assert per-dial isolation. The
 *  default-export `pin`/`markConnected`/`destroy` mocks alias the LATEST
 *  instance for the single-dial tests; `h.sessions` holds them all. */
function fakeSession(client: unknown) {
  // A `function` (not an arrow) so the mock is `new`-constructable —
  // `dialAgentOnce` does `new HostSession(...)`, and an arrow has no
  // `[[Construct]]` slot. Returning an object makes that object the instance.
  h.HostSession.mockImplementation(function (this: unknown, opts: unknown) {
    const session = {
      opts,
      pin: vi.fn().mockResolvedValue(client),
      markConnected: vi.fn(),
      destroy: vi.fn(),
      onState: () => () => {},
    };
    h.sessions.push(session);
    h.pin = session.pin;
    h.markConnected = session.markConnected;
    h.destroy = session.destroy;
    return session;
  });
  return { onConstruct: h.HostSession };
}

const VALID_MAP = JSON.stringify({
  "x86_64-linux": "/nix/store/aaa-agent.drv",
});

afterEach(() => {
  vi.clearAllMocks();
  h.sessions.length = 0;
});

describe("dialAgentOnce: eager drv-map validation", () => {
  // The static-config check runs eagerly — BEFORE the session is constructed —
  // so a missing/malformed map fails synchronously and never enters the
  // session's retryable "network" classification.
  const base = {
    host: "nix@prod",
    binary: "agent",
    envVar: "AGENT_DRVS_JSON",
    drvNoun: "agent",
    probe: async () => undefined,
  };

  it("fails when the drv map is missing entirely (ran outside the Nix wrapper)", async () => {
    await expect(
      dialAgentOnce({ ...base, agentDrvsJson: undefined }),
    ).rejects.toThrow(/AGENT_DRVS_JSON is not set/);
    expect(h.HostSession).not.toHaveBeenCalled();
  });

  it("names the caller's env var in the error, not a hardcoded literal", async () => {
    await expect(
      dialAgentOnce({
        ...base,
        envVar: "WIDGET_DRVS",
        agentDrvsJson: undefined,
      }),
    ).rejects.toThrow(/WIDGET_DRVS is not set/);
  });

  it("rejects invalid JSON", async () => {
    await expect(
      dialAgentOnce({ ...base, agentDrvsJson: "{not json" }),
    ).rejects.toThrow(/AGENT_DRVS_JSON is not valid JSON/);
    expect(h.HostSession).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-string-valued) map", async () => {
    await expect(
      dialAgentOnce({
        ...base,
        agentDrvsJson: JSON.stringify({ "x86_64-linux": 7 }),
      }),
    ).rejects.toThrow(/must be a JSON object of \{ system: drvPath \} strings/);
    expect(h.HostSession).not.toHaveBeenCalled();
  });

  it("rejects a JSON array (an object whose string values would slip the shape check)", async () => {
    await expect(
      dialAgentOnce({
        ...base,
        agentDrvsJson: JSON.stringify(["/nix/store/x.drv"]),
      }),
    ).rejects.toThrow(/must be a JSON object of \{ system: drvPath \} strings/);
    expect(h.HostSession).not.toHaveBeenCalled();
  });
});

describe("dialAgentOnce: deferred drv resolution (arch probe + lookup)", () => {
  it("ships the host-arch derivation: probe system, then map-lookup", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    fakeSession({});
    await dialAgentOnce({
      host: "nix@prod",
      binary: "agent",
      envVar: "AGENT_DRVS_JSON",
      agentDrvsJson: JSON.stringify({
        "x86_64-linux": "/nix/store/aaa-agent.drv",
        "aarch64-darwin": "/nix/store/bbb-agent.drv",
      }),
      drvNoun: "agent",
      probe: async () => undefined,
    });
    const resolveDrvPath = h.HostSession.mock.calls[0]?.[0]?.resolveDrvPath;
    await expect(resolveDrvPath()).resolves.toBe("/nix/store/aaa-agent.drv");
  });

  it("fails clearly when no derivation is baked for the host's system", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    fakeSession({});
    await dialAgentOnce({
      host: "nix@prod",
      binary: "widget",
      envVar: "WIDGET_DRVS",
      agentDrvsJson: JSON.stringify({
        "aarch64-darwin": "/nix/store/bbb-widget.drv",
      }),
      drvNoun: "widget",
      probe: async () => undefined,
    });
    const resolveDrvPath = h.HostSession.mock.calls[0]?.[0]?.resolveDrvPath;
    // The drvNoun is interpolated into the error — not the env var name.
    await expect(resolveDrvPath()).rejects.toThrow(
      /no widget derivation baked for system=x86_64-linux/,
    );
  });
});

describe("dialAgentOnce: pin → probe → markConnected → dispose", () => {
  it("pins, probes, marks connected, and yields the client", async () => {
    const client = { surface: {} };
    fakeSession(client);
    const probe = vi.fn(async () => "ok");

    const dial = await dialAgentOnce({
      host: "nix@prod",
      binary: "agent",
      envVar: "AGENT_DRVS_JSON",
      agentDrvsJson: VALID_MAP,
      drvNoun: "agent",
      probe,
    });

    expect(h.HostSession).toHaveBeenCalledWith(
      expect.objectContaining({ host: "nix@prod", binary: "agent" }),
    );
    expect(probe).toHaveBeenCalledWith(client);
    expect(h.markConnected).toHaveBeenCalledTimes(1);
    expect(dial.client).toBe(client);

    dial.dispose();
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the session (no leak) when the probe rejects", async () => {
    fakeSession({});
    await expect(
      dialAgentOnce({
        host: "nix@prod",
        binary: "agent",
        envVar: "AGENT_DRVS_JSON",
        agentDrvsJson: VALID_MAP,
        drvNoun: "agent",
        probe: async () => {
          throw new Error("link dead");
        },
      }),
    ).rejects.toThrow(/link dead/);
    expect(h.markConnected).not.toHaveBeenCalled();
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("dialAgentOnce: per-dial session isolation (unpooled)", () => {
  // The F1 regression: `dialAgentOnce` builds a fresh `new HostSession(...)`
  // rather than the pooled `getHostSession`. The pool keys only on
  // `(host, binary)`, never evicts a destroyed session, and lets the first
  // caller's opts win — so a one-shot dial sharing it could be handed a prior
  // dial's destroyed/foreign session. These tests pin "one session per dial".
  const dialArgs = {
    host: "nix@prod",
    binary: "agent",
    envVar: "AGENT_DRVS_JSON",
    agentDrvsJson: VALID_MAP,
    drvNoun: "agent",
    probe: async () => "ok",
  };

  it("constructs a fresh session for a repeated same-host/binary dial after dispose", async () => {
    fakeSession({});

    const first = await dialAgentOnce({ ...dialArgs });
    first.dispose();
    const second = await dialAgentOnce({ ...dialArgs });

    // Two distinct sessions were constructed — not one pooled, reused instance.
    expect(h.HostSession).toHaveBeenCalledTimes(2);
    expect(h.sessions).toHaveLength(2);
    expect(h.sessions[0]).not.toBe(h.sessions[1]);
    // Disposing the first destroyed only the first; the second is untouched and
    // still has its own live teardown.
    expect(h.sessions[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(h.sessions[1]?.destroy).not.toHaveBeenCalled();

    second.dispose();
    expect(h.sessions[1]?.destroy).toHaveBeenCalledTimes(1);
    // The first dial's destroy count did NOT change — no shared session.
    expect(h.sessions[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not let one concurrent dial's dispose tear down the other's link", async () => {
    fakeSession({});

    const [a, b] = await Promise.all([
      dialAgentOnce({ ...dialArgs }),
      dialAgentOnce({ ...dialArgs }),
    ]);

    expect(h.HostSession).toHaveBeenCalledTimes(2);
    expect(h.sessions).toHaveLength(2);
    expect(h.sessions[0]).not.toBe(h.sessions[1]);

    // Disposing one leaves the other's session alive — each `dispose()` only
    // destroys its own session, never the sibling's.
    a.dispose();
    const aSession = h.sessions.find((s) => s.destroy.mock.calls.length > 0);
    const liveSession = h.sessions.find(
      (s) => s.destroy.mock.calls.length === 0,
    );
    expect(aSession).toBeDefined();
    expect(liveSession).toBeDefined();

    b.dispose();
    // After both dispose, each session was destroyed exactly once — no double
    // destroy on a shared instance, no orphaned link.
    expect(h.sessions[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(h.sessions[1]?.destroy).toHaveBeenCalledTimes(1);
  });
});
