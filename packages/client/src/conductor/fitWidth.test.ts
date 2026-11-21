// @vitest-environment happy-dom
/**
 * WHETHER A LIVE PANE FITS ITS TERMINAL TO THE VIEW — one choice, kept for
 * every pane.
 *
 * The toggle used to be a `createSignal` inside the pane, so it was born off
 * (a wide terminal panned sideways and the person had to press Fit width) and
 * forgotten the moment the pane was drawn again: switching Terminals /
 * Details, picking another work, or changing which terminal is in front put
 * it back to off. It now starts ON and is kept per browser tab, like the
 * picked work and the phone's view, so a reload keeps it too.
 */

import { describe, expect, it, vi } from "vitest";

const KEY = "kolu-conductor-fit-width";

/** Read once, when the module loads — the way a reload reads it. */
async function loadFresh() {
  vi.resetModules();
  return import("./fitWidth");
}

const clean = () => sessionStorage.clear();
clean();

describe("the Conductor's Fit width choice", () => {
  it("starts on", async () => {
    const { fitWidth } = await loadFresh();
    expect(fitWidth()).toBe(true);
  });

  it("keeps a change across a view switch", async () => {
    const { fitWidth, setFitWidth } = await loadFresh();
    setFitWidth(false);
    // A view switch tears down the pane's components and draws them again;
    // the module, and the choice with it, is not rebuilt.
    const again = await import("./fitWidth");
    expect(again.fitWidth()).toBe(false);
    setFitWidth(true);
    expect(fitWidth()).toBe(true);
  });

  it("keeps a change across a reload", async () => {
    const first = await loadFresh();
    first.setFitWidth(false);
    expect(sessionStorage.getItem(KEY)).toBe("false");

    const reloaded = await loadFresh();
    expect(reloaded.fitWidth()).toBe(false);
  });

  it("falls back to on when the stored value is not a choice", async () => {
    sessionStorage.setItem(KEY, "maybe");
    const { fitWidth } = await loadFresh();
    expect(fitWidth()).toBe(true);
    clean();
  });
});
