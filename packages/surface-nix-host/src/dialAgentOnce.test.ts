/**
 * Unit tests for `dialAgentOnce` — the one-shot CLI dial composition. No ssh, no
 * nix: `getHostSession` (the ssh/provision machinery) and `resolveSystem` (the
 * arch probe) are mocked, so the test proves the composition the primitive owns:
 *
 *   - eager drv-map parse + shape guard (missing / non-string-valued / array),
 *     thrown synchronously BEFORE a session is constructed,
 *   - the deferred resolver: arch probe → map lookup → "no <noun> derivation
 *     baked" error,
 *   - the pin → probe → markConnected → leak-safe-destroy lifecycle.
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
  getHostSession: vi.fn(),
}));

vi.mock("./arch", () => ({ resolveSystem: h.resolveSystem }));
vi.mock("./hostSession", () => ({ getHostSession: h.getHostSession }));

import { dialAgentOnce } from "./dialAgentOnce";

/** A fake `HostSession` whose `pin()` resolves to `client`. */
function fakeSession(client: unknown) {
  const session = {
    pin: h.pin.mockResolvedValue(client),
    markConnected: h.markConnected,
    destroy: h.destroy,
    onState: () => () => {},
  };
  h.getHostSession.mockReturnValue(session);
  return session;
}

const VALID_MAP = JSON.stringify({
  "x86_64-linux": "/nix/store/aaa-agent.drv",
});

afterEach(() => vi.clearAllMocks());

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
    expect(h.getHostSession).not.toHaveBeenCalled();
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
    expect(h.getHostSession).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-string-valued) map", async () => {
    await expect(
      dialAgentOnce({
        ...base,
        agentDrvsJson: JSON.stringify({ "x86_64-linux": 7 }),
      }),
    ).rejects.toThrow(/must be a JSON object of \{ system: drvPath \} strings/);
    expect(h.getHostSession).not.toHaveBeenCalled();
  });

  it("rejects a JSON array (an object whose string values would slip the shape check)", async () => {
    await expect(
      dialAgentOnce({
        ...base,
        agentDrvsJson: JSON.stringify(["/nix/store/x.drv"]),
      }),
    ).rejects.toThrow(/must be a JSON object of \{ system: drvPath \} strings/);
    expect(h.getHostSession).not.toHaveBeenCalled();
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
    const resolveDrvPath = h.getHostSession.mock.calls[0]?.[0]?.resolveDrvPath;
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
    const resolveDrvPath = h.getHostSession.mock.calls[0]?.[0]?.resolveDrvPath;
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

    expect(h.getHostSession).toHaveBeenCalledWith(
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
