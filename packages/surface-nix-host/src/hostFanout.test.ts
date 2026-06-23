import type { AnyContractRouter } from "@orpc/contract";
import { describe, expect, it, vi } from "vitest";
import {
  buildHostRegistry,
  type ClosableSocket,
  type HostEntry,
} from "./hostFanout";
import type { HostSession } from "./hostSession";

/** A stand-in for the slice of `HostSession` the registry touches
 *  (`destroy`/`reconnect`/`recheck`). `HostSession` is a class, so we mint a
 *  structural stub with spies and cast at the `buildEntry` boundary — the
 *  registry never reaches past these three methods. */
function fakeSession() {
  const session = {
    destroy: vi.fn(),
    reconnect: vi.fn(),
    recheck: vi.fn(),
  };
  return session as typeof session & HostSession<AnyContractRouter>;
}

type Handler = { id: string };

/** Build a registry whose `buildEntry` records each host's stub session +
 *  handler so a test can assert against them, plus a `persist` spy. */
function harness(initialHosts: readonly string[]) {
  const built = new Map<string, HostEntry<AnyContractRouter, Handler>>();
  const persist = vi.fn(async (_hosts: string[]) => {});
  const registry = buildHostRegistry<AnyContractRouter, Handler>({
    initialHosts,
    persist,
    buildEntry: (host) => {
      const entry: HostEntry<AnyContractRouter, Handler> = {
        session: fakeSession(),
        handler: { id: host },
      };
      built.set(host, entry);
      return entry;
    },
  });
  return { registry, built, persist };
}

const socket = () => {
  const close = vi.fn<(code: number, reason?: string) => void>();
  return { close } satisfies ClosableSocket;
};

describe("buildHostRegistry", () => {
  it("seeds initial hosts synchronously, in insertion order", () => {
    const { registry } = harness(["alpha", "beta"]);
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
    expect(registry.has("alpha")).toBe(true);
    expect(registry.has("ghost")).toBe(false);
    expect(registry.getHandler("beta")).toEqual({ id: "beta" });
    expect(registry.getHandler("ghost")).toBeUndefined();
  });

  it("does NOT persist the initial seed (only mutations persist)", () => {
    const { persist } = harness(["alpha"]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("add() builds an entry, persists the full set, and rejects duplicates", async () => {
    const { registry, persist } = harness(["alpha"]);
    await registry.add("beta");
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
    expect(persist).toHaveBeenCalledWith(["alpha", "beta"]);
    await expect(registry.add("beta")).rejects.toThrow("host already exists");
  });

  it("remove() destroys the session, evicts open sockets, and persists", async () => {
    const { registry, built } = harness(["alpha", "beta"]);
    const ws = socket();
    registry.registerConnection("alpha", ws);
    await registry.remove("alpha");
    expect(registry.has("alpha")).toBe(false);
    expect(registry.hosts()).toEqual(["beta"]);
    expect(built.get("alpha")?.session.destroy).toHaveBeenCalledOnce();
    expect(ws.close).toHaveBeenCalledWith(1000, "host removed");
  });

  it("remove() is a no-op for an unknown host", async () => {
    const { registry, persist } = harness(["alpha"]);
    await registry.remove("ghost");
    expect(registry.hosts()).toEqual(["alpha"]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("a removed host's socket is NOT closed again on a later removal", async () => {
    const { registry } = harness(["alpha"]);
    const ws = socket();
    registry.registerConnection("alpha", ws);
    registry.unregisterConnection("alpha", ws);
    await registry.remove("alpha");
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("reconnect() re-arms only the named host's session", () => {
    const { registry, built } = harness(["alpha", "beta"]);
    registry.reconnect("alpha");
    expect(built.get("alpha")?.session.reconnect).toHaveBeenCalledOnce();
    expect(built.get("beta")?.session.reconnect).not.toHaveBeenCalled();
    // No-op for an unknown host (must not throw).
    expect(() => registry.reconnect("ghost")).not.toThrow();
  });

  it("recheckAll() cycles every host's session", () => {
    const { registry, built } = harness(["alpha", "beta"]);
    registry.recheckAll();
    expect(built.get("alpha")?.session.recheck).toHaveBeenCalledOnce();
    expect(built.get("beta")?.session.recheck).toHaveBeenCalledOnce();
  });

  it("destroyAll() tears down every session and empties the registry", () => {
    const { registry, built } = harness(["alpha", "beta"]);
    registry.destroyAll();
    expect(registry.hosts()).toEqual([]);
    expect(built.get("alpha")?.session.destroy).toHaveBeenCalledOnce();
    expect(built.get("beta")?.session.destroy).toHaveBeenCalledOnce();
  });

  it("works with no persist hook (a static host set)", async () => {
    const registry = buildHostRegistry<AnyContractRouter, Handler>({
      initialHosts: ["alpha"],
      buildEntry: (host) => ({ session: fakeSession(), handler: { id: host } }),
    });
    // add still works; it just skips persistence.
    await registry.add("beta");
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
  });
});
