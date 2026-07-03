/**
 * The pure host-daemon-inventory assembly — which daemon is kolu's ACTIVE one, and
 * legacy (port-keyed) detection — over hand-built discovered lists. No filesystem, no
 * socket: the pure functions are the marking policy in isolation.
 */

import type { PadiDaemon } from "@kolu/padi/assembly";
import type { KavalDaemon } from "kaval";
import { describe, expect, it } from "vitest";
import {
  assembleKavalInventory,
  assemblePadiInventory,
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
  it("marks the bound padi active and gives ONLY it the honest surfaceVersion", () => {
    const rows = assemblePadiInventory(
      [
        padi({ socket: PADI_ACTIVE }),
        padi({ socket: PADI_OTHER, stateRoot: "/tmp/other" }),
      ],
      PADI_ACTIVE,
      "1.1",
    );
    const active = rows.find((r) => r.socket === PADI_ACTIVE);
    const other = rows.find((r) => r.socket === PADI_OTHER);
    expect(active).toMatchObject({ active: true, surfaceVersion: "1.1" });
    // A padi kolu-server is NOT bound to is not probed → null surfaceVersion (honest
    // "unknown"), never the active padi's version leaking onto it.
    expect(other).toMatchObject({ active: false, surfaceVersion: null });
  });

  it("no active socket → nothing active, no surfaceVersion anywhere", () => {
    const rows = assemblePadiInventory(
      [padi({ socket: PADI_ACTIVE })],
      null,
      "1.1",
    );
    expect(rows[0]).toMatchObject({ active: false, surfaceVersion: null });
  });

  it("active padi with an unknown surfaceVersion stays honestly null", () => {
    const rows = assemblePadiInventory(
      [padi({ socket: PADI_ACTIVE })],
      PADI_ACTIVE,
      null,
    );
    expect(rows[0]).toMatchObject({ active: true, surfaceVersion: null });
  });
});
