/**
 * The pure host-daemon-inventory assembly — which daemon is kolu's ACTIVE one, and
 * legacy (port-keyed) detection — over hand-built discovered lists. No filesystem, no
 * socket: the pure functions are the marking policy in isolation.
 */

import type { PadiDaemon } from "@kolu/padi/assembly";
import type { KavalDaemon } from "kaval";
import type { DaemonInventory } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  assembleKavalInventory,
  assemblePadiInventory,
  enumerateDaemonInventoryOnce,
  type KavalProbe,
  resolveActiveKavalSocket,
} from "./daemonInventory.ts";

const DIGEST = "/run/user/1000/kaval-abc123/pty-host.sock";
const ACTIVE = DIGEST;
const LEGACY = "/run/user/1000/kaval-7692/pty-host.sock";
const STANDALONE = "/run/user/1000/kaval/pty-host.sock";

const kaval = (over: Partial<KavalDaemon>): KavalDaemon => ({
  socket: ACTIVE,
  label: "kolu @ /home/u/.local/state/padi",
  kind: "stateRoot",
  gatePid: 4242,
  ...over,
});

const probe = (over: Partial<KavalProbe> = {}): KavalProbe => ({
  terminalCount: 3,
  buildCommit: "abc1234",
  contractVersion: "5.0",
  ...over,
});

describe("resolveActiveKavalSocket", () => {
  it("prefers the DIGEST address when a kaval is live there (padi's primary)", () => {
    const socket = resolveActiveKavalSocket(
      [kaval({ socket: DIGEST }), kaval({ socket: LEGACY, kind: "port" })],
      DIGEST,
      LEGACY,
    );
    expect(socket).toBe(DIGEST);
  });

  it("falls to the LEGACY address when the digest is dead but legacy is live (adopted)", () => {
    // Only the legacy port kaval is discovered live — the upgrade-adoption case.
    const socket = resolveActiveKavalSocket(
      [kaval({ socket: LEGACY, kind: "stateRoot" })],
      DIGEST,
      LEGACY,
    );
    expect(socket).toBe(LEGACY);
  });

  it("defaults to the digest address when neither is live (padi will spawn there)", () => {
    const socket = resolveActiveKavalSocket([], DIGEST, LEGACY);
    expect(socket).toBe(DIGEST);
  });
});

