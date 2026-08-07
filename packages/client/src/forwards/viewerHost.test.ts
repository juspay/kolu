/**
 * "Which of kolu's hosts is this browser sitting at?" — and what happens when
 * the server cannot say.
 *
 * The answer is read during RENDER: `PortsSection` calls it twice per port row
 * inside a `<For>` child. That placement is what makes the failure mode sharp.
 * A Solid resource accessor RE-THROWS its fetcher's error rather than returning
 * `undefined`, so `data() ?? null` yields `null` only while loading — never on
 * failure — and a throw during render aborts the whole update. The client has no
 * `ErrorBoundary` anywhere, so one transient RPC failure at page load would take
 * out the Inspector rather than degrade.
 *
 * `null` already has an honest meaning here — "kolu cannot tell", which keeps
 * the forward on offer, and the forward always works. A failed read is exactly
 * that case, so it must LAND on `null`, not escape as an exception.
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
/** The forwards cell's current value, swappable per test. */
const cell: { value: () => unknown[] } = { value: () => [] };

vi.mock("../wire", () => ({
  client: { hosts: { viewer } },
  app: { cells: { forwards: { use: () => ({ value: () => cell.value() }) } } },
}));

afterEach(() => {
  vi.resetModules();
  viewer.mockReset();
  cell.value = () => [];
});

/** Import fresh each time — the query is a module-level one-shot, so its
 *  resolution is baked at first import. */
async function loadViewerHost() {
  const mod = await import("./useForwards");
  // Let the one-shot settle before reading, the way a first paint would.
  await new Promise((r) => setTimeout(r, 0));
  return mod.viewerHost;
}

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
