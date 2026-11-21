// @vitest-environment happy-dom
/**
 * WHETHER A LIVE PANE FITS ITS TERMINAL TO THE VIEW — one choice for every
 * pane, live and Look.
 *
 * It starts on and is kept in `localStorage`, like the font size: it is a
 * taste about a screen, not a fact about one browser tab, so closing the tab
 * or the installed app's window does not forget it. Read once when the module
 * loads — the way a reload reads it.
 */

import { describe, expect, it, vi } from "vitest";

const KEY = "kolu-conductor-fit-width";

async function loadFresh() {
  vi.resetModules();
  return import("./fitWidth");
}

// Load once at collection, before any test's clock starts: a worker's first
// import costs one round trip to vitest's main process per module, and while
// the suite is starting those add up to seconds. Each case then re-evaluates.
await loadFresh();

describe("the Conductor's Fit width choice", () => {
  it("starts on", async () => {
    localStorage.clear();
    const { fitWidth } = await loadFresh();
    expect(fitWidth()).toBe(true);
  });

  it("keeps a change across a reload", async () => {
    localStorage.clear();
    const first = await loadFresh();
    first.setFitWidth(false);
    expect(localStorage.getItem(KEY)).toBe("false");

    const reloaded = await loadFresh();
    expect(reloaded.fitWidth()).toBe(false);
    localStorage.clear();
  });

  it("falls back to on when the stored value is not a choice", async () => {
    localStorage.setItem(KEY, "maybe");
    const { fitWidth } = await loadFresh();
    expect(fitWidth()).toBe(true);
    localStorage.clear();
  });
});
