import type { PadiDaemon } from "./stateRoot.ts";
import { Effect } from "effect";
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
    expect(rows[0]?.held).toEqual({ active: true, atLegacyAddress: false });
  });

  it("an ADOPTED legacy-address kaval reads as active + atLegacyAddress (converging, NOT a leak)", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: LEGACY, kind: "stateRoot" })],
      new Map(),
      LEGACY,
      true,
    );
    expect(rows[0]).toMatchObject({
      held: { active: true, atLegacyAddress: true },
      kind: "stateRoot",
    });
  });

  it("a STRAY legacy `port` kaval that is NOT held stays a flaggable leak (not converging)", () => {
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
      DIGEST,
      false,
    );
    const stray = rows.find((r) => r.socket === LEGACY);
    expect(stray).toMatchObject({ held: { active: false }, kind: "port" });
  });

  it("the legacy hint is UNREPRESENTABLE off the active arm — a non-held daemon can't converge", () => {
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
    pid: 98765,
  };

  it("seeds the serving padi when autodiscovery misses it (T+0 socket-not-listening / --socket override)", () => {
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
    const inv = await Effect.runPromise(
      enumerateHostDaemons({
        discoverKavals: () => [
          kaval({ socket: ACTIVE }),
          kaval({ socket: LEGACY, kind: "port" }),
        ],
        discoverPadis: () => [padi({ socket: PADI_ACTIVE })],
        probe: (socket) =>
          Effect.succeed(
            socket === ACTIVE ? probe({ terminalCount: 2 }) : probe(),
          ),
        activeKavalSocket: ACTIVE,
        activeKavalAtLegacy: false,
        activePadiSocket: PADI_ACTIVE,
      }),
    );
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
    const inv = await Effect.runPromise(
      enumerateHostDaemons({
        discoverKavals: () => [kaval({ socket: ACTIVE })],
        discoverPadis: () => [padi({ socket: PADI_ACTIVE })],
        probe: () => Effect.succeed(probe()),
        activeKavalSocket: null,
        activeKavalAtLegacy: false,
        activePadiSocket: null,
      }),
    );
    expect(inv.kavals).toHaveLength(1);
    expect(inv.padis).toHaveLength(1);
    expect(inv.kavals[0]?.held.active).toBe(false);
    expect(inv.padis[0]?.active).toBe(false);
  });

  it("a probe that THROWS rejects the scan instead of fabricating an honest-null row", async () => {
    await expect(
      Effect.runPromise(
        enumerateHostDaemons({
          discoverKavals: () => [
            kaval({ socket: ACTIVE }),
            kaval({ socket: STANDALONE, kind: "standalone" }),
          ],
          discoverPadis: () => [],
          probe: (socket) =>
            socket === STANDALONE
              ? Effect.fail(new Error("probe blew up"))
              : Effect.succeed(probe({ terminalCount: 7 })),
          activeKavalSocket: ACTIVE,
          activeKavalAtLegacy: false,
          activePadiSocket: null,
        }),
      ),
    ).rejects.toThrow("probe blew up");
  });
});
