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
      (bundle) => landed.push(bundle),
    );
  });
  return { store, write, landed, dispose };
}

const ready = (bundle: string, delivering = false): AgentDistroStatus => ({
  kind: "ready",
  profile: "vanilla",
  bundle,
  delivering,
});

describe("watchLanding", () => {
  it("fires once when another bundle lands, though the value object never changes identity", async () => {
    const h = harness();
    h.write(ready("/nix/store/a"));
    await flush();
    const before = h.store.v;
    h.write(ready("/nix/store/a", true));
    await flush();
    h.write(ready("/nix/store/b"));
    await flush();
    // The premise: reconcile kept the same object across the landing.
    expect(h.store.v).toBe(before);
    expect(h.landed).toEqual(["/nix/store/b"]);
    h.dispose();
  });

  it("a first delivery or a switch to another profile is not an update", async () => {
    const h = harness();
    h.write({ kind: "downloading", profile: "vanilla" });
    await flush();
    h.write(ready("/nix/store/a"));
    await flush();
    h.write({
      kind: "ready",
      profile: "juspay",
      bundle: "/nix/store/c",
      delivering: false,
    });
    await flush();
    expect(h.landed).toEqual([]);
    h.dispose();
  });
});
