/**
 * Reading a host's listening ports — and, above all, that the read TERMINATES.
 *
 * This reader feeds the forward reaper, and it runs inside a reactor poll cell.
 * A read that never resolves does not merely miss a sample: `pollSource`'s
 * in-flight latch is still held, so the `forwards` cell stops recomputing for
 * the life of the process — every door frozen, none reaped, and nothing logged.
 * That is the same class of wedge as the PRT2 production freeze, reached from a
 * different direction.
 *
 * The way in is `collectionHandlers.get`'s held-open-on-absent semantic (#1681):
 * a `get` for a key that is not a member yields nothing and never ends. The key
 * list comes from a `keys` frame a few awaits earlier, and kolu terminals go
 * away routinely (a pane closed, a PTY exits), so the gap between "was a member"
 * and "is a member" is real rather than theoretical.
 */

import type { Logger } from "@kolu/log";
import { describe, expect, it, vi } from "vitest";
import {
  type HostPorts,
  makeHostPortsReader,
  type TerminalsFace,
} from "./hostPorts.ts";

const host = { kind: "local" } as const;

/** The budget these cases read under. Generous, because none of them is about
 *  the deadline itself — the one that IS (a member whose `get` never yields)
 *  is bounded by MEMBERSHIP, which is the point of that reader. */
const TEST_DEADLINE_MS = 10_000;

/** The observed map, or a failure naming the arm that came back instead. */
function knownOf(ports: HostPorts): ReadonlyMap<number, string> {
  if (ports.status !== "known") throw new Error("expected an observation");
  return ports.ports;
}

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

/** An async iterable that yields the given frames and then stays OPEN — the
 *  shape a live surface stream actually has (it does not end when it runs out
 *  of things to say). */
function stream<T>(frames: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const f of frames) yield f;
      await new Promise<never>(() => {});
    },
  };
}

/** The one that never speaks: `get` for a key that is not a member. */
function silent(): AsyncIterable<never> {
  return {
    async *[Symbol.asyncIterator]() {
      await new Promise<never>(() => {});
    },
  };
}

function terminalRecord(ports: readonly { port: number; family: string }[]) {
  // `activePadiTerminal` is a discriminated read — `state: "active"` is the arm
  // that carries `ports` at all, which is the whole point of the two-way.
  return {
    state: "active",
    parentId: null,
    cwd: "/tmp",
    git: null,
    ports: {
      status: "known",
      list: ports.map((p) => ({
        port: p.port,
        name: "node",
        scope: "loopback",
        family: p.family,
      })),
    },
  };
}

describe("makeHostPortsReader", () => {
  it("does not hang when a key from the keys frame is already gone", async () => {
    // The race, exactly: the first `keys` frame carries `gone`, so the reader
    // asks for it — and its `get` is the held-open-on-absent stream that never
    // yields. The bound has to come from MEMBERSHIP (a later keys frame without
    // it), which is what the framework's collection-item reader races against.
    const terminals: TerminalsFace = {
      keys: async () => stream([["alive", "gone"], ["alive"]]),
      get: async ({ key }) =>
        key === "alive"
          ? stream([terminalRecord([{ port: 5173, family: "v4" }])])
          : silent(),
    };
    const read = makeHostPortsReader({ terminalsOf: () => terminals, log });

    const ports = await read(host, TEST_DEADLINE_MS);

    // `alive` was observed and serves 5173; `gone` contributes nothing. The
    // reading is an observation either way — which is what lets a dead port be
    // reaped rather than kept alive by one vanished pane.
    expect(ports.status).toBe("known");
    expect([...knownOf(ports)]).toEqual([[5173, "v4"]]);
  }, 10_000);

  it("reports `unknown` rather than an empty map when the host has no session", async () => {
    // "We could not look" must never read as "nothing is listening" — an empty
    // map here would reap every auto door on the host.
    const read = makeHostPortsReader({ terminalsOf: () => null, log });
    await expect(read(host, TEST_DEADLINE_MS)).resolves.toEqual({
      status: "unknown",
    });
  });

  it("reports `unknown` when no terminal has ever been scanned", async () => {
    const terminals: TerminalsFace = {
      keys: async () => stream([["a"]]),
      get: async () =>
        stream([{ state: "active", ports: { status: "unknown" } }]),
    };
    const read = makeHostPortsReader({ terminalsOf: () => terminals, log });
    await expect(read(host, TEST_DEADLINE_MS)).resolves.toEqual({
      status: "unknown",
    });
  });

  it("folds the family across terminals sharing a port — v4 wins", async () => {
    // A fork or a shared socket puts one port in two subtrees. The families fold
    // by the same rule the per-terminal fold uses, not by last-write, because
    // the family decides which loopback address the door dials.
    const terminals: TerminalsFace = {
      keys: async () => stream([["a", "b"]]),
      get: async ({ key }) =>
        stream([
          terminalRecord([{ port: 3000, family: key === "a" ? "v6" : "v4" }]),
        ]),
    };
    const read = makeHostPortsReader({ terminalsOf: () => terminals, log });
    const ports = await read(host, TEST_DEADLINE_MS);
    expect([...knownOf(ports)]).toEqual([[3000, "v4"]]);
  });
});

describe("a partial read is not an observation", () => {
  it("reports `unknown` when a still-member terminal could not be read", async () => {
    // The reaper acts on POSITIVE evidence: a port absent from a `known`
    // reading is a dead listener, and the door closes. That rule is only as
    // honest as `known`.
    //
    // Here two panes are members. One answered and serves nothing. The other
    // holds the actual dev server, and its read hit the deadline — the mirror
    // went quiet, but the key never left the collection. Folding those into one
    // `known` map publishes "this host serves nothing" on the strength of the
    // pane that happened to answer, and reconcile then cancels a door with a
    // live listener behind it.
    //
    // A VANISHED key is different and stays a non-contributor: it is gone, so
    // it genuinely cannot be serving anything. The framework reports which of
    // the two happened, so this does not have to guess.
    const QUIET_MS = 150;
    const terminals: TerminalsFace = {
      // Both keys stay members for the whole read — nothing departs.
      keys: async () => stream([["answered", "wedged"]]),
      get: async ({ key }) =>
        key === "answered" ? stream([terminalRecord([])]) : silent(),
    };
    const read = makeHostPortsReader({ terminalsOf: () => terminals, log });

    await expect(read(host, QUIET_MS)).resolves.toEqual({ status: "unknown" });
  }, 10_000);
});

describe("the cost of a host is ONE slow read, not one per terminal", () => {
  it("reads a host's terminals all at once", async () => {
    // Three panes that have gone quiet: each read ends only when MEMBERSHIP
    // says the key is gone, and that answer takes as long as the mirror takes
    // to speak again. Serially the host costs 3 × that wait — on the click
    // path too, with the Inspector's button disabled and a blank tab already
    // open beside it. The reads are independent and each is individually
    // bounded, so they run together and the host costs one wait.
    const QUIET_MS = 200;
    const terminals: TerminalsFace = {
      keys: async () => ({
        async *[Symbol.asyncIterator]() {
          yield ["a", "b", "c"];
          await new Promise((r) => setTimeout(r, QUIET_MS));
          yield [];
          await new Promise<never>(() => {});
        },
      }),
      get: async () => silent(),
    };
    const read = makeHostPortsReader({ terminalsOf: () => terminals, log });

    const began = Date.now();
    await expect(read(host, TEST_DEADLINE_MS)).resolves.toEqual({
      status: "unknown",
    });
    expect(Date.now() - began).toBeLessThan(QUIET_MS * 2);
  });
});
