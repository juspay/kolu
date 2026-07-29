/**
 * The host-daemon-inventory scanner — the pure assembly (which daemon is kolu's ACTIVE
 * one, adopted-legacy detection, honest-null probe folding) and the `enumerateHostDaemons`
 * orchestration over injected discovery/probe seams. No filesystem, no real socket.
 *
 * This is the ONE scanner both padi (its `hostInventory` surface member) and kolu-server
 * (its local-machine `daemonInventory.localScan` under a remote binding) reuse.
 */

import type { PadiDaemon } from "./stateRoot.ts";
import type { KavalDaemon } from "kaval";
import { describe, expect, it } from "vitest";
import {
  assembleKavalInventory,
  assemblePadiInventory,
  enumerateHostDaemons,
  type KavalProbe,
  withSelfPadi,
} from "./hostInventory.ts";

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

describe("assembleKavalInventory", () => {
  it("marks EXACTLY the padi-held kaval active (by socket identity), and only it", () => {
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
      false,
    );
    expect(rows.map((r) => [r.socket, r.held.active])).toEqual([
      [ACTIVE, true],
      [LEGACY, false],
      [STANDALONE, false],
    ]);
    // The active kaval is at the DIGEST address here — not a legacy adoption (the active
    // arm carries atLegacyAddress:false; an inactive arm can't carry the field at all).
    expect(rows[0]?.held).toEqual({ active: true, atLegacyAddress: false });
  });

  it("an ADOPTED legacy-address kaval reads as active + atLegacyAddress (converging, NOT a leak)", () => {
    // padi adopted the pre-W2.2 `kaval-<port>/` on upgrade and wrote a state-root manifest
    // into it, so discovery labels it `kolu @ …` (kind `stateRoot`). The held socket IS the
    // legacy one, so the caller passes `activeAtLegacy = true` (held !== digest).
    const rows = assembleKavalInventory(
      [kaval({ socket: LEGACY, kind: "stateRoot" })],
      new Map(),
      LEGACY,
      true,
    );
    expect(rows[0]).toMatchObject({
      held: { active: true, atLegacyAddress: true },
      // NOT a leak: it is kolu's live kaval, just at the old address.
      kind: "stateRoot",
    });
  });

  it("a STRAY legacy `port` kaval that is NOT held stays a flaggable leak (not converging)", () => {
    // The active kaval is at the digest address; a SECOND, un-adopted `kaval-<port>/` (no
    // manifest → kind `port`) is a genuine stray — inactive (so it can't even carry the
    // legacy hint), and its `port` kind is what the dialog flags as "not owned by padi".
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
      false,
    );
    const stray = rows.find((r) => r.socket === LEGACY);
    expect(stray).toMatchObject({ held: { active: false }, kind: "port" });
  });

  it("the legacy hint is UNREPRESENTABLE off the active arm — a non-held daemon can't converge", () => {
    // Even with activeAtLegacy=true, only the HELD (active) socket gets the hint; the type
    // makes "inactive but atLegacy" impossible to construct, so a non-held row is just
    // `{ active: false }`.
    const rows = assembleKavalInventory(
      [
        kaval({ socket: LEGACY }),
        kaval({ socket: STANDALONE, kind: "standalone" }),
      ],
      new Map(),
      LEGACY,
      true,
    );
    expect(rows.find((r) => r.socket === LEGACY)?.held).toEqual({
      active: true,
      atLegacyAddress: true,
    });
    expect(rows.find((r) => r.socket === STANDALONE)?.held).toEqual({
      active: false,
    });
  });

  it("no active socket (local-machine scan under a remote binding) → nothing active", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: ACTIVE }), kaval({ socket: LEGACY, kind: "port" })],
      new Map(),
      null,
      false,
    );
    expect(rows.every((r) => !r.held.active)).toBe(true);
  });

  it("folds a present probe onto its socket and a MISSING probe to honest nulls", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: ACTIVE }), kaval({ socket: LEGACY, kind: "port" })],
      new Map([[ACTIVE, probe({ terminalCount: 5, contractVersion: "5.0" })]]),
      ACTIVE,
      false,
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
      false,
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
  it("marks ONLY the serving padi active (identity does not ride the row)", () => {
    const rows = assemblePadiInventory(
      [
        padi({ socket: PADI_ACTIVE }),
        padi({ socket: PADI_OTHER, stateRoot: "/tmp/other" }),
      ],
      PADI_ACTIVE,
    );
    // The bound padi is active; a discovered-but-not-owned padi (a leak at another
    // state-root) is not. Version/build live on `daemonInventory.boundPadi`, not here.
    expect(rows.find((r) => r.socket === PADI_ACTIVE)?.active).toBe(true);
    expect(rows.find((r) => r.socket === PADI_OTHER)?.active).toBe(false);
  });

  it("no active socket → nothing active", () => {
    const rows = assemblePadiInventory([padi({ socket: PADI_ACTIVE })], null);
    expect(rows[0]?.active).toBe(false);
  });
});

