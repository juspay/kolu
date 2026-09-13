/**
 * Reading a host's listening ports for the forward reaper — what counts as an
 * observation, and that the read TERMINATES.
 *
 * This reader runs inside a reactor poll cell. A read that never resolves does
 * not merely miss a sample: `pollSource`'s in-flight latch stays held, so the
 * `forwards` cell stops recomputing for the life of the process — every door
 * frozen, none reaped, nothing logged. Hence the deadline case below.
 */

import type { Logger } from "@kolu/log";
import { Stream } from "effect";
import type { HostListeners, PortInfo } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
  type HostPorts,
  hostPortsOf,
  makeHostPortsReader,
} from "./hostPorts.ts";

const host = { kind: "local" } as const;
const TEST_DEADLINE_MS = 10_000;

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

/** A cell stream that yields its frames and then stays OPEN, as a live cell does. */
function stream<T>(frames: readonly T[]): Stream.Stream<T> {
  return Stream.concat(Stream.fromArray(frames), Stream.never);
}

const claimed = (port: number, family: "v4" | "v6" = "v4"): PortInfo => ({
  port,
  name: "bun",
  command: "bun odu web-daemon",
  scope: "loopback",
  family,
});

function knownOf(ports: HostPorts): [number, string][] {
  if (ports.status !== "known") throw new Error("expected an observation");
  return [...ports.ports];
}

describe("hostPortsOf — what the reaper may act on", () => {
  it("counts a listener no terminal holds", () => {
    // The defect this reading replaced: a door onto a DETACHED server was reaped
    // within one interval, because the old evidence was the union of every
    // terminal's own ports, and a detached server is in none of them.
    const reading: HostListeners = {
      status: "known",
      claimed: [claimed(18440)],
      unclaimed: { status: "known", list: [] },
    };
    expect(knownOf(hostPortsOf(reading))).toEqual([[18440, "v4"]]);
  });

  it("counts another user's socket when that half was read", () => {
    expect(
      knownOf(
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

  it("folds a port claimed on one family and unclaimed on the other — v4 wins", () => {
    expect(
      knownOf(
        hostPortsOf({
          status: "known",
          claimed: [claimed(3000, "v6")],
          unclaimed: {
            status: "known",
            list: [{ port: 3000, scope: "loopback", family: "v4" }],
          },
        }),
      ),
    ).toEqual([[3000, "v4"]]);
  });

  it("keeps the claimed half an observation when the unclaimed half is blind", () => {
    // macOS 27. Every auto door there was born onto a claimed listener, so that
    // listener leaving the claimed set is its death.
    expect(
      knownOf(
        hostPortsOf({
          status: "known",
          claimed: [claimed(5173)],
          unclaimed: { status: "unknown" },
        }),
      ),
    ).toEqual([[5173, "v4"]]);
  });

  it("is unknown for a host that is not being scanned", () => {
    expect(hostPortsOf({ status: "unknown" })).toEqual({ status: "unknown" });
  });
});

describe("makeHostPortsReader", () => {
  it("reads the cell's current frame", async () => {
    const read = makeHostPortsReader({
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
    expect(knownOf(await read(host, TEST_DEADLINE_MS))).toEqual([
      [18440, "v4"],
    ]);
  });

  it("reports `unknown` rather than an empty map when the host has no session", async () => {
    // "We could not look" must never read as "nothing is listening" — an empty
    // map here would reap every auto door on the host.
    const read = makeHostPortsReader({ listenersOf: () => null, log });
    await expect(read(host, TEST_DEADLINE_MS)).resolves.toEqual({
      status: "unknown",
    });
  });

  it("TERMINATES with `unknown` when the mirror never answers", async () => {
    const read = makeHostPortsReader({
      listenersOf: () => Stream.never,
      log,
    });
    const began = Date.now();
    await expect(read(host, 100)).resolves.toEqual({ status: "unknown" });
    expect(Date.now() - began).toBeLessThan(2_000);
  });

  it("reports `unknown` when the stream fails — a failed read is not a dead port", async () => {
    const read = makeHostPortsReader({
      listenersOf: () => Stream.fail(new Error("link dropped")),
      log,
    });
    await expect(read(host, TEST_DEADLINE_MS)).resolves.toEqual({
      status: "unknown",
    });
  });

  it("reports `unknown` when the stream ends without a frame", async () => {
    const read = makeHostPortsReader({
      listenersOf: () => Stream.empty,
      log,
    });
    await expect(read(host, TEST_DEADLINE_MS)).resolves.toEqual({
      status: "unknown",
    });
  });
});
