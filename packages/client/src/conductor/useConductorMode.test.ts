// @vitest-environment happy-dom
/**
 * Where a browser tab lands when nothing is stored yet — and that a stored
 * choice wins over it, so a reload stays where the person was.
 *
 * The selection is read once, when the module loads, so each case loads a
 * fresh copy of it against the layout and the storage it is about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutMode } from "../useMobile";

const layout = vi.hoisted(() => ({ mode: "desktop" as LayoutMode }));
vi.mock("../useMobile", () => ({ layoutMode: () => layout.mode }));

const KEY = "kolu-active-chrome-tab";

async function loadFresh() {
  vi.resetModules();
  return import("./useConductorMode");
}

// Load once at collection, before any test's clock starts: a worker's first
// import costs one round trip to vitest's main process per module, and while
// the suite is starting those add up to seconds. Each case then re-evaluates.
await loadFresh();

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

describe("freshChromeTab", () => {
  it("opens a phone on the Conductor, and a tablet or a desktop on a host", async () => {
    const { freshChromeTab } = await loadFresh();
    expect(freshChromeTab("phone")).toBe("conductor");
    expect(freshChromeTab("compact")).toBe("hosts");
    expect(freshChromeTab("desktop")).toBe("hosts");
  });
});

describe("a fresh open", () => {
  it("lands a phone with nothing stored in the Conductor", async () => {
    layout.mode = "phone";
    const mode = await loadFresh();
    expect(mode.conductorMode()).toBe(true);
    // The pane must exist to be shown: the latch follows the first read.
    expect(mode.conductorEverSelected()).toBe(true);
  });

  it("keeps a phone that stored a host tab on its host", async () => {
    layout.mode = "phone";
    sessionStorage.setItem(KEY, "hosts");
    const mode = await loadFresh();
    expect(mode.conductorMode()).toBe(false);
  });

  it("lands a tablet with nothing stored on its host", async () => {
    layout.mode = "compact";
    const mode = await loadFresh();
    expect(mode.conductorMode()).toBe(false);
  });
});
