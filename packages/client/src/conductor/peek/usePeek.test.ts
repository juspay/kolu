import type { TerminalId } from "kolu-common/surface";
import type { WorkMember } from "kolu-work";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import {
  closePeek,
  keyRaisesLockOffer,
  openPeek,
  peekFootWords,
  peekTabs,
  peekTarget,
  peekTyping,
  setPeekTyping,
} from "./usePeek";

const ONE = "11111111-1111-4111-8111-111111111111" as TerminalId;
const TWO = "22222222-2222-4222-8222-222222222222" as TerminalId;
const ONE_REF = `local/${ONE}`;
const TWO_REF = `local/${TWO}`;

const planner: WorkMember = {
  work: "w1",
  role: "planner",
  joinedAt: "2026-01-01T00:00:00.000Z",
  worktree: { kind: "unread" } as WorkMember["worktree"],
};
const implementor: WorkMember = {
  work: "w1",
  role: "implementor",
  joinedAt: "2026-01-01T00:00:00.000Z",
  worktree: { kind: "unread" } as WorkMember["worktree"],
};

afterEach(() => {
  closePeek();
});

describe("the peek's target", () => {
  it("opens on what it is given and closes to nothing", () => {
    const at = { host: "local", id: ONE };
    openPeek(at);
    flush();
    expect(peekTarget()).toEqual(at);
    closePeek();
    flush();
    expect(peekTarget()).toBeNull();
  });

  it("moves to the last terminal it is opened on", () => {
    openPeek({ host: "local", id: ONE });
    openPeek({ host: "remote:nix@example", id: TWO });
    flush();
    expect(peekTarget()).toEqual({ host: "remote:nix@example", id: TWO });
  });
});

describe("the peek's typing lock", () => {
  it("drops the typing lock on close", () => {
    setPeekTyping(true);
    flush();
    closePeek();
    flush();
    expect(peekTyping()).toBe(false);
  });
});

describe("peekTabs", () => {
  it("draws no tabs for a terminal in no work", () => {
    expect(peekTabs(new Map(), ONE_REF, () => true)).toEqual([]);
  });

  it("draws the work's members in the order the work runs them", () => {
    const members = new Map<string, WorkMember>([
      [TWO_REF, implementor],
      [ONE_REF, planner],
    ]);
    expect(peekTabs(members, ONE_REF, () => true)).toEqual([
      { ref: ONE_REF, host: "local", id: ONE, role: "planner", openable: true },
      {
        ref: TWO_REF,
        host: "local",
        id: TWO,
        role: "implementor",
        openable: true,
      },
    ]);
  });

  it("marks a member with no screen as not openable", () => {
    const members = new Map<string, WorkMember>([
      [ONE_REF, planner],
      [TWO_REF, implementor],
    ]);
    const tabs = peekTabs(members, ONE_REF, (_host, id) => id === ONE);
    expect(tabs.map((tab) => tab.openable)).toEqual([true, false]);
  });
});

describe("keyRaisesLockOffer", () => {
  it("raises the card only for a key that would have reached a locked terminal", () => {
    const base = {
      key: "a",
      modified: false,
      onButton: false,
      terminalFocused: false,
      mayType: false,
    };
    expect(keyRaisesLockOffer(base)).toBe(true);
    expect(keyRaisesLockOffer({ ...base, key: "Enter" })).toBe(true);
    expect(keyRaisesLockOffer({ ...base, terminalFocused: true })).toBe(false);
    expect(keyRaisesLockOffer({ ...base, mayType: true })).toBe(false);
    expect(keyRaisesLockOffer({ ...base, modified: true })).toBe(false);
    expect(keyRaisesLockOffer({ ...base, onButton: true, key: "Enter" })).toBe(
      false,
    );
    expect(keyRaisesLockOffer({ ...base, onButton: true, key: " " })).toBe(
      false,
    );
    expect(keyRaisesLockOffer({ ...base, onButton: true })).toBe(true);
    expect(keyRaisesLockOffer({ ...base, key: "ArrowUp" })).toBe(false);
  });
});

describe("peekFootWords", () => {
  it("says who drives the terminal and what Esc does", () => {
    expect(
      peekFootWords({
        driver: "conductor",
        typing: false,
        name: "planner",
        touch: false,
      }),
    ).toBe(
      "Read-only while the Conductor drives it. Scroll to read back, drag to select. Esc closes.",
    );
    expect(
      peekFootWords({
        driver: "you",
        typing: true,
        name: "planner",
        touch: false,
      }),
    ).toBe(
      "You’re driving: keys go to planner, Esc included. Close with × or a click outside.",
    );
    expect(
      peekFootWords({
        driver: "nobody",
        typing: false,
        name: "planner",
        touch: true,
      }),
    ).toBe("Nobody is driving this terminal. Tap the terminal to type in it.");
  });
});
