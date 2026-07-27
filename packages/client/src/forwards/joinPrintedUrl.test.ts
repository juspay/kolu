/**
 * The printed-URL join decision table — including blind vs unbacked.
 *
 * A printed URL never creates a fact. These pins keep the four arms honest:
 * external is "not our problem", blind is "couldn't look", unbacked is "looked
 * and nothing is there", joined is "the scanner sees it".
 */

import type { KoluForward, PortInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  joinPrintedPort,
  joinPrintedUrl,
  tilePortsObservation,
} from "./joinPrintedUrl";

const info = (port: number, name = "node"): PortInfo => ({
  port,
  name,
  scope: "loopback",
  family: "v4",
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
  it("joins when the scanner sees the port, with its door if any", () => {
    expect(
      joinPrintedPort({
        port: 5173,
        observation: { status: "known", list: [info(5173, "vite")] },
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
        forwards: [forward(5173, 61003)],
      }),
    ).toMatchObject({
      kind: "joined",
      forward: expect.objectContaining({ localPort: 61003 }),
    });
  });

  it("is unbacked when the scan looked and the port is absent", () => {
    // Known-empty is "we looked; nothing is listening" — never blind.
    expect(
      joinPrintedPort({
        port: 9000,
        observation: { status: "known", list: [] },
        forwards: [],
      }),
    ).toEqual({ kind: "unbacked", port: 9000 });
    expect(
      joinPrintedPort({
        port: 9000,
        observation: { status: "known", list: [info(5173)] },
        forwards: [],
      }),
    ).toEqual({ kind: "unbacked", port: 9000 });
  });

  it("is blind when the scan could not look — unknown is never no", () => {
    // The arm that must not collapse into unbacked: a blind scan that has never
    // answered is "can't tell right now", not "nothing is listening".
    expect(
      joinPrintedPort({
        port: 5173,
        observation: { status: "unknown" },
        forwards: [],
      }),
    ).toEqual({ kind: "blind", port: 5173 });
  });

  it("does not invent a join from a forward alone", () => {
    // A door with no scanned port is still unbacked for a PRINTED URL — the
    // door may be a ⌘K manual for something else. The card does not create
    // facts from text, and it does not treat a host-scoped door as proof this
    // terminal serves the port.
    expect(
      joinPrintedPort({
        port: 5173,
        observation: { status: "known", list: [] },
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
        forwards: [],
      }),
    ).toEqual({ kind: "external" });
  });

  it("joins a classic localhost printout", () => {
    expect(
      joinPrintedUrl({
        uri: "http://localhost:5173/",
        observation: { status: "known", list: [info(5173, "vite")] },
        forwards: [],
      }),
    ).toMatchObject({ kind: "joined", port: 5173, info: { name: "vite" } });
  });
});
