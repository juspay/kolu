import { describe, expect, it } from "vitest";
import { chromeDrawerOpen, setChromeDrawerOpen } from "../useChromeDrawer";
import { openSettings, setSettingsOpen, settingsOpen } from "./useSettingsOpen";

/** F10 regression (codex round 2): `openSettings` must not arm the mobile
 *  chrome-drawer state on desktop. The drawer is a touch-only surface; the
 *  layout is reactive, so writing its state on desktop would leave it latently
 *  open when a later resize mounts the touch chrome. Under happy-dom the
 *  coarse-pointer / below-sm media queries default false, so `layoutMode`
 *  resolves to "desktop" here. */
describe("openSettings — desktop must not touch the mobile drawer state", () => {
  it("opens settings and leaves the chrome drawer closed on desktop", () => {
    setSettingsOpen(false);
    setChromeDrawerOpen(false);
    openSettings();
    expect(settingsOpen()).toBe(true);
    expect(chromeDrawerOpen()).toBe(false);
  });
});
