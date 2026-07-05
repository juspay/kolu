/**
 * The web shell's host-daemon-inventory PUBLISHER — the combine step over injected seams.
 * No filesystem, no socket: it drives `enumerateDaemonInventoryOnce` / the sampler and
 * asserts the reshaped `daemonInventory` cell (binding · boundPadi).
 *
 * The bound host's daemons are NOT the shell's concern anymore — padi serves them on
 * `padiSurface.hostInventory` (tested in @kolu/padi's `hostInventory.test.ts`). Here the
 * shell publishes the LOCAL-machine scan (only under a remote binding) + the binding host
 * + the bound padi's honest identity/convergence.
 */

import type { KavalProbe, PadiDaemon } from "@kolu/padi/assembly";
import type { KavalDaemon } from "kaval";
import type { DaemonInventory } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  enumerateDaemonInventoryOnce,
  startDaemonInventorySampler,
} from "./daemonInventory.ts";

const KAVAL = "/run/user/1000/kaval-abc123/pty-host.sock";
const PADI = "/run/user/1000/padi-abc123/padi.sock";

const kaval = (over: Partial<KavalDaemon> = {}): KavalDaemon => ({
  socket: KAVAL,
  label: "kolu @ /home/u/.local/state/padi",
  kind: "stateRoot",
  gatePid: 4242,
  ...over,
});

const padi = (over: Partial<PadiDaemon> = {}): PadiDaemon => ({
  socket: PADI,
  stateRoot: "/home/u/.local/state/padi",
  gatePid: 111,
  ...over,
});

const probe = (over: Partial<KavalProbe> = {}): KavalProbe => ({
  terminalCount: 3,
  buildCommit: "abc1234",
  contractVersion: "5.0",
  ...over,
});

type Deps = Parameters<typeof enumerateDaemonInventoryOnce>[0];

const deps = (over: Partial<Deps> = {}): Deps => ({
  discoverKavals: () => [kaval()],
  discoverPadis: () => [padi()],
  probe: async () => probe(),
  activePadiSurfaceVersion: () => "1.2",
  activePadiBuildCommit: () => "localcommit",
  activePadiConvergence: () => null,
  boundHost: null,
  publish: () => {},
  ...over,
});

