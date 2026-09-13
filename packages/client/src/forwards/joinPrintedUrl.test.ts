/**
 * The printed-URL join decision table — including blind vs unbacked, and the
 * host-wide arms.
 *
 * A printed URL never creates a fact. These pins keep the arms honest: external
 * is "not our problem", joined is "this terminal serves it", elsewhere and
 * unclaimed are "the HOST serves it", unbacked is "looked at the whole host and
 * nothing is there", blind is "couldn't look".
 */

import type {
  HostListeners,
  KoluForward,
  PortInfo,
  UnclaimedPort,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  joinPrintedPort,
  joinPrintedUrl,
  tilePortsObservation,
} from "./joinPrintedUrl";

const info = (port: number, name = "node"): PortInfo => ({
  port,
  name,
  command: `${name} --port ${port}`,
  scope: "loopback",
  family: "v4",
});

const hostOf = (
  claimed: PortInfo[],
  unclaimed: UnclaimedPort[] | "blind" = [],
): HostListeners => ({
  status: "known",
  claimed,
  unclaimed:
    unclaimed === "blind"
      ? { status: "unknown" }
      : { status: "known", list: unclaimed },
});

const forward = (port: number, localPort = 61000): KoluForward => ({
  key: `local:${port}`,
  host: { kind: "local" },
  remotePort: port,
  localPort,
  origin: "auto",
  createdAt: 0,
});

describe("tilePortsObservation", () => {
  it("is unknown only when no pane has ever been scanned", () => {
    expect(
      tilePortsObservation([{ status: "unknown" }, { status: "unknown" }]),
    ).toEqual({ status: "unknown" });
  });

  it("is known (even empty) when any pane answered", () => {
    expect(
      tilePortsObservation([
        { status: "unknown" },
        { status: "known", list: [] },
      ]),
    ).toEqual({ status: "known", list: [] });
    expect(
      tilePortsObservation([
        { status: "known", list: [info(5173)] },
        { status: "unknown" },
      ]),
    ).toEqual({ status: "known", list: [info(5173)] });
  });
});

describe("joinPrintedPort — the decision table", () => {
  it("joins when this tile's subtree serves the port, with its door if any", () => {
    expect(
      joinPrintedPort({
        port: 5173,
        observation: { status: "known", list: [info(5173, "vite")] },
        host: hostOf([info(5173, "vite")]),
        forwards: [],
      }),
    ).toEqual({
      kind: "joined",
      port: 5173,
      info: info(5173, "vite"),
      forward: undefined,
    });
    expect(
      joinPrintedPort({
        port: 5173,
        observation: { status: "known", list: [info(5173)] },
        host: hostOf([info(5173)]),
        forwards: [forward(5173, 61003)],
      }),
    ).toMatchObject({
      kind: "joined",
      forward: expect.objectContaining({ localPort: 61003 }),
    });
  });

  it("is ELSEWHERE for a detached server the tile does not hold but the host does", () => {
    // The screenshot this arm exists for: `odu web-daemon` printed its URL from
    // this terminal, then reparented to init. The old join said "nothing is
    // listening yet"; the host says otherwise, with the program and its door.
    const daemon = info(18440, "bun");
    expect(
      joinPrintedPort({
        port: 18440,
        observation: { status: "known", list: [] },
        host: hostOf([daemon]),
        forwards: [forward(18440, 61004)],
      }),
    ).toEqual({
      kind: "elsewhere",
      port: 18440,
      info: daemon,
      forward: forward(18440, 61004),
    });
  });

  it("is UNCLAIMED when something holds the port and its owner is not visible", () => {
    const bind = { port: 8443, scope: "loopback", family: "v4" } as const;
    expect(
      joinPrintedPort({
        port: 8443,
        observation: { status: "known", list: [] },
        host: hostOf([], [bind]),
        forwards: [],
      }),
    ).toEqual({ kind: "unclaimed", port: 8443, bind, forward: undefined });
  });

  it("is unbacked only when the whole host was read and the port is absent", () => {
    expect(
      joinPrintedPort({
        port: 9000,
        observation: { status: "known", list: [info(5173)] },
        host: hostOf([info(5173)]),
        forwards: [],
      }),
    ).toEqual({ kind: "unbacked", port: 9000 });
  });

  it("is BLIND, not unbacked, when the tile says no but the host cannot be read", () => {
    // The old join's lie, pinned shut: a look at one subtree is not a look at
    // the machine.
    expect(
      joinPrintedPort({
        port: 9000,
        observation: { status: "known", list: [] },
        host: { status: "unknown" },
        forwards: [],
      }),
    ).toEqual({ kind: "blind", port: 9000 });
  });

  it("is BLIND when the port is unclaimed-or-absent and the unclaimed half is blind", () => {
    // macOS 27: another user's server may hold it, so "nothing" is not ours to say.
    expect(
      joinPrintedPort({
        port: 9000,
        observation: { status: "known", list: [] },
        host: hostOf([], "blind"),
        forwards: [],
      }),
    ).toEqual({ kind: "blind", port: 9000 });
  });

  it("asks the host even when the tile has never been scanned", () => {
    expect(
      joinPrintedPort({
        port: 18440,
        observation: { status: "unknown" },
        host: hostOf([info(18440, "bun")]),
        forwards: [],
      }),
    ).toMatchObject({ kind: "elsewhere", port: 18440 });
    expect(
      joinPrintedPort({
        port: 5173,
        observation: { status: "unknown" },
        host: { status: "unknown" },
        forwards: [],
      }),
    ).toEqual({ kind: "blind", port: 5173 });
  });

  it("does not invent a join from a forward alone", () => {
    // A door with no listener behind it is still unbacked for a PRINTED URL —
    // the door may be a ⌘K manual for something that died.
    expect(
      joinPrintedPort({
        port: 5173,
        observation: { status: "known", list: [] },
        host: hostOf([]),
        forwards: [forward(5173)],
      }),
    ).toEqual({ kind: "unbacked", port: 5173 });
  });
});

describe("joinPrintedUrl", () => {
  it("is external for a non-loopback URL", () => {
    expect(
      joinPrintedUrl({
        uri: "https://github.com/juspay/kolu",
        observation: { status: "known", list: [info(5173)] },
        host: hostOf([info(5173)]),
        forwards: [],
      }),
    ).toEqual({ kind: "external" });
  });

  it("joins a classic localhost printout", () => {
    expect(
      joinPrintedUrl({
        uri: "http://localhost:5173/",
        observation: { status: "known", list: [info(5173, "vite")] },
        host: hostOf([info(5173, "vite")]),
        forwards: [],
      }),
    ).toMatchObject({ kind: "joined", port: 5173, info: { name: "vite" } });
  });
});