describe("withSelfPadi — the serving padi reports itself by construction", () => {
  const self = {
    padiSocket: "/run/user/1000/padi-self/padi.sock",
    stateRoot: "/home/u/.local/state/padi",
    // The pid arrives as a VALUE (P2: the sampler reads `process.pid` at the edge); the
    // test constructs its expected row from this input, not from the ambient global.
    pid: 98765,
  };

  it("seeds the serving padi when autodiscovery misses it (T+0 socket-not-listening / --socket override)", () => {
    // The F2/F1 window: discovery returns nothing (the serving socket isn't yet an inode,
    // or the override socket sits outside the scanned `padi-<digest>` dirs). The self row
    // must still appear so `assemblePadiInventory(_, self.padiSocket)` can mark it active
    // and the client's liveness tell (`hostInventoryReadingLive`) reads a real scan.
    const rows = withSelfPadi([], self);
    expect(rows).toEqual([
      {
        socket: self.padiSocket,
        stateRoot: self.stateRoot,
        gatePid: self.pid,
      },
    ]);
    expect(assemblePadiInventory(rows, self.padiSocket)[0]?.active).toBe(true);
  });

  it("keeps a leaked sibling padi AND seeds self alongside it", () => {
    const rows = withSelfPadi([padi({ socket: PADI_OTHER })], self);
    expect(rows.map((r) => r.socket)).toEqual([PADI_OTHER, self.padiSocket]);
  });

  it("does NOT double the self row once autodiscovery finds it (deduped by socket)", () => {
    const rows = withSelfPadi(
      [padi({ socket: self.padiSocket, stateRoot: self.stateRoot })],
      self,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.socket).toBe(self.padiSocket);
  });
});

describe("enumerateHostDaemons — the shared scan orchestration", () => {
  it("padi's own scan (active sockets set) marks the held kaval + serving padi active", async () => {
    const inv = await enumerateHostDaemons({
      discoverKavals: () => [
        kaval({ socket: ACTIVE }),
        kaval({ socket: LEGACY, kind: "port" }),
      ],
      discoverPadis: () => [padi({ socket: PADI_ACTIVE })],
      probe: async (socket) =>
        socket === ACTIVE ? probe({ terminalCount: 2 }) : probe(),
      activeKavalSocket: ACTIVE,
      activeKavalAtLegacy: false,
      activePadiSocket: PADI_ACTIVE,
    });
    expect(inv.kavals.find((k) => k.socket === ACTIVE)).toMatchObject({
      held: { active: true },
      terminalCount: 2,
    });
    expect(inv.kavals.find((k) => k.socket === LEGACY)?.held.active).toBe(
      false,
    );
    expect(inv.padis[0]?.active).toBe(true);
  });

  it("a local-machine scan under a remote binding (no active sockets) marks NOTHING active", async () => {
    // This is exactly how kolu-server drives it for `daemonInventory.localScan`: the
    // machine kolu-server runs on is not the bound host, so no local daemon is kolu's.
    const inv = await enumerateHostDaemons({
      discoverKavals: () => [kaval({ socket: ACTIVE })],
      discoverPadis: () => [padi({ socket: PADI_ACTIVE })],
      probe: async () => probe(),
      activeKavalSocket: null,
      activeKavalAtLegacy: false,
      activePadiSocket: null,
    });
    // Leaks stay VISIBLE (listed) …
    expect(inv.kavals).toHaveLength(1);
    expect(inv.padis).toHaveLength(1);
    // … but none is "in use by kolu".
    expect(inv.kavals[0]?.held.active).toBe(false);
    expect(inv.padis[0]?.active).toBe(false);
  });

  it("a probe that THROWS rejects the scan instead of fabricating an honest-null row", async () => {
    // Only an absent listener is honest absence. A connected peer's protocol, timeout,
    // or validation failure must surface; catching this seam would turn a failed
    // observation into a plausible all-null row.
    await expect(
      enumerateHostDaemons({
        discoverKavals: () => [
          kaval({ socket: ACTIVE }),
          kaval({ socket: STANDALONE, kind: "standalone" }),
        ],
        discoverPadis: () => [],
        probe: async (socket) => {
          if (socket === STANDALONE) throw new Error("probe blew up");
          return probe({ terminalCount: 7 });
        },
        activeKavalSocket: ACTIVE,
        activeKavalAtLegacy: false,
        activePadiSocket: null,
      }),
    ).rejects.toThrow("probe blew up");
  });
});