describe("assembleKavalInventory", () => {
  it("marks EXACTLY the padi-owned kaval active (by socket identity), and only it", () => {
    const rows = assembleKavalInventory(
      [
        kaval({ socket: ACTIVE, kind: "stateRoot" }),
        kaval({
          socket: LEGACY,
          kind: "port",
          label: "kolu-server on port 7692",
        }),
        kaval({
          socket: STANDALONE,
          kind: "standalone",
          label: "standalone kaval",
        }),
      ],
      new Map(),
      ACTIVE,
      LEGACY,
    );
    expect(rows.map((r) => [r.socket, r.active])).toEqual([
      [ACTIVE, true],
      [LEGACY, false],
      [STANDALONE, false],
    ]);
    // The active kaval is at the DIGEST address here — not a legacy adoption.
    expect(rows.every((r) => !r.atLegacyAddress)).toBe(true);
  });

  it("an ADOPTED legacy-address kaval reads as active + atLegacyAddress (converging, NOT a leak)", () => {
    // padi adopted the pre-W2.2 `kaval-<port>/` on upgrade → it carries the state-root
    // manifest (kind `stateRoot`, labeled `kolu @ …`), the digest socket is dead, and
    // the held socket IS the legacy one.
    const rows = assembleKavalInventory(
      [kaval({ socket: LEGACY, kind: "stateRoot" })],
      new Map(),
      LEGACY, // resolveActiveKavalSocket picked the legacy address (digest dead)
      LEGACY,
    );
    expect(rows[0]).toMatchObject({
      active: true,
      atLegacyAddress: true,
      // NOT a leak: it is kolu's live kaval, just at the old address.
      kind: "stateRoot",
    });
  });

  it("a STRAY legacy `port` kaval that is NOT held stays a flaggable leak (not converging)", () => {
    // The active kaval is at the digest address; a SECOND, un-adopted `kaval-<port>/`
    // (no manifest → kind `port`) is a genuine stray — active false, atLegacyAddress
    // false, and its `port` kind is what the dialog flags as "not owned by padi".
    const rows = assembleKavalInventory(
      [
        kaval({ socket: DIGEST, kind: "stateRoot" }),
        kaval({
          socket: LEGACY,
          kind: "port",
          label: "kolu-server on port 7692",
        }),
      ],
      new Map(),
      DIGEST, // digest is held (primary live)
      LEGACY,
    );
    const stray = rows.find((r) => r.socket === LEGACY);
    expect(stray).toMatchObject({
      active: false,
      atLegacyAddress: false,
      kind: "port",
    });
  });

  it("carries the legacy `port` kind through so the leak signal is flaggable", () => {
    const rows = assembleKavalInventory(
      [
        kaval({
          socket: LEGACY,
          kind: "port",
          label: "kolu-server on port 7692",
        }),
      ],
      new Map(),
      ACTIVE,
      LEGACY,
    );
    // A legacy port-keyed kaval — NOT owned by any padi, and not the active one.
    expect(rows[0]).toMatchObject({ kind: "port", active: false });
  });

  it("no active socket (padi unbound) → nothing is marked active", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: ACTIVE }), kaval({ socket: LEGACY, kind: "port" })],
      new Map(),
      null,
      LEGACY,
    );
    expect(rows.every((r) => !r.active)).toBe(true);
    expect(rows.every((r) => !r.atLegacyAddress)).toBe(true);
  });

  it("folds a present probe onto its socket and a MISSING probe to honest nulls", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: ACTIVE }), kaval({ socket: LEGACY, kind: "port" })],
      new Map([[ACTIVE, probe({ terminalCount: 5, contractVersion: "5.0" })]]),
      ACTIVE,
      LEGACY,
    );
    const active = rows.find((r) => r.socket === ACTIVE);
    const legacy = rows.find((r) => r.socket === LEGACY);
    expect(active).toMatchObject({
      terminalCount: 5,
      buildCommit: "abc1234",
      contractVersion: "5.0",
    });
    // The un-probed daemon reads honest nulls (#1034), never a fabricated 0/version.
    expect(legacy).toMatchObject({
      terminalCount: null,
      buildCommit: null,
      contractVersion: null,
    });
  });

  it("preserves discovery order and passes label + gatePid through verbatim", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: STANDALONE, label: "standalone kaval", gatePid: 9 })],
      new Map(),
      ACTIVE,
      LEGACY,
    );
    expect(rows[0]).toMatchObject({
      socket: STANDALONE,
      label: "standalone kaval",
      gatePid: 9,
    });
  });
});

const PADI_ACTIVE = "/run/user/1000/padi-abc123/padi.sock";
const PADI_OTHER = "/run/user/1000/padi-def456/padi.sock";

const padi = (over: Partial<PadiDaemon>): PadiDaemon => ({
  socket: PADI_ACTIVE,
  stateRoot: "/home/u/.local/state/padi",
  gatePid: 111,
  ...over,
});

describe("assemblePadiInventory", () => {
  it("marks the bound padi active and gives ONLY it the honest surfaceVersion + buildCommit", () => {
    const rows = assemblePadiInventory(
      [
        padi({ socket: PADI_ACTIVE }),
        padi({ socket: PADI_OTHER, stateRoot: "/tmp/other" }),
      ],
      PADI_ACTIVE,
      "1.1",
      "padi9f8",
    );
    const active = rows.find((r) => r.socket === PADI_ACTIVE);
    const other = rows.find((r) => r.socket === PADI_OTHER);
    // Build commit rides the active padi, mirroring the Kaval running-daemon row.
    expect(active).toMatchObject({
      active: true,
      surfaceVersion: "1.1",
      buildCommit: "padi9f8",
    });
    // A padi kolu-server is NOT bound to is not probed → null surfaceVersion AND null
    // buildCommit (honest "unknown"), never the active padi's identity leaking onto it.
    expect(other).toMatchObject({
      active: false,
      surfaceVersion: null,
      buildCommit: null,
    });
  });

  it("no active socket → nothing active, no surfaceVersion / buildCommit anywhere", () => {
    const rows = assemblePadiInventory(
      [padi({ socket: PADI_ACTIVE })],
      null,
      "1.1",
      "padi9f8",
    );
    expect(rows[0]).toMatchObject({
      active: false,
      surfaceVersion: null,
      buildCommit: null,
    });
  });

  it("active padi with an unknown build commit stays honestly null (a survivor predating the hello field)", () => {
    const rows = assemblePadiInventory(
      [padi({ socket: PADI_ACTIVE })],
      PADI_ACTIVE,
      "1.1",
      null,
    );
    // The bind is live (surfaceVersion known) but the commit is unknown → honest null,
    // never fabricated (#1034) — the Padi dialog renders "—".
    expect(rows[0]).toMatchObject({
      active: true,
      surfaceVersion: "1.1",
      buildCommit: null,
    });
  });
});

