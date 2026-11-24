/**
 * "Which of kolu's hosts is this browser sitting at?" — and what happens when
 * the server cannot say.
 *
 * The answer is read during RENDER: `PortsSection` calls it twice per port row
 * inside a `<For>` child. That placement is what makes the failure mode sharp.
 * An async memo THROWS its compute's rejection at whoever reads it, and a read
 * with no answer yet SUSPENDS to the nearest `Loading` boundary — and a throw
 * during render aborts the whole update. The client has no `Errored` boundary
 * anywhere and no `Loading` one over the Inspector, so either would take the
 * section out rather than degrade.
 *
 * `null` already has an honest meaning here — "kolu cannot tell", which keeps
 * the forward on offer, and the forward always works. So both windows LAND on
 * `null`: the failed read is caught in the compute, and the pre-answer window
 * is the memo's declared `loadingValue`.
 */

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const viewer = vi.fn();

/** The root face is EFFECT-native now, so a stub answers with a DESCRIPTION.
 *  `Effect.suspend` keeps the mock's own laziness — the value is read when the
 *  effect runs, not when the ref is built. */
const answers = (value: unknown): void => {
  viewer.mockImplementation(() => Effect.succeed(value));
};
const refuses = (error: Error): void => {
  viewer.mockImplementation(() => Effect.fail(error));
};
/** A stub that answers only when the test says so — what the window before the
 *  first answer is observed through. */
const answersWhenReleased = (value: unknown): (() => void) => {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  viewer.mockImplementation(() => Effect.promise(() => promise));
  return () => resolve(value);
};
/** The forwards cell's current value, swappable per test. */
const cell: { value: () => unknown[] } = { value: () => [] };

vi.mock("../wire", () => ({
  hostKeys: () => [
    { kind: "local" },
    { kind: "remote", target: "zest" },
    { kind: "remote", target: "pu-dev" },
  ],
  client: { hosts: { viewer } },
  app: { cells: { forwards: { use: () => ({ value: () => cell.value() }) } } },
}));

/** Drop the loaded module and the stubs' answers, so the next import is a
 *  fresh page. */
function forget(): void {
  vi.resetModules();
  viewer.mockReset();
  cell.value = () => [];
}
afterEach(forget);

/** Import fresh each time — the query is a module-level one-shot, so its
 *  resolution is baked at first import. */
async function loadViewerHost() {
  const mod = await import("./useForwards");
  // Let the one-shot settle before reading, the way a first paint would.
  await new Promise((r) => setTimeout(r, 0));
  return mod.viewerHost;
}

// Load once at collection, before any test's clock starts: a worker's first
// import costs one round trip to vitest's main process per module, and while
// the suite is starting those add up to seconds. Each case then re-evaluates.
answers({ host: null });
await loadViewerHost();
forget();

describe("viewerHost", () => {
  it("reads the host the server names", async () => {
    answers({ host: { kind: "remote", target: "zest" } });
    const viewerHost = await loadViewerHost();
    expect(viewerHost()).toEqual({ kind: "remote", target: "zest" });
  });

  it("is `null`, not a throw, when the server cannot tell", async () => {
    answers({ host: null });
    const viewerHost = await loadViewerHost();
    expect(viewerHost()).toBeNull();
  });

  it("is `null`, not a throw, when the read FAILS", async () => {
    // The load-bearing case. A render-time throw here has no boundary to catch
    // it, so the Ports section — and whatever else is in that update — would go
    // down over a transient RPC failure. `null` degrades to "keep offering the
    // forward", which is the behaviour that always works.
    refuses(new Error("websocket closed"));
    const viewerHost = await loadViewerHost();
    expect(() => viewerHost()).not.toThrow();
    expect(viewerHost()).toBeNull();
  });

  it("is `null` BEFORE the first answer lands — the declared loading value, not a suspended read", async () => {
    // The other half of the load-bearing case: the Inspector reads this
    // mid-render with no `Loading` boundary over it, so the pre-answer window
    // must be a value, not a suspension. It means what a `null` always means
    // here — kolu cannot tell, so keep offering the forward.
    const release = answersWhenReleased({
      host: { kind: "remote", target: "zest" },
    });
    const { viewerHost } = await import("./useForwards");
    expect(() => viewerHost()).not.toThrow();
    expect(viewerHost()).toBeNull();

    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(viewerHost()).toEqual({ kind: "remote", target: "zest" });
  });
});

describe("forwardsForHost", () => {
  const door = (key: string, host: { kind: string; target?: string }) => ({
    key,
    host,
    remotePort: 5173,
    localPort: 5173,
    origin: "auto",
    createdAt: 0,
  });

  it("keeps only the doors on the host asked for", async () => {
    // Host scoping lives HERE, and only here. `portRows` used to re-filter what
    // this had already filtered — two layers owning one question, which means
    // one of them is dead code. The dead one was carrying this case, so it moved
    // to the live layer rather than being deleted along with it.
    //
    // It matters because every surface showing a forward is host-scoped: a door
    // to zest appearing under a terminal on the local host is a link that opens
    // the wrong machine's page.
    cell.value = () => [
      door("remote:zest:5173", { kind: "remote", target: "zest" }),
      door("local:5173", { kind: "local" }),
      door("remote:pu-dev:3000", { kind: "remote", target: "pu-dev" }),
    ];
    const { forwardsForHost } = await import("./useForwards");

    expect(
      forwardsForHost({ kind: "remote", target: "zest" }).map((f) => f.key),
    ).toEqual(["remote:zest:5173"]);
    expect(forwardsForHost({ kind: "local" }).map((f) => f.key)).toEqual([
      "local:5173",
    ]);
  });
});
