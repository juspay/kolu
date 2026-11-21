// @vitest-environment happy-dom
/**
 * ONE WORK IS PICKED, OR NONE: a press picks it and points the chat at it, a
 * second press or All work unpicks it and the chat is whole again, showing
 * the whole chat by hand leaves the pick alone, and a link to a work picks
 * it on the works' side of a phone.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({ conductor: 0, readerClosed: 0 }));
vi.mock("./useConductorMode", () => ({
  enterConductorMode: () => {
    world.conductor += 1;
  },
}));
vi.mock("./reader/useReader", () => ({
  closeReader: () => {
    world.readerClosed += 1;
  },
}));
vi.mock("./useWorks", () => ({
  // Both works are in the list, so the chat's scope resolves to them.
  useWorkMap: () => () =>
    new Map([
      ["branch:local/%2Fr/a", { title: "a" }],
      ["branch:local/%2Fr/b", { title: "b" }],
    ]),
}));

import { chatScope, showAllChat } from "./chatScope";
import { phoneView, setPhoneView } from "./phoneView";
import {
  isPicked,
  parsePicked,
  pickedWork,
  pickWork,
  showWork,
  stageAskedFor,
  togglePick,
  unpickWork,
  wantedCard,
} from "./workListing";

const A = "branch:local/%2Fr/a";
const B = "branch:local/%2Fr/b";

beforeEach(() => {
  unpickWork();
  setPhoneView("chat");
  world.conductor = 0;
  world.readerClosed = 0;
});

describe("the picked work", () => {
  it("is one work, and a pick of another replaces it", () => {
    pickWork(A);
    expect(pickedWork()).toBe(A);
    expect(isPicked(A)).toBe(true);
    pickWork(B);
    expect(isPicked(A)).toBe(false);
    expect(isPicked(B)).toBe(true);
  });

  it("is let go by a second press on it, and kept by a press on another", () => {
    togglePick(A);
    expect(pickedWork()).toBe(A);
    togglePick(B);
    expect(pickedWork()).toBe(B);
    togglePick(B);
    expect(pickedWork()).toBeNull();
  });

  it("points the chat at it, and All work makes the chat whole again", () => {
    pickWork(A);
    expect(chatScope()?.id).toBe(A);
    unpickWork();
    expect(chatScope()).toBeNull();
  });

  it("stays picked when the whole chat is shown by hand", () => {
    pickWork(A);
    showAllChat();
    expect(pickedWork()).toBe(A);
  });

  it("carries the stage a press on its strip asked for", () => {
    pickWork(A, "build");
    expect(stageAskedFor()).toBe("build");
    pickWork(B);
    expect(stageAskedFor()).toBeUndefined();
  });
});

describe("a link to a work", () => {
  it("opens the Conductor, picks the work and asks for it to be shown", () => {
    showWork(A, "ask-1");
    expect(world.conductor).toBe(1);
    expect(world.readerClosed).toBeGreaterThan(0);
    expect(pickedWork()).toBe(A);
    expect(wantedCard()).toMatchObject({ id: A, ask: "ask-1" });
  });

  it("shows a phone its works", () => {
    showWork(B);
    expect(phoneView()).toBe("work");
  });
});

describe("the pick across a reload", () => {
  it("is kept for this tab and read back by a fresh load", async () => {
    pickWork(A);
    expect(sessionStorage.getItem("kolu-conductor-picked-work")).toBe(
      JSON.stringify(A),
    );
    vi.resetModules();
    const reloaded = await import("./workListing");
    expect(reloaded.pickedWork()).toBe(A);
  });

  it("is all the works again once nothing is picked", async () => {
    pickWork(A);
    unpickWork();
    vi.resetModules();
    const reloaded = await import("./workListing");
    expect(reloaded.pickedWork()).toBeNull();
  });

  it("refuses a stored value that names no work", () => {
    expect(parsePicked("null")).toBeNull();
    expect(parsePicked(JSON.stringify(A))).toBe(A);
    expect(() => parsePicked('""')).toThrow();
    expect(() => parsePicked("7")).toThrow();
  });
});
