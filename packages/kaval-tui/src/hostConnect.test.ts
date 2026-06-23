/**
 * Unit tests for the kaval-tui `--host` wrapper. The one-shot dial composition
 * (drv-map parse, arch-probe + lookup, pin → probe → markConnected → destroy)
 * lives in `@kolu/surface-nix-host`'s `dialAgentOnce` and is tested there; here
 * we mock `dialAgentOnce` and prove the thin seam this wrapper owns: it passes
 * kaval's volatile values (binary, env var, drvNoun) and nominates NO `probe` —
 * the dial defaults to the framework-reserved `system.live` round-trip, so kaval
 * no longer supplies a liveness verb of its own. The returned `Connection` flows
 * back unchanged.
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

  it("nominates no probe — the dial defaults to the reserved system.live", async () => {
    const client = inProcessKavalClient();
    h.dialAgentOnce.mockResolvedValue({ client, dispose: () => {} });

    await connectPtyHostViaHost("nix@prod");
    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];

    // kaval supplies no `probe`: liveness is the framework's job now (the dial
    // defaults to `system.live`), so this wrapper nominates no verb of its own.
    expect(opts?.probe).toBeUndefined();
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
