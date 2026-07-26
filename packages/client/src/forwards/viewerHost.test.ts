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

import { afterEach, describe, expect, it, vi } from "vitest";

const viewer = vi.fn();

vi.mock("../wire", () => ({
  client: { hosts: { viewer } },
  app: { cells: { forwards: { use: () => ({ value: () => [] }) } } },
}));

afterEach(() => {
  vi.resetModules();
  viewer.mockReset();
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
    viewer.mockResolvedValue({ host: { kind: "remote", target: "zest" } });
    const viewerHost = await loadViewerHost();
    expect(viewerHost()).toEqual({ kind: "remote", target: "zest" });
  });

  it("is `null`, not a throw, when the server cannot tell", async () => {
    viewer.mockResolvedValue({ host: null });
    const viewerHost = await loadViewerHost();
    expect(viewerHost()).toBeNull();
  });

  it("is `null`, not a throw, when the read FAILS", async () => {
    // The load-bearing case. A render-time throw here has no boundary to catch
    // it, so the Ports section — and whatever else is in that update — would go
    // down over a transient RPC failure. `null` degrades to "keep offering the
    // forward", which is the behaviour that always works.
    viewer.mockRejectedValue(new Error("websocket closed"));
    const viewerHost = await loadViewerHost();
    expect(() => viewerHost()).not.toThrow();
    expect(viewerHost()).toBeNull();
  });
});
