/**
 * The web shell's host-daemon-inventory PUBLISHER — the combine step over injected reads.
 * No filesystem, no socket: it drives `enumerateDaemonInventoryOnce` (the SYNC assembly)
 * and `startSharedLocalDaemonScan` (the shared read-only scan), asserting the reshaped
 * `daemonInventory` cell (binding · boundPadi).
 *
 * The bound host's daemons are NOT the shell's concern anymore — padi serves them on
 * `padiSurface.hostInventory` (tested in @kolu/padi's `hostInventory.test.ts`). Here the
 * shell publishes the LOCAL-machine scan (only under a remote binding) + the binding host
 * + the bound padi's honest identity/convergence. 5a: the local scan is a SHARED single
 * writer (`startSharedLocalDaemonScan`), and the per-host assembly READS its cached result
 * — it no longer runs the scan itself.
 */

import {
  enumerateHostDaemons,
  type KavalProbe,
  type PadiDaemon,
} from "@kolu/padi/assembly";
import type { HostDaemonInventory } from "@kolu/padi/surface";
import type { KavalDaemon } from "kaval";
import type { DaemonInventory } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
  enumerateDaemonInventoryOnce,
  startSharedLocalDaemonScan,
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

/** Build a realistic local-machine scan the way the SHARED scan does (via the real
 *  `enumerateHostDaemons` transform, marking NONE active), so the assembly tests feed the
 *  exact shape prod's `getLocalScan` returns. */
function buildLocalScan(): Promise<HostDaemonInventory> {
  return enumerateHostDaemons({
    discoverKavals: () => [kaval()],
    discoverPadis: () => [padi()],
    probe: async () => probe(),
    activeKavalSocket: null,
    activeKavalAtLegacy: false,
    activePadiSocket: null,
  });
}

type Deps = Parameters<typeof enumerateDaemonInventoryOnce>[0];

const deps = (over: Partial<Deps> = {}): Deps => ({
  getLocalScan: () => null,
  activePadiSurfaceVersion: () => "1.2",
  activePadiBuildCommit: () => "localcommit",
  activePadiConvergence: () => null,
  boundHost: null,
  publish: () => {},
  ...over,
});

describe("enumerateDaemonInventoryOnce — local binding", () => {
  it("does NOT read the shared scan (the bound padi's member already covers this machine): localScan is null", () => {
    let published: DaemonInventory | undefined;
    // A getLocalScan that would THROW if called — proving a local binding never even reads
    // the shared scan, not merely that the result is emptied.
    const getLocalScan = vi.fn((): HostDaemonInventory | null => {
      throw new Error("local binding must not read the shared scan");
    });
    enumerateDaemonInventoryOnce(
      deps({
        getLocalScan,
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    // The union makes a local binding carry NO scan by construction.
    expect(published?.binding).toEqual({ kind: "local" });
    expect(getLocalScan).not.toHaveBeenCalled();
  });

  it("publishes the bound padi's honest identity on boundPadi (works over ssh; no local active row needed)", () => {
    let published: DaemonInventory | undefined;
    enumerateDaemonInventoryOnce(
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

  it("boundPadi is null only when there is NOTHING to say (no identity AND no convergence)", () => {
    let published: DaemonInventory | undefined;
    enumerateDaemonInventoryOnce(
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
  it("carries the SHARED local-machine scan into localScan, marking NONE active — a leak stays visible, never 'in use by kolu'", async () => {
    const localScan = await buildLocalScan();
    let published: DaemonInventory | undefined;
    enumerateDaemonInventoryOnce(
      deps({
        boundHost: "nix@remote.example",
        getLocalScan: () => localScan,
        // The bound padi is REMOTE — its honest identity rides boundPadi, never a local row.
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
    // … but NONE is kolu's active one (no "in use by kolu" lie on a local socket).
    expect(binding.localScan.kavals[0]?.held.active).toBe(false);
    expect(binding.localScan.padis[0]?.active).toBe(false);
  });

  it("before the first shared scan lands (getLocalScan null), localScan is EMPTY — a transient filled in by the next scan-update re-publish", () => {
    let published: DaemonInventory | undefined;
    enumerateDaemonInventoryOnce(
      deps({
        boundHost: "nix@remote.example",
        getLocalScan: () => null,
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    const binding = published?.binding;
    if (binding?.kind !== "remote")
      throw new Error("expected a remote binding");
    expect(binding.localScan).toEqual({ kavals: [], padis: [] });
  });

  it("publishes boundHost = the remote host so the dialog labels the local scan 'not the bound host'", async () => {
    const localScan = await buildLocalScan();
    let published: DaemonInventory | undefined;
    enumerateDaemonInventoryOnce(
      deps({
        boundHost: "nix@prod.example",
        getLocalScan: () => localScan,
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
    const localScan = await buildLocalScan();
    let published: DaemonInventory | undefined;
    enumerateDaemonInventoryOnce(
      deps({
        boundHost: "nix@prod.example",
        getLocalScan: () => localScan,
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

describe("startSharedLocalDaemonScan (5a — the shared single-writer scan)", () => {
  const until = async (cond: () => boolean): Promise<void> => {
    const deadline = Date.now() + 2000;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  it("scans ONCE at T+0, caches the result, and notifies subscribers — one owner for a host-independent fact", async () => {
    let discoverCount = 0;
    const scan = startSharedLocalDaemonScan({
      discoverKavals: () => {
        discoverCount += 1;
        return [kaval()];
      },
      discoverPadis: () => [padi()],
      probe: async () => probe(),
    });
    try {
      // A subscriber attached before the T+0 scan completes is notified when it lands.
      const onScan = vi.fn();
      scan.subscribe(onScan);
      await until(() => scan.get() !== null);
      expect(discoverCount).toBe(1); // ONE scan for the whole process, not one per entry
      expect(scan.get()?.kavals).toHaveLength(1);
      expect(scan.get()?.kavals[0]?.held.active).toBe(false); // kolu is bound elsewhere
      expect(onScan).toHaveBeenCalled();
    } finally {
      scan.dispose();
    }
  });

  it("an unsubscribed callback is not notified, and dispose() is safe/idempotent (per-host teardown / shutdown)", async () => {
    const scan = startSharedLocalDaemonScan({
      discoverKavals: () => [kaval()],
      discoverPadis: () => [padi()],
      probe: async () => probe(),
    });
    await until(() => scan.get() !== null); // let the T+0 scan settle
    const onScan = vi.fn();
    const off = scan.subscribe(onScan);
    off(); // unsubscribed — a later scan must not call it
    scan.dispose();
    expect(() => scan.dispose()).not.toThrow(); // idempotent
    expect(onScan).not.toHaveBeenCalled();
  });
});
