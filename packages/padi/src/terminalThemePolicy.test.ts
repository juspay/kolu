/** Unit tests for padi's new-terminal theme resolver and the chrome-reported
 *  policy cell it resolves against. */

import { beforeEach, describe, expect, it } from "vitest";
import {
  getNewTerminalThemePolicy,
  resetNewTerminalThemePolicyForTest,
  resolveCreateTerminalTheme,
  setNewTerminalThemePolicy,
  type TerminalThemePolicy,
} from "./terminalThemePolicy.ts";

const ROSE = "rose";
const NORD = "nord";
const DRACULA = "Dracula";
const LIGHT_THEME = "Catppuccin Latte";

const inheritPolicy: TerminalThemePolicy = {
  newTerminalTheme: "inherit",
  shuffleBehavior: "auto",
  isDark: true,
};

const shuffleDarkPolicy: TerminalThemePolicy = {
  newTerminalTheme: "shuffle",
  shuffleBehavior: "dark",
  isDark: true,
};

describe("resolveCreateTerminalTheme", () => {
  it("honours an explicit override regardless of strategy", () => {
    expect(
      resolveCreateTerminalTheme({
        overrideThemeName: DRACULA,
        policy: inheritPolicy,
        inheritCandidates: [ROSE],
        peerThemeNames: [],
      }),
    ).toBe(DRACULA);
  });

  it("honours an explicit override even when no policy has been reported", () => {
    expect(
      resolveCreateTerminalTheme({
        overrideThemeName: DRACULA,
        policy: null,
        inheritCandidates: [],
        peerThemeNames: [],
      }),
    ).toBe(DRACULA);
  });

  it("has NO opinion until a chrome has reported a policy", () => {
    // A padi nobody has opened a browser against has no user preference to
    // honour — it must not invent one, so the caller keeps its own default.
    expect(
      resolveCreateTerminalTheme({
        policy: null,
        inheritCandidates: [ROSE],
        peerThemeNames: [NORD],
      }),
    ).toBeUndefined();
  });

  it("inherit takes the first defined candidate (the live active terminal)", () => {
    expect(
      resolveCreateTerminalTheme({
        policy: inheritPolicy,
        inheritCandidates: [ROSE, NORD],
        peerThemeNames: [],
      }),
    ).toBe(ROSE);
  });

  it("inherit falls through to the saved session when nothing is active", () => {
    expect(
      resolveCreateTerminalTheme({
        policy: inheritPolicy,
        inheritCandidates: [undefined, NORD],
        peerThemeNames: [],
      }),
    ).toBe(NORD);
  });

  it("inherit has no opinion when there is nothing to inherit", () => {
    expect(
      resolveCreateTerminalTheme({
        policy: inheritPolicy,
        inheritCandidates: [undefined, undefined],
        peerThemeNames: [],
      }),
    ).toBeUndefined();
  });

  it("shuffle picks a theme outside the peer set", () => {
    const picked = resolveCreateTerminalTheme({
      policy: shuffleDarkPolicy,
      peerThemeNames: [ROSE],
      inheritCandidates: [],
      rand: () => 0,
    });
    expect(picked).not.toBe(ROSE);
    expect(typeof picked).toBe("string");
  });

  it("shuffle restricted to dark avoids an explicitly light peer", () => {
    expect(
      resolveCreateTerminalTheme({
        policy: shuffleDarkPolicy,
        peerThemeNames: [LIGHT_THEME],
        inheritCandidates: [],
        rand: () => 0,
      }),
    ).not.toBe(LIGHT_THEME);
  });

  it("shuffle counts an UNTHEMED peer as the default theme", () => {
    // An unthemed terminal renders as the default theme, so it must repel a
    // spread shuffle exactly like an explicitly-default-themed one. Dropping
    // `undefined` peers would let a new terminal land on a background already
    // on screen.
    const withUndefinedPeer = resolveCreateTerminalTheme({
      policy: { ...shuffleDarkPolicy, shuffleBehavior: "random" },
      peerThemeNames: [undefined],
      inheritCandidates: [],
      rand: () => 0,
    });
    const withNoPeers = resolveCreateTerminalTheme({
      policy: { ...shuffleDarkPolicy, shuffleBehavior: "random" },
      peerThemeNames: [],
      inheritCandidates: [],
      rand: () => 0,
    });
    expect(withUndefinedPeer).not.toBe(withNoPeers);
  });

  it("resolves the shuffle family from the REPORTED dark mode", () => {
    // `auto` is the default shuffle behaviour, and the resolved `isDark` is the
    // only thing that decides its family — the browser answers `"system"`, padi
    // never guesses (which used to smush every System user onto dark).
    const auto = (isDark: boolean) =>
      resolveCreateTerminalTheme({
        policy: {
          newTerminalTheme: "shuffle",
          shuffleBehavior: "auto",
          isDark,
        },
        peerThemeNames: [],
        inheritCandidates: [],
        rand: () => 0,
      });
    expect(auto(true)).not.toBe(auto(false));
  });
});

describe("the chrome-reported policy cell", () => {
  beforeEach(() => {
    resetNewTerminalThemePolicyForTest();
  });

  it("starts empty — a fresh padi has heard from no chrome", () => {
    expect(getNewTerminalThemePolicy()).toBeNull();
  });

  it("holds the last report", () => {
    setNewTerminalThemePolicy(inheritPolicy);
    expect(getNewTerminalThemePolicy()).toEqual(inheritPolicy);
    setNewTerminalThemePolicy(shuffleDarkPolicy);
    expect(getNewTerminalThemePolicy()).toEqual(shuffleDarkPolicy);
  });
});