describe("enumerateDaemonInventoryOnce — remote binding (boundHost)", () => {
  const remoteDeps = (
    over: Partial<Parameters<typeof enumerateDaemonInventoryOnce>[0]>,
  ): Parameters<typeof enumerateDaemonInventoryOnce>[0] => ({
    discoverKavals: () => [kaval({ socket: DIGEST })],
    discoverPadis: () => [padi({ socket: PADI_ACTIVE })],
    probe: async () => probe(),
    digestKavalSocket: DIGEST,
    legacyKavalSocket: LEGACY,
    activePadiSocket: PADI_ACTIVE,
    activePadiSurfaceVersion: () => "1.1",
    activePadiBuildCommit: () => "localcommit",
    activePadiConvergence: () => null,
    // Default LOCAL bind; a remote case overrides with a host (boundLocally is DERIVED
    // = boundHost === null, so a non-null host is the sole remote signal).
    boundHost: null,
    publish: () => {},
    ...over,
  });

  it("a remote boundHost marks NO local daemon active and never pins the remote padi's identity onto a local socket", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      remoteDeps({
        // The bound padi is REMOTE — its honest identity must NOT land on any local row.
        activePadiSurfaceVersion: () => "9.9",
        activePadiBuildCommit: () => "remotecommit",
        publish: (inv) => {
          published = inv;
        },
        boundHost: "nix@remote.example",
      }),
    );
    // Local daemons are still LISTED (a leak stays visible) …
    expect(published?.kavals).toHaveLength(1);
    expect(published?.padis).toHaveLength(1);
    // … but NONE is kolu's active one, and the remote padi's version/commit attach to
    // nothing local (no "in use by kolu" lie, no remote identity on a local socket).
    expect(published?.kavals[0]?.active).toBe(false);
    expect(published?.padis[0]).toMatchObject({
      active: false,
      surfaceVersion: null,
      buildCommit: null,
    });
  });

  it("publishes boundHost = the remote host when bound remotely, null when local — so the dialog labels this LOCAL scan 'not the bound host'", async () => {
    let remote: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      remoteDeps({
        publish: (inv) => {
          remote = inv;
        },
        boundHost: "nix@prod.example",
      }),
    );
    // Bound remotely → the host rides the inventory so the dialog can fence off + label
    // this local scan as "this machine, not the bound host".
    expect(remote?.boundHost).toBe("nix@prod.example");
    // …and the BOUND padi's identity rides `boundPadi` (off the session readouts), so
    // the Padi dialog's version + build-commit work over ssh even though NO local padi is
    // `active` — the field-by-field side-channel the two-box repro surfaced.
    expect(remote?.boundPadi).toEqual({
      surfaceVersion: "1.1",
      buildCommit: "localcommit",
      convergence: null,
    });
    expect(remote?.padis[0]?.active).toBe(false); // still no local active row

    let local: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      remoteDeps({
        publish: (inv) => {
          local = inv;
        },
      }),
    );
    // Local bind (no boundHost dep) → null, so the dialog keeps "Running kaval daemons".
    expect(local?.boundHost).toBeNull();
  });

  it("boundHost null (local bind) marks the local bound daemon active — unchanged", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      remoteDeps({
        publish: (inv) => {
          published = inv;
        },
      }),
    );
    expect(published?.kavals[0]?.active).toBe(true);
    expect(published?.padis[0]).toMatchObject({
      active: true,
      surfaceVersion: "1.1",
      buildCommit: "localcommit",
    });
  });

  it("a degraded bind with NO adopted identity (skew/link-failed) still publishes boundPadi carrying the convergence reason", async () => {
    let published: DaemonInventory | undefined;
    await enumerateDaemonInventoryOnce(
      remoteDeps({
        boundHost: "nix@prod.example",
        // A REFUSED / FAILED bind: no adopted identity (liveIdentity() is null), but a
        // standing convergence reason to surface.
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
