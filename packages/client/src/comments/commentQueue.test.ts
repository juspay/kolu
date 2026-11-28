/**
 * T22: A TERMINAL'S COMMENTS AND A WORK'S ARE TWO QUEUES. One id names both
 * kinds without their comments meeting, and a terminal's queue is still
 * stored under the name it always had — so nothing a person already wrote
 * moves or goes missing.
 */

import { setImmediate as settle } from "node:timers/promises";
import { flush } from "solid-js";
import { describe, expect, it } from "vitest";
import type { CommentQueue } from "./types";
import { commentStorageName, useComments } from "./useComments";

const note = (body: string) => ({
  path: ".waterfall/plan.md",
  locator: { quote: "the plan", prefix: "", suffix: "" },
  body,
});

describe("comment queues", () => {
  it("keeps a terminal's and a work's apart, whatever their ids", () => {
    const terminal: CommentQueue = { kind: "terminal", id: "same-id" };
    const work: CommentQueue = { kind: "work", id: "same-id" };
    useComments(terminal).add(note("on the terminal"));
    useComments(work).add(note("on the work"));
    // Solid 2 stages each write until the next flush.
    flush();
    expect(
      useComments(terminal)
        .comments()
        .map((c) => c.body),
    ).toEqual(["on the terminal"]);
    expect(
      useComments(work)
        .comments()
        .map((c) => c.body),
    ).toEqual(["on the work"]);
  });

  it("stores a terminal's queue under the name it always had", async () => {
    const terminal: CommentQueue = { kind: "terminal", id: "t-stored" };
    expect(commentStorageName(terminal)).toBe(
      "kolu:comments-by-terminal:t-stored",
    );
    expect(commentStorageName({ kind: "work", id: "w" })).toBe(
      "kolu:comments-by-work:w",
    );
    useComments(terminal).add(note("kept"));
    await settle();
    const stored = localStorage.getItem("kolu:comments-by-terminal:t-stored");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "{}").comments[0].body).toBe("kept");
  });
});
