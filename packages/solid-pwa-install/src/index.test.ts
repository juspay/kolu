import { describe, expect, it } from "vitest";
import {
  detectInstallPlatform,
  type InstallPlatform,
  installInstructions,
} from "./index";

// Real-world user-agent strings, kept verbatim so a regex tweak that breaks a
// shipping browser fails loudly here.
const UA = {
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  edgeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  braveDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  edgeAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 EdgA/124.0.0.0",
  firefoxAndroid:
    "Mozilla/5.0 (Android 13; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0",
  firefoxDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  // iPadOS "Request Desktop Website" — reports a macOS Safari UA, NO iPad token.
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
} as const;

describe("detectInstallPlatform", () => {
  it("Chrome desktop → chromium-desktop", () => {
    expect(
      detectInstallPlatform({ ua: UA.chromeDesktop, maxTouchPoints: 0 }),
    ).toBe("chromium-desktop");
  });

  it("Edge desktop → chromium-desktop", () => {
    expect(
      detectInstallPlatform({ ua: UA.edgeDesktop, maxTouchPoints: 0 }),
    ).toBe("chromium-desktop");
  });

  it("Brave desktop (macOS, no touch) → chromium-desktop", () => {
    expect(
      detectInstallPlatform({ ua: UA.braveDesktop, maxTouchPoints: 0 }),
    ).toBe("chromium-desktop");
  });

  it("Chrome Android → chromium-android", () => {
    expect(
      detectInstallPlatform({ ua: UA.chromeAndroid, maxTouchPoints: 5 }),
    ).toBe("chromium-android");
  });

  it("Edge Android → chromium-android", () => {
    expect(
      detectInstallPlatform({ ua: UA.edgeAndroid, maxTouchPoints: 5 }),
    ).toBe("chromium-android");
  });

  it("Firefox Android → android-firefox", () => {
    expect(
      detectInstallPlatform({ ua: UA.firefoxAndroid, maxTouchPoints: 5 }),
    ).toBe("android-firefox");
  });

  it("Firefox desktop → firefox-desktop", () => {
    expect(
      detectInstallPlatform({ ua: UA.firefoxDesktop, maxTouchPoints: 0 }),
    ).toBe("firefox-desktop");
  });

  it("iPhone Safari → ios", () => {
    expect(
      detectInstallPlatform({ ua: UA.iphoneSafari, maxTouchPoints: 5 }),
    ).toBe("ios");
  });

  it("iPad Safari (touch) → ios", () => {
    expect(
      detectInstallPlatform({ ua: UA.ipadSafari, maxTouchPoints: 5 }),
    ).toBe("ios");
  });

  it("iPadOS desktop-mode (Mac UA + maxTouchPoints=5) → ios", () => {
    expect(
      detectInstallPlatform({ ua: UA.ipadDesktopMode, maxTouchPoints: 5 }),
    ).toBe("ios");
  });

  it("macOS Safari desktop (no touch) → safari-desktop", () => {
    expect(
      detectInstallPlatform({
        ua: UA.macSafari,
        maxTouchPoints: 0,
        vendor: "Apple Computer, Inc.",
      }),
    ).toBe("safari-desktop");
  });

  it("the same Mac UA is iOS with a touch screen but Safari without one", () => {
    // The whole point of the maxTouchPoints tell: identical UA, opposite verdict.
    expect(detectInstallPlatform({ ua: UA.macSafari, maxTouchPoints: 5 })).toBe(
      "ios",
    );
    expect(detectInstallPlatform({ ua: UA.macSafari, maxTouchPoints: 0 })).toBe(
      "safari-desktop",
    );
  });

  it("unknown UA → other", () => {
    expect(
      detectInstallPlatform({ ua: "SomeWeirdBot/1.0", maxTouchPoints: 0 }),
    ).toBe("other");
  });

  it("empty UA → other", () => {
    expect(detectInstallPlatform({ ua: "", maxTouchPoints: 0 })).toBe("other");
  });
});

describe("installInstructions", () => {
  const nativeOnly: InstallPlatform[] = [
    "chromium-desktop",
    "chromium-android",
  ];
  const manual: InstallPlatform[] = [
    "android-firefox",
    "ios",
    "safari-desktop",
    "firefox-desktop",
    "other",
  ];

  for (const p of nativeOnly) {
    it(`${p} → canPromptNatively=true`, () => {
      expect(installInstructions(p).canPromptNatively).toBe(true);
    });
  }

  for (const p of manual) {
    it(`${p} → canPromptNatively=false`, () => {
      expect(installInstructions(p).canPromptNatively).toBe(false);
    });
  }

  it("every platform yields a non-empty title and at least one step", () => {
    const all: InstallPlatform[] = [...nativeOnly, ...manual];
    for (const p of all) {
      const info = installInstructions(p);
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.steps.length).toBeGreaterThan(0);
      for (const step of info.steps) expect(step.length).toBeGreaterThan(0);
    }
  });

  it("ios steps mention the Share sheet flow", () => {
    const info = installInstructions("ios");
    expect(info.title).toBe("Add to Home Screen");
    expect(info.steps.join(" ")).toContain("Add to Home Screen");
  });

  it("safari-desktop steps mention the Dock", () => {
    expect(installInstructions("safari-desktop").title).toContain("Dock");
  });
});
