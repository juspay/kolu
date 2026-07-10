/**
 * Unit tests for padi-tui's `--host` wrapper. The one-shot dial composition
 * (drv-map parse, arch-probe + lookup, pin → probe → markConnected → destroy)
 * lives in `@kolu/surface-remote`'s `dialAgentOnce` and is tested there; here we
 * mock `dialAgentOnce` and prove the thin seam this wrapper owns:
 *   - it passes padi's volatile values (binary `padi`, the drv-map env var,
 *     drvNoun, and the `padi --stdio:` fatal prefix);
 *   - UNLIKE kaval-tui, it nominates its OWN `probe` — padi gates the padiSurface
 *     CONTRACT version, not just liveness — and that probe reads the frozen
 *     control core's `hello` and applies the shared skew judgement;
 *   - the dialed client is scoped to the padi sibling, and `dispose` threads back.
 */
import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import { dialAgentOnce } from "@kolu/surface-remote";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectPadiTuiViaHost } from "./hostConnect.ts";

const h = vi.hoisted(() => ({ dialAgentOnce: vi.fn() }));

vi.mock("@kolu/surface-remote", () => ({ dialAgentOnce: h.dialAgentOnce }));

/** A fake COMBINED dialed client: a `.surface.padi` sibling for the scope, and a
 *  `.surface.control.core.hello` the probe reads. `hello.surfaceVersion` is
 *  parameterized so a test can drive the compat gate to pass or refuse. */
function fakeCombinedClient(surfaceVersion: string) {
  return {
    surface: {
      padi: { marker: "padi-sibling" },
      control: {
        core: { hello: async () => ({ surfaceVersion }) },
      },
    },
  };
}

/** The `probe` passed to `dialAgentOnce` in the most recent call — the seam under
 *  test. `dialAgentOnce` normally runs it against the live dialed client; here we
 *  invoke it directly with a fake client to exercise the compat gate. */
function capturedProbe(): (client: unknown) => Promise<unknown> {
  const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];
  if (opts?.probe === undefined) throw new Error("no probe was supplied");
  return opts.probe as (client: unknown) => Promise<unknown>;
}

afterEach(() => vi.clearAllMocks());

describe("connectPadiTuiViaHost", () => {
  it("dials with padi's binary, env var, drvNoun, and --stdio fatal prefix", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose: () => {},
    });

    await connectPadiTuiViaHost("nix@prod");

    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];
    expect(opts).toMatchObject({
      host: "nix@prod",
      binary: "padi",
      envVar: "PADI_AGENT_DRVS_JSON",
      drvNoun: "padi",
      fatalPrefix: "padi --stdio:",
    });
  });

  it("never re-adds --stdio in extraArgs (the connector appends it)", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose: () => {},
    });
    await connectPadiTuiViaHost("nix@prod");
    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];
    expect(opts?.extraArgs).toBeUndefined();
  });

  it("supplies a probe that gates the padiSurface contract version", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose: () => {},
    });
    await connectPadiTuiViaHost("nix@prod");

    const probe = capturedProbe();
    // A compatible padi passes the gate (this build's own version).
    await expect(
      probe(fakeCombinedClient(PADI_SURFACE_VERSION)),
    ).resolves.toBeUndefined();
  });

  it("probe REFUSES a skewed remote padi (a newer major this build can't speak)", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose: () => {},
    });
    await connectPadiTuiViaHost("nix@prod");

    const probe = capturedProbe();
    // A padi one major ahead is an incompatible skew — the gate throws loud so the
    // CLI surfaces "upgrade", never speaks a contract it doesn't share.
    await expect(probe(fakeCombinedClient("999.0"))).rejects.toThrow(
      /contract skew/,
    );
  });

  it("scopes the dialed client to the padi sibling", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose: () => {},
    });
    const conn = await connectPadiTuiViaHost("nix@prod");
    // scopePadiSurface narrows `.surface` to the `padi` sibling — the verbs speak
    // `.surface.<member>`, so `conn.client.surface` IS the scoped sibling object.
    expect(conn.client.surface).toEqual({ marker: "padi-sibling" });
  });

  it("threads dispose back through the Connection", async () => {
    const dispose = vi.fn();
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose,
    });
    const conn = await connectPadiTuiViaHost("nix@prod");
    conn.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
