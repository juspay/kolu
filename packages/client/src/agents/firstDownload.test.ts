/** A host's download settling, seen through the SAME shape a real cell
 *  subscription hands the client: one store slot written with `reconcile`, so
 *  the value object keeps its identity across the transition. A watcher keyed
 *  on that object (the shipped bug) sees nothing; this one must see the edge. */

import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import { createRoot } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { describe, expect, it } from "vitest";
import { watchDownload } from "./firstDownload";

/** Solid flushes `createEffect` on a microtask; a macrotask tick drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness() {
  const [store, setStore] = createStore<{ v: AgentDistroStatus | undefined }>({
    v: undefined,
  });
  const write = (next: AgentDistroStatus) => setStore("v", reconcile(next));
  const started: number[] = [];
  const ready: number[] = [];
  const errors: string[] = [];
  let dispose = () => {};
  createRoot((d) => {
    dispose = d;
    watchDownload(() => store.v, {
      onStart: () => started.push(1),
      onReady: () => ready.push(1),
      onError: (m) => errors.push(m),
    });
  });
  return { store, write, started, ready, errors, dispose };
}

describe("watchDownload", () => {
  it("fires once on downloading → ready, though the value object never changes identity", async () => {
    const h = harness();
    h.write({ kind: "downloading", profile: "vanilla" });
    await flush();
    const before = h.store.v;
    h.write({
      kind: "downloading",
      profile: "vanilla",
      progress: { done: 1, total: 2 },
    });
    await flush();
    h.write({ kind: "ready", profile: "vanilla", bundle: "/nix/store/x" });
    await flush();
    // The premise: reconcile kept the same object across the transition.
    expect(h.store.v).toBe(before);
    expect(h.started).toEqual([1]);
    expect(h.ready).toEqual([1]);
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("reports downloading → error with the updater's message", async () => {
    const h = harness();
    h.write({ kind: "downloading", profile: "vanilla" });
    await flush();
    h.write({ kind: "error", profile: "vanilla", message: "cache not usable" });
    await flush();
    expect(h.errors).toEqual(["cache not usable"]);
    expect(h.ready).toEqual([]);
    h.dispose();
  });

  it("stays quiet for a host that was already ready, or turned off", async () => {
    const h = harness();
    h.write({ kind: "ready", profile: "vanilla", bundle: "/nix/store/x" });
    await flush();
    h.write({ kind: "off" });
    await flush();
    h.write({ kind: "ready", profile: "vanilla", bundle: "/nix/store/x" });
    await flush();
    expect(h.ready).toEqual([]);
    expect(h.started).toEqual([]);
    h.dispose();
  });

  it("a progress tick is not a second start", async () => {
    const h = harness();
    h.write({ kind: "downloading", profile: "vanilla" });
    await flush();
    h.write({
      kind: "downloading",
      profile: "vanilla",
      progress: { done: 5, total: 9 },
    });
    await flush();
    expect(h.started).toEqual([1]);
    h.dispose();
  });
});
