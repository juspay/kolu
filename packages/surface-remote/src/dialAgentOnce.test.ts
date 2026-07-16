/**
 * Unit tests for `dialAgentOnce` — the one-shot CLI dial composition. No ssh, no
 * nix: `makeSession` (the reconnect loop) + `sshConnector` (the ssh/provision
 * transport) and `resolveSystem` (the arch probe) are mocked, so the test proves the
 * composition the primitive owns:
 *
 *   - eager drv-map parse + shape guard (missing / non-string-valued / array),
 *     thrown synchronously BEFORE a session is constructed,
 *   - the deferred resolver: arch probe → map lookup → "no <noun> derivation
 *     baked" error (now handed to `sshConnector` as `resolveDrvPath`),
 *   - the pin → probe → markConnected → leak-safe-destroy lifecycle,
 *   - per-dial session isolation: each dial builds its OWN `makeSession`
 *     (no shared pool — S10 deleted it), so repeated and concurrent same-host/binary
 *     dials never share state or cross-dispose (the F1 regression).
 *
 * The CLI wrappers (kaval-tui / pulam-tui) supply only their binary, env-var
 * name + value, drvNoun, fatalPrefix, and probe; those thin seams are tested in
 * their own packages.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  markConnected: vi.fn(),
  destroy: vi.fn(),
  resolveSystem: vi.fn(),
  // `dialAgentOnce` composes `makeSession({ connectOnce: sshConnector(opts) })` per
  // dial (S10 deleted the pool). `sshConnector` captures its transport opts (host /
  // binary / extraArgs / resolveDrvPath); `makeSession` mints a fresh fake session.
  sshConnector: vi.fn(),
  makeSession: vi.fn(),
  // Every fake session instance handed out, in construction order — lets the
  // repeated/concurrent-dial tests assert each dial gets its OWN session.
  sessions: [] as Array<{
    opts: unknown;
    pin: ReturnType<typeof vi.fn>;
    markConnected: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  // The `SessionState` the fake session's `currentState()` returns — the failure-
  // surfacing path reads the `source === "remote"` entries of the unified `log` off it.
  // Default: a benign "connecting" state (no agent-quit), so the raw probe error is
  // preserved; a test swaps in a stderr tail.
  state: {
    phase: "connecting",
    log: [] as Array<{ source: "local" | "remote"; line: string }>,
  },
}));

vi.mock("./arch", () => ({ resolveSystem: h.resolveSystem }));
vi.mock("./session", () => ({ makeSession: h.makeSession }));
vi.mock("./sshConnector", () => ({ sshConnector: h.sshConnector }));

import { dialAgentOnce } from "./dialAgentOnce";

/** Wire the mocks: `sshConnector(opts)` records its transport opts and returns a
 *  dummy connector; `makeSession(opts)` mints a fresh fake session whose `pin()`
 *  resolves to `client` and whose `onState` delivers `h.state`. The default-export
 *  `markConnected`/`destroy` mocks alias the LATEST instance for the single-dial
 *  tests; `h.sessions` holds them all. */
function fakeSession(client: unknown) {
  h.sshConnector.mockImplementation((opts: unknown) => {
    // The returned connector is never invoked (makeSession is mocked); it only has
    // to be a value makeSession's `connectOnce` slot accepts.
    const connector = async (): Promise<never> => {
      throw new Error("mock connector should not run");
    };
    (connector as unknown as { opts: unknown }).opts = opts;
    return connector;
  });
  h.makeSession.mockImplementation((opts: unknown) => {
    const session = {
      opts,
      pin: vi.fn().mockResolvedValue(client),
      markConnected: vi.fn(),
      destroy: vi.fn(),
      // The synchronous liveness point-read `dialAgentOnce` reads the remote-origin log
      // tail off on its failure path (the real cell-backed `currentState()`).
      currentState: () => h.state,
      onState: (cb: (s: unknown) => void) => {
        cb(h.state);
        return () => {};
      },
      isDestroyed: () => false,
    };
    h.sessions.push(session);
    h.markConnected = session.markConnected;
    h.destroy = session.destroy;
    return session;
  });
  return { onConstruct: h.makeSession };
}

/** The transport opts `dialAgentOnce` hands to `sshConnector` for the first dial. */
const sshOpts = () => h.sshConnector.mock.calls[0]?.[0];

const VALID_MAP = JSON.stringify({
  "x86_64-linux": "/nix/store/aaa-agent.drv",
});

