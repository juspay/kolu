import type { Logger } from "@kolu/log";
import { Stream } from "effect";
import type { HostListeners, HostPort } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
  type HostPorts,
  hostPortsOf,
  makeHostPortsReader,
} from "./hostPorts.ts";

const host = { kind: "local" } as const;

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function stream<T>(frames: readonly T[]): Stream.Stream<T> {
  return Stream.concat(Stream.fromArray(frames), Stream.never);
}

const claimed = (port: number, family: "v4" | "v6" = "v4"): HostPort => ({
  port,
  name: "bun",
  command: "bun odu web-daemon",
  scope: "loopback",
  family,
  heldByTerminal: false,
});

function observedOf(ports: HostPorts): [number, string][] {
  if (ports.status !== "observed") throw new Error("expected an observation");
  return [...ports.ports];
}

describe("hostPortsOf — what the reaper may act on", () => {
  it("counts a listener no terminal holds", () => {
    const reading: HostListeners = {
      status: "known",
      claimed: [claimed(18440)],
      unclaimed: { status: "known", list: [] },
    };
    expect(observedOf(hostPortsOf(reading))).toEqual([[18440, "v4"]]);
  });

  it("counts another user's socket when that half was read", () => {
    expect(
      observedOf(
        hostPortsOf({
          status: "known",
          claimed: [],
          unclaimed: {
            status: "known",
            list: [{ port: 5432, scope: "loopback", family: "v6" }],
          },
        }),
      ),
    ).toEqual([[5432, "v6"]]);
  });

  it("folds a claimed and an unclaimed bind of one port by SCOPE first, then family", () => {
    expect(
      observedOf(
        hostPortsOf({
          status: "known",
          claimed: [claimed(5173, "v6")],
          unclaimed: {
            status: "known",
            list: [{ port: 5173, scope: "interface", family: "v4" }],
          },
        }),
      ),
    ).toEqual([[5173, "v6"]]);
  });

  it("dials the listener the user was SHOWN when both halves hold one scope", () => {
    expect(
      observedOf(
        hostPortsOf({
          status: "known",
          claimed: [claimed(3000, "v6")],
          unclaimed: {
            status: "known",
            list: [{ port: 3000, scope: "loopback", family: "v4" }],
          },
        }),
      ),
    ).toEqual([[3000, "v6"]]);
  });

  it("keeps the claimed half an observation when the unclaimed half is blind", () => {
    expect(
      observedOf(
        hostPortsOf({
          status: "known",
          claimed: [claimed(5173)],
          unclaimed: { status: "unknown" },
        }),
      ),
    ).toEqual([[5173, "v4"]]);
  });

  it("is unobserved for a host that is not being scanned", () => {
    expect(hostPortsOf({ status: "unknown" })).toEqual({
      status: "unobserved",
    });
  });
});

describe("makeHostPortsReader", () => {
  it("reads the cell's current frame", async () => {
    const reader = makeHostPortsReader({
      listenersOf: () =>
        stream<HostListeners>([
          {
            status: "known",
            claimed: [claimed(18440)],
            unclaimed: { status: "known", list: [] },
          },
        ]),
      log,
    });
    expect(observedOf(await reader.forReap(host))).toEqual([[18440, "v4"]]);
    expect(observedOf(await reader.forOpeningClick(host))).toEqual([
      [18440, "v4"],
    ]);
  });

  it("reports `unobserved` rather than an empty map when the host has no session", async () => {
    const reader = makeHostPortsReader({ listenersOf: () => null, log });
    await expect(reader.forReap(host)).resolves.toEqual({
      status: "unobserved",
    });
  });

  it("TERMINATES with `unobserved` when the mirror never answers", async () => {
    const reader = makeHostPortsReader({
      listenersOf: () => Stream.never,
      log,
      budgetsMs: { reap: 100, openingClick: 100 },
    });
    const began = Date.now();
    await expect(reader.forReap(host)).resolves.toEqual({
      status: "unobserved",
    });
    expect(Date.now() - began).toBeLessThan(2_000);
  });

  it("spends the reaper's budget on a reap and the click's on an opening click", async () => {
    const reader = makeHostPortsReader({
      listenersOf: () => Stream.never,
      log,
      budgetsMs: { reap: 400, openingClick: 50 },
    });
    const reapBegan = Date.now();
    await reader.forReap(host);
    const reapTook = Date.now() - reapBegan;
    const clickBegan = Date.now();
    await reader.forOpeningClick(host);
    expect(Date.now() - clickBegan).toBeLessThan(reapTook);
  });

  it("reports `unobserved` when the stream fails — a failed read is not a dead port", async () => {
    const reader = makeHostPortsReader({
      listenersOf: () => Stream.fail(new Error("link dropped")),
      log,
    });
    await expect(reader.forReap(host)).resolves.toEqual({
      status: "unobserved",
    });
  });

  it("reports `unobserved` when the stream ends without a frame", async () => {
    const reader = makeHostPortsReader({
      listenersOf: () => Stream.empty,
      log,
    });
    await expect(reader.forReap(host)).resolves.toEqual({
      status: "unobserved",
    });
  });
});
