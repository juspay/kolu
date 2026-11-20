import type {
  HostListeners,
  KoluForward,
  PortInfo,
  PortBind,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { joinPrintedPort, joinPrintedUrl } from "./joinPrintedUrl";

const info = (port: number, name = "node"): PortInfo => ({
  port,
  name,
  command: `${name} --port ${port}`,
  scope: "loopback",
  family: "v4",
});

const hostOf = (
  claimed: PortInfo[],
  unclaimed: PortBind[] | "blind" = [],
): HostListeners => ({
  status: "known",
  claimed: claimed.map((c) => ({ ...c, heldByTerminal: false })),
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

describe("joinPrintedPort — the decision table", () => {
  it("joins when this tile's subtree serves the port, with its door if any", () => {
    expect(
      joinPrintedPort({
        port: 5173,
        tilePorts: [info(5173, "vite")],
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
        tilePorts: [info(5173)],
        host: hostOf([info(5173)]),
        forwards: [forward(5173, 61003)],
      }),
    ).toMatchObject({
      kind: "joined",
      forward: expect.objectContaining({ localPort: 61003 }),
    });
  });

  it("is ELSEWHERE for a detached server the tile does not hold but the host does", () => {
    const daemon = info(18440, "bun");
    expect(
      joinPrintedPort({
        port: 18440,
        tilePorts: [],
        host: hostOf([daemon]),
        forwards: [forward(18440, 61004)],
      }),
    ).toEqual({
      kind: "elsewhere",
      port: 18440,
      info: { ...daemon, heldByTerminal: false },
      forward: forward(18440, 61004),
    });
  });

  it("is UNCLAIMED when something holds the port and its owner is not visible", () => {
    const bind = { port: 8443, scope: "loopback", family: "v4" } as const;
    expect(
      joinPrintedPort({
        port: 8443,
        tilePorts: [],
        host: hostOf([], [bind]),
        forwards: [],
      }),
    ).toEqual({ kind: "unclaimed", port: 8443, bind, forward: undefined });
  });

  it("is unbacked only when the whole host was read and the port is absent", () => {
    expect(
      joinPrintedPort({
        port: 9000,
        tilePorts: [info(5173)],
        host: hostOf([info(5173)]),
        forwards: [],
      }),
    ).toEqual({ kind: "unbacked", port: 9000 });
  });

  it("is BLIND, not unbacked, when the tile says no but the host cannot be read", () => {
    expect(
      joinPrintedPort({
        port: 9000,
        tilePorts: [],
        host: { status: "unknown" },
        forwards: [],
      }),
    ).toEqual({ kind: "blind", port: 9000 });
  });

  it("is BLIND when the port is unclaimed-or-absent and the unclaimed half is blind", () => {
    expect(
      joinPrintedPort({
        port: 9000,
        tilePorts: [],
        host: hostOf([], "blind"),
        forwards: [],
      }),
    ).toEqual({ kind: "blind", port: 9000 });
  });

  it("asks the host when the tile holds no such port — scanned or not", () => {
    expect(
      joinPrintedPort({
        port: 18440,
        tilePorts: [],
        host: hostOf([info(18440, "bun")]),
        forwards: [],
      }),
    ).toMatchObject({ kind: "elsewhere", port: 18440 });
    expect(
      joinPrintedPort({
        port: 5173,
        tilePorts: [],
        host: { status: "unknown" },
        forwards: [],
      }),
    ).toEqual({ kind: "blind", port: 5173 });
  });

  it("does not invent a join from a forward alone", () => {
    expect(
      joinPrintedPort({
        port: 5173,
        tilePorts: [],
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
        tilePorts: [info(5173)],
        host: hostOf([info(5173)]),
        forwards: [],
      }),
    ).toEqual({ kind: "external" });
  });

  it("joins a classic localhost printout", () => {
    expect(
      joinPrintedUrl({
        uri: "http://localhost:5173/",
        tilePorts: [info(5173, "vite")],
        host: hostOf([info(5173, "vite")]),
        forwards: [],
      }),
    ).toMatchObject({ kind: "joined", port: 5173, info: { name: "vite" } });
  });
});
