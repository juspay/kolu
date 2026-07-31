/** Unit tests for padi's new-terminal theme resolver — the decision
 *  `createTerminal` runs for every caller (browser, MCP, TUI, script).
 *
 *  Two levels: the pure core with explicit inputs, and — at the bottom — the
 *  real door (`createTerminal`), which is where the policy is actually applied. */

import type {
  NewTerminalPolicy,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetNewTerminalPolicyForTest,
  setNewTerminalPolicy,
} from "./chromeReports.ts";
import { setDaemonProcessId } from "./koluRoot.ts";
import { resolveCreateTerminalThemeFrom } from "./newTerminalPolicy.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { createTerminal } from "./terminals.ts";
import { type AuthoredActiveTerminal, LOCAL_LOCATION } from "./vocab.ts";

setDaemonProcessId("new-terminal-policy-test");

const ROSE = "rose";
const NORD = "nord";
const DRACULA = "Dracula";
const LIGHT_THEME = "Catppuccin Latte";

const noPeers = () => [];
const noInherit = () => undefined;

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

describe("resolveCreateTerminalThemeFrom", () => {
  it("honours an explicit override regardless of strategy", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        overrideThemeName: DRACULA,
        policy: inheritPolicy,
        inheritThemeName: () => ROSE,
        peerThemeNames: noPeers,
      }),
    ).toBe(DRACULA);
  });

  it("honours an explicit override even when no policy has been reported", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        overrideThemeName: DRACULA,
        policy: null,
        inheritThemeName: noInherit,
        peerThemeNames: noPeers,
      }),
    ).toBe(DRACULA);
  });

  it("has NO opinion until a chrome has reported a policy", () => {
    // A padi nobody has opened a browser against has no user preference to
    // honour — it must not invent one, so the caller keeps its own default.
    expect(
      resolveCreateTerminalThemeFrom({
        policy: null,
        inheritThemeName: () => ROSE,
        peerThemeNames: () => [NORD],
      }),
    ).toBeUndefined();
  });

  it("reads NEITHER registry input on the branches that don't need them", () => {
    // Both inputs walk padi's registry; `policy === null` is the entire steady
    // state of a browser-less padi, so neither may be paid for eagerly.
    const inheritThemeName = vi.fn(() => ROSE);
    const peerThemeNames = vi.fn(() => [NORD]);
    resolveCreateTerminalThemeFrom({
      policy: null,
      inheritThemeName,
      peerThemeNames,
    });
    expect(inheritThemeName).not.toHaveBeenCalled();
    expect(peerThemeNames).not.toHaveBeenCalled();
    // `inherit` reads its own source and nothing else.
    resolveCreateTerminalThemeFrom({
      policy: inheritPolicy,
      inheritThemeName,
      peerThemeNames,
    });
    expect(inheritThemeName).toHaveBeenCalledOnce();
    expect(peerThemeNames).not.toHaveBeenCalled();
  });

  it("inherit copies the terminal the user was last in", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        policy: inheritPolicy,
        inheritThemeName: () => ROSE,
        peerThemeNames: noPeers,
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
        inheritThemeName: noInherit,
        peerThemeNames: () => [NORD],
      }),
    ).toBeUndefined();
  });

  it("shuffle picks a theme outside the peer set", () => {
    const picked = resolveCreateTerminalThemeFrom({
      policy: shuffleDarkPolicy,
      inheritThemeName: noInherit,
      peerThemeNames: () => [ROSE],
    });
    expect(picked).not.toBe(ROSE);
    expect(typeof picked).toBe("string");
  });

  it("shuffle restricted to dark avoids an explicitly light peer", () => {
    expect(
      resolveCreateTerminalThemeFrom({
        policy: shuffleDarkPolicy,
        inheritThemeName: noInherit,
        peerThemeNames: () => [LIGHT_THEME],
      }),
    ).not.toBe(LIGHT_THEME);
  });

  it("shuffle counts an UNTHEMED peer as the default theme", () => {
    const pick = (peers: (string | undefined)[]) =>
      resolveCreateTerminalThemeFrom({
        policy: { ...shuffleDarkPolicy, shuffleBehavior: "random" },
        inheritThemeName: noInherit,
        peerThemeNames: () => peers,
      });
    const rand = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(pick([undefined])).not.toBe(pick([]));
    } finally {
      rand.mockRestore();
    }
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
        inheritThemeName: noInherit,
        peerThemeNames: noPeers,
      });
    const rand = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(auto(true)).not.toBe(auto(false));
    } finally {
      rand.mockRestore();
    }
  });
});

// ── the real door: `createTerminal` applies the policy ────────────────────────
//
// The policy lives on the CONSTRUCTOR, not on the wire handler, so an
// in-process caller (worktree create, MCP, a script) gets it too. Splits are
// carved out: they never carried a theme before #2045, and `shuffle` is the
// default preference, so letting it through would start tinting every sub-tab.
describe("createTerminal — the new-terminal policy at the door", () => {
  const PARENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as TerminalId;

  const parentMeta: AuthoredActiveTerminal = {
    state: "active",
    location: LOCAL_LOCATION,
    lastActivityAt: 42,
    themeName: ROSE,
  };
  const parentSnapshot: TerminalSnapshot = {
    cwd: "/work/repo",
    git: null,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };

  function themeOf(parentId?: string, themeName?: string): string | undefined {
    const info = createTerminal(undefined, parentId, { themeName });
    return getTerminal(info.id as TerminalId)?.meta.themeName;
  }

  function seedParent(): void {
    registerTerminal(PARENT_ID, {
      info: { id: PARENT_ID, pid: 1 },
      meta: parentMeta,
      snapshot: parentSnapshot,
      handle: {} as ActiveTerminalProcess["handle"],
    });
  }

  beforeEach(() => {
    setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
    // The user's setting, as the app chrome reports it: shuffle (the DEFAULT).
    setNewTerminalPolicy({
      newTerminalTheme: "shuffle",
      shuffleBehavior: "dark",
      isDark: true,
    });
  });
  afterEach(async () => {
    // The kaval-less fresh spawn's async tail rejects on a later microtask (the
    // failed-spawn path); let it settle, then drain any entry the create left.
    await new Promise((r) => setTimeout(r, 0));
    for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
    __resetNewTerminalPolicyForTest();
    __resetPadiSurfaceCtxForTest();
  });

  it("a TOP-LEVEL create takes the reported policy's theme", () => {
    expect(typeof themeOf()).toBe("string");
  });

  it("a SPLIT create takes NO theme — the policy stops at the tile boundary", () => {
    seedParent();
    expect(themeOf(PARENT_ID)).toBeUndefined();
  });

  it("a SPLIT create still honours an explicit caller override", () => {
    seedParent();
    expect(themeOf(PARENT_ID, DRACULA)).toBe(DRACULA);
  });

  it("an UNREPORTED policy leaves the create on the server default", () => {
    __resetNewTerminalPolicyForTest();
    expect(themeOf()).toBeUndefined();
  });
});
