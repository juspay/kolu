/**
 * Unit tests for the kaval-tui `--host` wrapper. The one-shot dial composition
 * (drv-map parse, arch-probe + lookup, pin → probe → markConnected → destroy)
 * lives in `@kolu/surface-nix-host`'s `dialAgentOnce` and is tested there; here
 * we mock `dialAgentOnce` and prove the thin seam this wrapper owns: it passes
 * kaval's three volatile values (binary, env var, drvNoun) and a `probe` that
 * roundtrips `system.heartbeat` (kaval's atomic liveness verb). The probe is
 * exercised against a REAL in-process kaval client, and the returned
 * `Connection` flows back unchanged.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dialAgentOnce: vi.fn() }));

vi.mock("@kolu/surface-nix-host", () => ({ dialAgentOnce: h.dialAgentOnce }));

import { createInProcessPtyHost, type InProcessPtyHostDeps } from "kaval";
import { dialAgentOnce } from "@kolu/surface-nix-host";
import { connectPtyHostViaHost } from "./hostConnect.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as InProcessPtyHostDeps["log"];

function inProcessKavalClient() {
  return createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kaval-host-rc-")),
  }).client;
}

afterEach(() => vi.clearAllMocks());

describe("connectPtyHostViaHost", () => {
  it("dials with kaval's binary, env var, and drvNoun", async () => {
    const client = inProcessKavalClient();
    h.dialAgentOnce.mockResolvedValue({ client, dispose: () => {} });

    const conn = await connectPtyHostViaHost("nix@prod");

    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];
    expect(opts).toMatchObject({
      host: "nix@prod",
      binary: "kaval",
      envVar: "KAVAL_AGENT_DRVS_JSON",
      drvNoun: "kaval",
    });

    // The returned Connection is the SAME shape cmd*() use.
    const { entries } = await conn.client.surface.terminal.list({});
    expect(Array.isArray(entries)).toBe(true);
  });

  it("the probe roundtrips system.heartbeat (kaval's liveness verb)", async () => {
    const client = inProcessKavalClient();
    h.dialAgentOnce.mockResolvedValue({ client, dispose: () => {} });

    await connectPtyHostViaHost("nix@prod");
    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];

    // Running the probe against the real in-process host roundtrips one RPC —
    // the connectivity proof the one-shot dial uses.
    // biome-ignore lint/suspicious/noExplicitAny: the mocked generic collapses the probe's client type; the in-process client speaks the same contract.
    await expect(opts?.probe(client as any)).resolves.toBeDefined();
  });

  it("threads dispose back through the Connection", async () => {
    const dispose = vi.fn();
    h.dialAgentOnce.mockResolvedValue({
      client: inProcessKavalClient(),
      dispose,
    });
    const conn = await connectPtyHostViaHost("nix@prod");
    conn.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
