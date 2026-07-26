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
import { makeHostPortsReader, type TerminalsFace } from "./hostPorts.ts";

const host = { kind: "local" } as const;

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

    const ports = await read(host);

    // `alive` was observed and serves 5173; `gone` contributes nothing. The
    // reading is an observation either way — which is what lets a dead port be
    // reaped rather than kept alive by one vanished pane.
    expect(ports).not.toBe("unknown");
    expect([...(ports as ReadonlyMap<number, string>)]).toEqual([[5173, "v4"]]);
  }, 10_000);

  it("reports `unknown` rather than an empty map when the host has no session", async () => {
    // "We could not look" must never read as "nothing is listening" — an empty
    // map here would reap every auto door on the host.
    const read = makeHostPortsReader({ terminalsOf: () => null, log });
    await expect(read(host)).resolves.toBe("unknown");
  });

  it("reports `unknown` when no terminal has ever been scanned", async () => {
    const terminals: TerminalsFace = {
      keys: async () => stream([["a"]]),
      get: async () =>
        stream([{ state: "active", ports: { status: "unknown" } }]),
    };
    const read = makeHostPortsReader({ terminalsOf: () => terminals, log });
    await expect(read(host)).resolves.toBe("unknown");
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
    const ports = await read(host);
    expect([...(ports as ReadonlyMap<number, string>)]).toEqual([[3000, "v4"]]);
  });
});
