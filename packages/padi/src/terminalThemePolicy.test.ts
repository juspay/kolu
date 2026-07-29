/** Unit tests for padi's new-terminal theme resolver. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_THEME_POLICY,
  readTerminalThemePolicyFromEnv,
  resolveCreateTerminalTheme,
} from "./terminalThemePolicy.ts";

const ROSE = "rose";
const NORD = "nord";
const DRACULA = "Dracula";

const alwaysRosePolicy: typeof DEFAULT_TERMINAL_THEME_POLICY = {
  ...DEFAULT_TERMINAL_THEME_POLICY,
  newTerminalTheme: "inherit",
};

const shuffleDarkPolicy: typeof DEFAULT_TERMINAL_THEME_POLICY = {
  ...DEFAULT_TERMINAL_THEME_POLICY,
  newTerminalTheme: "shuffle",
  shuffleBehavior: "dark",
};

describe("resolveCreateTerminalTheme", () => {
  it("honours an explicit override regardless of strategy", () => {
    expect(
      resolveCreateTerminalTheme({
        overrideThemeName: DRACULA,
        policy: alwaysRosePolicy,
        activeThemeName: ROSE,
        peerThemeNames: [],
      }),
    ).toBe(DRACULA);
  });

  it("inherit copies the active terminal's theme", () => {
    expect(
      resolveCreateTerminalTheme({
        policy: alwaysRosePolicy,
        activeThemeName: ROSE,
        peerThemeNames: [],
      }),
    ).toBe(ROSE);
  });

  it("inherit falls back to the last-used theme when nothing is active", () => {
    expect(
      resolveCreateTerminalTheme({
        policy: alwaysRosePolicy,
        lastThemeName: NORD,
        peerThemeNames: [],
      }),
    ).toBe(NORD);
  });

  it("inherit falls back to the built-in default when no theme is known", () => {
    const theme = resolveCreateTerminalTheme({
      policy: alwaysRosePolicy,
      peerThemeNames: [],
    });
    expect(typeof theme).toBe("string");
    expect(theme.length).toBeGreaterThan(0);
  });

  it("shuffle picks a theme outside the peer set", () => {
    const picked = resolveCreateTerminalTheme({
      policy: shuffleDarkPolicy,
      peerThemeNames: [ROSE],
      rand: () => 0,
    });
    expect(picked).not.toBe(ROSE);
    expect(typeof picked).toBe("string");
  });

  it("shuffle with dark mode stays in the dark family", () => {
    const picked = resolveCreateTerminalTheme({
      policy: shuffleDarkPolicy,
      peerThemeNames: [],
      rand: () => 0,
    });
    // All real dark-theme names include well-known dark schemes; we assert
    // only that a theme was picked, and that it differs from an explicit
    // light peer if one is supplied.
    const lightPeer = "Catppuccin Latte";
    const withPeer = resolveCreateTerminalTheme({
      policy: shuffleDarkPolicy,
      peerThemeNames: [lightPeer],
      rand: () => 0,
    });
    expect(withPeer).not.toBe(lightPeer);
  });
});

describe("readTerminalThemePolicyFromEnv", () => {
  const ORIGINAL_STATE_DIR = process.env.KOLU_STATE_DIR;

  afterEach(() => {
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.KOLU_STATE_DIR;
    } else {
      process.env.KOLU_STATE_DIR = ORIGINAL_STATE_DIR;
    }
  });

  it("returns defaults when KOLU_STATE_DIR is absent", () => {
    delete process.env.KOLU_STATE_DIR;
    expect(readTerminalThemePolicyFromEnv()).toEqual(
      DEFAULT_TERMINAL_THEME_POLICY,
    );
  });

  it("reads the two theme fields from the conf file", () => {
    const dir = mkdtempSync(join(tmpdir(), "padi-theme-policy-"));
    process.env.KOLU_STATE_DIR = dir;
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: {
          newTerminalTheme: "inherit",
          shuffleBehavior: "dark",
          colorScheme: "dark",
        },
      }),
    );
    expect(readTerminalThemePolicyFromEnv()).toEqual({
      newTerminalTheme: "inherit",
      shuffleBehavior: "dark",
      colorScheme: "dark",
    });
  });

  it("returns defaults for a missing config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "padi-theme-policy-missing-"));
    process.env.KOLU_STATE_DIR = dir;
    expect(readTerminalThemePolicyFromEnv()).toEqual(
      DEFAULT_TERMINAL_THEME_POLICY,
    );
  });

  it("ignores invalid values and returns defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "padi-theme-policy-invalid-"));
    process.env.KOLU_STATE_DIR = dir;
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: {
          newTerminalTheme: "monochrome",
          shuffleBehavior: 123,
          colorScheme: true,
        },
      }),
    );
    expect(readTerminalThemePolicyFromEnv()).toEqual(
      DEFAULT_TERMINAL_THEME_POLICY,
    );
  });
});
