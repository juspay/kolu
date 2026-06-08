/**
 * The pure install-state kernel — `isInstalledFromEnv` / `canInstallFromEnv`.
 * These decide whether any PWA-install affordance may show. Pure (env passed in),
 * so no DOM / Solid is involved.
 */

import { describe, expect, it } from "vitest";
import {
  canInstallFromEnv,
  type InstallEnv,
  isInstalledFromEnv,
} from "./index";

const env = (over: Partial<InstallEnv> = {}): InstallEnv => ({
  isSecureContext: false,
  displayModeStandalone: false,
  navigatorStandalone: false,
  ...over,
});

describe("isInstalledFromEnv", () => {
  it("is true when launched standalone (display-mode)", () => {
    expect(isInstalledFromEnv(env({ displayModeStandalone: true }))).toBe(true);
  });
  it("is true on iOS via navigator.standalone", () => {
    expect(isInstalledFromEnv(env({ navigatorStandalone: true }))).toBe(true);
  });
  it("is false in a normal browser tab", () => {
    expect(isInstalledFromEnv(env({ isSecureContext: true }))).toBe(false);
  });
});

describe("canInstallFromEnv", () => {
  it("requires a secure context — false over plain http on a LAN/Tailscale IP", () => {
    expect(canInstallFromEnv(env({ isSecureContext: false }))).toBe(false);
  });
  it("is true on a secure origin that is not yet installed", () => {
    expect(canInstallFromEnv(env({ isSecureContext: true }))).toBe(true);
  });
  it("is false once installed, even on a secure origin", () => {
    expect(
      canInstallFromEnv(
        env({ isSecureContext: true, displayModeStandalone: true }),
      ),
    ).toBe(false);
  });
});
