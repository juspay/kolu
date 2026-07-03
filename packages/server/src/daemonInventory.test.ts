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
} from "./daemonInventory.ts";

const ACTIVE = "/run/user/1000/kaval-abc123/pty-host.sock";
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
    );
    expect(rows.map((r) => [r.socket, r.active])).toEqual([
      [ACTIVE, true],
      [LEGACY, false],
      [STANDALONE, false],
    ]);
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
    );
    // A legacy port-keyed kaval — NOT owned by any padi, and not the active one.
    expect(rows[0]).toMatchObject({ kind: "port", active: false });
  });

  it("no active socket (padi unbound) → nothing is marked active", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: ACTIVE }), kaval({ socket: LEGACY, kind: "port" })],
      new Map(),
      null,
    );
    expect(rows.every((r) => !r.active)).toBe(true);
  });

  it("folds a present probe onto its socket and a MISSING probe to honest nulls", () => {
    const rows = assembleKavalInventory(
      [kaval({ socket: ACTIVE }), kaval({ socket: LEGACY, kind: "port" })],
      new Map([[ACTIVE, probe({ terminalCount: 5, contractVersion: "5.0" })]]),
      ACTIVE,
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