afterEach(() => {
  vi.clearAllMocks();
  h.sessions.length = 0;
  h.state = {
    phase: "connecting",
    log: [],
  };
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
    fatalPrefix: "agent:",
    probe: async () => undefined,
  };

  it("fails when the drv map is missing entirely (ran outside the Nix wrapper)", async () => {
    await expect(
      dialAgentOnce({ ...base, agentDrvsJson: undefined }),
    ).rejects.toThrow(/AGENT_DRVS_JSON is not set/);
    expect(h.makeSession).not.toHaveBeenCalled();
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
    expect(h.makeSession).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-string-valued) map", async () => {
    await expect(
      dialAgentOnce({
        ...base,
        agentDrvsJson: JSON.stringify({ "x86_64-linux": 7 }),
      }),
    ).rejects.toThrow(/must be a JSON object of \{ system: drvPath \} strings/);
    expect(h.makeSession).not.toHaveBeenCalled();
  });

  it("rejects a JSON array (an object whose string values would slip the shape check)", async () => {
    await expect(
      dialAgentOnce({
        ...base,
        agentDrvsJson: JSON.stringify(["/nix/store/x.drv"]),
      }),
    ).rejects.toThrow(/must be a JSON object of \{ system: drvPath \} strings/);
    expect(h.makeSession).not.toHaveBeenCalled();
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
      fatalPrefix: "agent:",
      probe: async () => undefined,
    });
    const resolveDrvPath = sshOpts()?.resolveDrvPath;
    await expect(resolveDrvPath()).resolves.toBe("/nix/store/aaa-agent.drv");
  });

  it("threads extraArgs to the connector (the --kaval passthrough)", async () => {
    fakeSession({});
    await dialAgentOnce({
      host: "nix@prod",
      binary: "pulam",
      envVar: "AGENT_DRVS_JSON",
      agentDrvsJson: VALID_MAP,
      drvNoun: "pulam",
      fatalPrefix: "pulam:",
      probe: async () => undefined,
      extraArgs: ["--kaval", "/run/user/1000/kaval-7692/pty-host.sock"],
    });
    expect(sshOpts()).toMatchObject({
      extraArgs: ["--kaval", "/run/user/1000/kaval-7692/pty-host.sock"],
    });
  });

  it("leaves extraArgs undefined when none given (discover-by-default)", async () => {
    fakeSession({});
    await dialAgentOnce({
      host: "nix@prod",
      binary: "pulam",
      envVar: "AGENT_DRVS_JSON",
      agentDrvsJson: VALID_MAP,
      drvNoun: "pulam",
      fatalPrefix: "pulam:",
      probe: async () => undefined,
    });
    expect(sshOpts()?.extraArgs).toBeUndefined();
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
      fatalPrefix: "widget:",
      probe: async () => undefined,
    });
    const resolveDrvPath = sshOpts()?.resolveDrvPath;
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
      fatalPrefix: "agent:",
      probe,
    });

    expect(h.sshConnector).toHaveBeenCalledWith(
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
        fatalPrefix: "agent:",
        probe: async () => {
          throw new Error("link dead");
        },
      }),
    ).rejects.toThrow(/link dead/);
    expect(h.markConnected).not.toHaveBeenCalled();
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("surfaces the agent's own MULTI-LINE fatal block over the transport error when the agent quit", async () => {
    // The agent exited before serving (the documented "several kavals on the
    // host" ambiguity) → the probe rejects with a transport "stream closed"
    // error, but the session captured the agent's stderr tail. dialAgentOnce must
    // surface THAT — and the WHOLE block, not just the prefixed first line: pulam's
    // ambiguity error lists each `--kaval <socket>` candidate the user needs to
    // recover, and `forEachLine` split those onto their own `source === "remote"`
    // log entries (only the first carries `pulam:`).
    fakeSession({});
    h.state = {
      phase: "disconnected",
      // The unified `log` carries every line with its provenance as a `source`
      // FIELD; dialAgentOnce reads the `source === "remote"` entries (the agent's
      // OWN stderr) and matches the caller's `fatalPrefix` against them. The `local`
      // lifecycle lines are present too and MUST be excluded by the origin filter.
      // The remote block has a noise line BEFORE the fatal (so the prefix match, not
      // `at(-1)`, picks the block start) and the candidate lines AFTER it (so the
      // block capture, not a single line, keeps them).
      log: [
        { source: "remote", line: "spawning awareness sensors" },
        {
          source: "remote",
          line: "pulam: more than one kaval is running on this host — say which to read by re-running with --kaval:",
        },
        {
          source: "remote",
          line: "  --kaval /run/user/1000/kaval-7692/pty-host.sock    (kolu-server on port 7692)",
        },
        {
          source: "remote",
          line: "  --kaval /run/user/1000/kaval/pty-host.sock    (standalone kaval)",
        },
        {
          source: "remote",
          line: "(e.g. pulam-tui --host <ssh> --kaval /run/user/1000/kaval-7692/pty-host.sock)",
        },
        { source: "local", line: "agent exited (code=1, signal=null)" },
        { source: "local", line: "reconnecting in 2000ms… (attempt 1/5)" },
      ],
    };
    let msg = "";
    await dialAgentOnce({
      host: "nix@prod",
      binary: "pulam",
      envVar: "AGENT_DRVS_JSON",
      agentDrvsJson: VALID_MAP,
      drvNoun: "pulam",
      fatalPrefix: "pulam:",
      probe: async () => {
        throw new Error("[AsyncIdQueue] Queue[1] was closed");
      },
    }).catch((e: Error) => {
      msg = e.message;
    });
    // The agent's own block — prefix stripped from the header, candidate lines
    // preserved verbatim, no transport noise, no reconnect chatter, no pre-fatal
    // "spawning awareness sensors" noise line.
    expect(msg).toBe(
      [
        "more than one kaval is running on this host — say which to read by re-running with --kaval:",
        "  --kaval /run/user/1000/kaval-7692/pty-host.sock    (kolu-server on port 7692)",
        "  --kaval /run/user/1000/kaval/pty-host.sock    (standalone kaval)",
        "(e.g. pulam-tui --host <ssh> --kaval /run/user/1000/kaval-7692/pty-host.sock)",
      ].join("\n"),
    );
    expect(msg).toContain("--kaval /run/user/1000/kaval-7692/pty-host.sock");
    expect(msg).not.toMatch(/AsyncIdQueue|reconnecting|spawning awareness/);
    expect(h.destroy).toHaveBeenCalledTimes(1);
  });

  it("matches a multi-word fatalPrefix (kaval's `kaval --stdio:`, not `kaval:`)", async () => {
    // The remote runs `kaval --stdio`, whose fatal prefix is `kaval --stdio:` —
    // NOT `kaval:`. A `${drvNoun}:`-shaped guess would NOT match this line and
    // would silently surface the opaque transport error instead, which is exactly
    // why `fatalPrefix` is caller-supplied. (drvNoun stays `kaval` for the
    // separate "no derivation baked" error.)
    fakeSession({});
    h.state = {
      phase: "disconnected",
      log: [
        {
          source: "remote",
          line: "kaval --stdio: the durable daemon failed to come up — its socket never appeared",
        },
      ],
    };
    let msg = "";
    await dialAgentOnce({
      host: "nix@prod",
      binary: "kaval",
      envVar: "KAVAL_AGENT_DRVS_JSON",
      agentDrvsJson: VALID_MAP,
      drvNoun: "kaval",
      fatalPrefix: "kaval --stdio:",
      probe: async () => {
        throw new Error("[AsyncIdQueue] Queue[1] was closed");
      },
    }).catch((e: Error) => {
      msg = e.message;
    });
    expect(msg).toBe(
      "the durable daemon failed to come up — its socket never appeared",
    );
    expect(msg).not.toMatch(/AsyncIdQueue/);
  });

  it("keeps the raw error for a transport fault (agent did not quit)", async () => {
    // No agent stderr in the remote-source `log` entries (the default state) — a transport
    // hiccup, not the agent exiting — so the original error is the better signal,
    // not overridden.
    fakeSession({});
    await expect(
      dialAgentOnce({
        host: "nix@prod",
        binary: "agent",
        envVar: "AGENT_DRVS_JSON",
        agentDrvsJson: VALID_MAP,
        drvNoun: "agent",
        fatalPrefix: "agent:",
        probe: async () => {
          throw new Error("transport blip");
        },
      }),
    ).rejects.toThrow(/transport blip/);
  });
});

describe("dialAgentOnce: per-dial session isolation (unpooled)", () => {
  // The F1 regression: `dialAgentOnce` builds a fresh `makeSession(...)` per dial
  // rather than a shared pool (S10 deleted the pool). Two dials of the same
  // host/binary get two INDEPENDENT sessions, so one dial's `dispose()` never
  // cross-destroys the other. These tests pin "one session per dial".
  const dialArgs = {
    host: "nix@prod",
    binary: "agent",
    envVar: "AGENT_DRVS_JSON",
    agentDrvsJson: VALID_MAP,
    drvNoun: "agent",
    fatalPrefix: "agent:",
    probe: async () => "ok",
  };

  it("constructs a fresh session for a repeated same-host/binary dial after dispose", async () => {
    fakeSession({});

    const first = await dialAgentOnce({ ...dialArgs });
    first.dispose();
    const second = await dialAgentOnce({ ...dialArgs });

    // Two distinct sessions were constructed — not one pooled, reused instance.
    expect(h.makeSession).toHaveBeenCalledTimes(2);
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

    expect(h.makeSession).toHaveBeenCalledTimes(2);
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
