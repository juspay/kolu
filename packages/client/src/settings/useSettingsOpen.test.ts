import { describe, expect, it } from "vitest";
import { chromeDrawerOpen, setChromeDrawerOpen } from "../useChromeDrawer";
import { openSettings, setSettingsOpen, settingsOpen } from "./useSettingsOpen";

describe("openSettings — desktop must not touch the mobile drawer state", () => {
  it("opens settings and leaves the chrome drawer closed on desktop", () => {
    setSettingsOpen(false);
    setChromeDrawerOpen(false);
    openSettings();
    expect(settingsOpen()).toBe(true);
    expect(chromeDrawerOpen()).toBe(false);
  });
});