describe("enumerateDaemonInventoryOnce — local binding", () => {
  it("does NOT scan the local machine (the bound padi's member already covers it): localScan is null", async () => {
    let published: DaemonInventory | undefined;
    // A discovery that would THROW if called — proving the local scan is skipped entirely
    // under a local binding, not merely emptied.
    await enumerateDaemonInventoryOnce(
      deps({
        discoverKavals: () => {
          throw new Error("local scan must not run under a local binding");
        },
        discoverPadis: () => {
          throw new Error("local scan must not run under a local binding");
        },
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    // The union makes a local binding carry NO scan by construction — not merely a null
    // one — so `{ kind: "local" }` is the whole binding.
    expect(published?.binding).toEqual({ kind: "local" });
  });

  it("publishes the bound padi's honest identity on boundPadi (works over ssh; no local active row needed)", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      deps({
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    expect(published?.boundPadi).toEqual({
      surfaceVersion: "1.2",
      buildCommit: "localcommit",
      convergence: null,
    });
  });

  it("boundPadi is null only when there is NOTHING to say (no identity AND no convergence)", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      deps({
        activePadiSurfaceVersion: () => null,
        activePadiBuildCommit: () => null,
        activePadiConvergence: () => null,
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    expect(published?.boundPadi).toBeNull();
  });
});

describe("enumerateDaemonInventoryOnce — remote binding", () => {
  it("scans the LOCAL machine into localScan, marking NONE active — a leak stays visible, never 'in use by kolu'", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      deps({
        boundHost: "nix@remote.example",
        // The bound padi is REMOTE — its honest identity rides boundPadi, and must NOT land
        // on any local row.
        activePadiSurfaceVersion: () => "9.9",
        activePadiBuildCommit: () => "remotecommit",
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    const binding = published?.binding;
    if (binding?.kind !== "remote")
      throw new Error("expected a remote binding");
    // The local machine's daemons ARE listed (a leak on the machine you're using stays
    // visible) …
    expect(binding.localScan.kavals).toHaveLength(1);
    expect(binding.localScan.padis).toHaveLength(1);
    // … but NONE is kolu's active one (no "in use by kolu" lie on a local socket). The
    // remote padi's version/commit ride boundPadi, never a local row.
    expect(binding.localScan.kavals[0]?.held.active).toBe(false);
    expect(binding.localScan.padis[0]?.active).toBe(false);
  });

  it("publishes boundHost = the remote host so the dialog labels the local scan 'not the bound host'", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      deps({
        boundHost: "nix@prod.example",
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    expect(published?.binding).toMatchObject({
      kind: "remote",
      host: "nix@prod.example",
    });
    // The BOUND padi's identity rides boundPadi (off the session readouts), so the Padi
    // dialog's version + build-commit work over ssh even though NO local padi is active.
    expect(published?.boundPadi).toEqual({
      surfaceVersion: "1.2",
      buildCommit: "localcommit",
      convergence: null,
    });
  });

  it("a degraded bind with NO adopted identity (skew/link-failed) still publishes boundPadi carrying the convergence reason", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      deps({
        boundHost: "nix@prod.example",
        // A REFUSED / FAILED bind: no adopted identity, but a standing convergence reason.
        activePadiSurfaceVersion: () => null,
        activePadiBuildCommit: () => null,
        activePadiConvergence: () => ({
          state: "skew-refused",
          runningBuild: null,
          expectedBuild: null,
          detail:
            "padi contract skew: remote serves 99.0, kolu-server needs 5.0 — refusing",
        }),
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    // boundPadi must be NON-null even with null identity — else the Padi dialog's degraded
    // banner would vanish for a refused/failed bind (the exact null-vs-nonnull case).
    expect(published?.boundPadi).toEqual({
      surfaceVersion: null,
      buildCommit: null,
      convergence: {
        state: "skew-refused",
        runningBuild: null,
        expectedBuild: null,
        detail:
          "padi contract skew: remote serves 99.0, kolu-server needs 5.0 — refusing",
      },
    });
  });
});

describe("startDaemonInventorySampler", () => {
  it("P4: COALESCES a resample landing mid-tick — one re-run, never dropped, never doubled", async () => {
    const until = async (cond: () => boolean): Promise<void> => {
      const deadline = Date.now() + 2000;
      while (!cond()) {
        if (Date.now() > deadline) throw new Error("timed out");
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    let publishCount = 0;
    let gates: Array<() => void> = [];
    // Drain whatever probes the current tick issued (a tick issues its probes synchronously).
    const releaseTick = (): void => {
      const g = gates;
      gates = [];
      for (const fn of g) fn();
    };
    // A REMOTE binding so the sampler runs the local scan (and thus the gated probe) each
    // tick — a local binding would skip the scan and never gate.
    const sampled = deps({
      boundHost: "nix@remote.example",
      probe: () => new Promise((resolve) => gates.push(() => resolve(probe()))),
      publish: () => {
        publishCount += 1;
      },
    });
    let resample: (() => void) | undefined;
    startDaemonInventorySampler(sampled, (fn) => {
      resample = fn;
    });
    // The boot tick is in-flight (its probe gated). Fire TWO resamples mid-tick → coalesced.
    await until(() => gates.length > 0);
    resample?.();
    resample?.();
    // Release the boot tick → it publishes (1), then the ONE coalesced re-run issues its probe.
    releaseTick();
    await until(() => publishCount === 1 && gates.length > 0);
    // Release the re-run → publishes (2). No further pending → no third tick.
    releaseTick();
    await until(() => publishCount === 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(publishCount).toBe(2); // boot + ONE coalesced re-run (not 1 dropped, not 3 doubled)
    expect(gates.length).toBe(0);
  });
});
