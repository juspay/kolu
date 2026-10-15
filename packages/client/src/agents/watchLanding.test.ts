/** An update landing, seen through the SAME shape a real cell subscription
 *  hands the client: one store slot written with `reconcile`, so the value
 *  object keeps its identity across the transition. A watcher keyed on that
 *  object sees nothing; this one must see the edge. */

import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import { createRoot } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { describe, expect, it } from "vitest";
import { watchLanding } from "./watchLanding";

/** Solid flushes `createEffect` on a microtask; a macrotask tick drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness() {
  const [store, setStore] = createStore<{ v: AgentDistroStatus | undefined }>({
    v: undefined,
  });
  const write = (next: AgentDistroStatus) => setStore("v", reconcile(next));
  const landed: string[] = [];
  let dispose = () => {};
  createRoot((d) => {
    dispose = d;
    watchLanding(
      () => store.v,
      (set) => landed.push(set),
    );
  });
  return { store, write, landed, dispose };
}

const JUSPAY = "github:juspay/skills";

/** A ready status: the package `bundle`, and Juspay's profile built at
 *  `profilePath` when given. */
const ready = (
  bundle: string,
  opts: { delivering?: boolean; profilePath?: string } = {},
): AgentDistroStatus => ({
  kind: "ready",
  profiles: opts.profilePath === undefined ? [] : [JUSPAY],
  bundle,
  delivered:
    opts.profilePath === undefined
      ? []
      : [{ reference: JUSPAY, name: "juspay", path: opts.profilePath }],
  delivering: opts.delivering ?? false,
});

/** The set `landedFacts` names for a package and its profile builds. */
const set = (...paths: string[]) => JSON.stringify(paths);

describe("watchLanding", () => {
  it("fires once when another package lands, though the value object never changes identity", async () => {
    const h = harness();
    h.write(ready("/nix/store/a"));
    await flush();
    const before = h.store.v;
    h.write(ready("/nix/store/a", { delivering: true }));
    await flush();
    h.write(ready("/nix/store/b"));
    await flush();
    // The premise: reconcile kept the same object across the landing.
    expect(h.store.v).toBe(before);
    expect(h.landed).toEqual([set("/nix/store/b")]);
    h.dispose();
  });

  it("a newer profile build over the same package is an update too", async () => {
    const h = harness();
    h.write(ready("/nix/store/a", { profilePath: "/nix/store/p1" }));
    await flush();
    h.write(ready("/nix/store/a", { profilePath: "/nix/store/p2" }));
    await flush();
    expect(h.landed).toEqual([set("/nix/store/a", "/nix/store/p2")]);
    h.dispose();
  });

  it("a first delivery or a change of the stack is not an update", async () => {
    const h = harness();
    h.write({ kind: "downloading", profiles: [] });
    await flush();
    h.write(ready("/nix/store/a"));
    await flush();
    h.write(ready("/nix/store/c", { profilePath: "/nix/store/p1" }));
    await flush();
    expect(h.landed).toEqual([]);
    h.dispose();
  });
});
