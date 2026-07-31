/** Unit tests for padi's new-terminal theme resolver — the decision
 *  `lifecycle.create` runs for every caller (browser, MCP, TUI, script).
 *
 *  The registry-reading front door (`resolveCreateTerminalTheme`) is pinned in
 *  `servePadi.test.ts`, which drives it through a real create; here the pure core
 *  is driven with explicit inputs. */

import type { NewTerminalPolicy } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { resolveCreateTerminalThemeFrom } from "./newTerminalPolicy.ts";

const ROSE = "rose";
const NORD = "nord";
const DRACULA = "Dracula";
const LIGHT_THEME = "Catppuccin Latte";

const inheritPolicy: NewTerminalPolicy = {
  newTerminalTheme: "inherit",
  shuffleBehavior: "auto",
  isDark: true,
};

const shuffleDarkPolicy: NewTerminalPolicy = {
  newTerminalTheme: "shuffle",
  shuffleBehavior: "dark",
  isDark: true,
};

describe("resolveCreateTerminalTheme", () => {
  it("honours an explicit override regardless of strategy", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        overrideThemeName: DRACULA,
        policy: inheritPolicy,
        inheritThemeName: ROSE,
        peerThemeNames: [],
      }),
    ).toBe(DRACULA);
  });

  it("honours an explicit override even when no policy has been reported", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        overrideThemeName: DRACULA,
        policy: null,
        peerThemeNames: [],
      }),
    ).toBe(DRACULA);
  });

  it("has NO opinion until a chrome has reported a policy", () => {
    // A padi nobody has opened a browser against has no user preference to
    // honour — it must not invent one, so the caller keeps its own default.
    expect(
      resolveCreateTerminalThemeFrom({
        policy: null,
        inheritThemeName: ROSE,
        peerThemeNames: [NORD],
      }),
    ).toBeUndefined();
  });

  it("inherit copies the terminal the user was last in", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        policy: inheritPolicy,
        inheritThemeName: ROSE,
        peerThemeNames: [],
      }),
    ).toBe(ROSE);
  });

  it("inherit STOPS at an unthemed source — it does not reach further back", () => {
    // "The terminal you were last in is on the default theme" is an ANSWER, not
    // a missing answer: the new terminal stays on the default too. padi holds
    // exactly ONE source for "last one you were in" (`activeTerminalId`, which
    // boot already converges FROM the saved session), so there is nothing to
    // fall through to — a second, saved-session candidate would resurrect a
    // colour the live active terminal deliberately does not have.
    expect(
      resolveCreateTerminalThemeFrom({
        policy: inheritPolicy,
        inheritThemeName: undefined,
        peerThemeNames: [NORD],
      }),
    ).toBeUndefined();
  });

  it("shuffle picks a theme outside the peer set", () => {
    const picked = resolveCreateTerminalThemeFrom({
      policy: shuffleDarkPolicy,
      peerThemeNames: [ROSE],
      rand: () => 0,
    });
    expect(picked).not.toBe(ROSE);
    expect(typeof picked).toBe("string");
  });

  it("shuffle restricted to dark avoids an explicitly light peer", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        policy: shuffleDarkPolicy,
        peerThemeNames: [LIGHT_THEME],
        rand: () => 0,
      }),
    ).not.toBe(LIGHT_THEME);
  });

  it("shuffle counts an UNTHEMED peer as the default theme", () => {
    // An unthemed terminal renders as the default theme, so it must repel a
    // spread shuffle exactly like an explicitly-default-themed one. Dropping
    // `undefined` peers would let a new terminal land on a background already
    // on screen.
    const withUndefinedPeer = resolveCreateTerminalThemeFrom({
      policy: { ...shuffleDarkPolicy, shuffleBehavior: "random" },
      peerThemeNames: [undefined],
      rand: () => 0,
    });
    const withNoPeers = resolveCreateTerminalThemeFrom({
      policy: { ...shuffleDarkPolicy, shuffleBehavior: "random" },
      peerThemeNames: [],
      rand: () => 0,
    });
    expect(withUndefinedPeer).not.toBe(withNoPeers);
  });

  it("resolves the shuffle family from the REPORTED dark mode", () => {
    // `auto` is the default shuffle behaviour, and the resolved `isDark` is the
    // only thing that decides its family — the browser answers `"system"`, padi
    // never guesses (which used to smush every System user onto dark).
    const auto = (isDark: boolean) =>
      resolveCreateTerminalThemeFrom({
        policy: {
          newTerminalTheme: "shuffle",
          shuffleBehavior: "auto",
          isDark,
        },
        peerThemeNames: [],
        rand: () => 0,
      });
    expect(auto(true)).not.toBe(auto(false));
  });
});
