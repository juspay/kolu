/**
 * One spelling of a directory, and the two questions that turn on it.
 *
 * Small, and worth writing down anyway: the rule is read by the thing that
 * matches a stored session's directory against ours and by the thing that names
 * this directory's memory after it, and the two must never come to answer
 * differently — which is the failure this package's whole `chat-restore-wrong`
 * fix is about, arrived at from underneath.
 */

import { describe, expect, test } from "vitest";

import { normalDirectory, sameDirectory } from "./directory.ts";

describe("one spelling of a directory", () => {
  test("a trailing slash is not part of the name", () => {
    expect(normalDirectory("/home/somebody/notes/")).toBe(
      "/home/somebody/notes",
    );
  });

  test("however many of them there are", () => {
    expect(normalDirectory("/home/somebody/notes///")).toBe(
      "/home/somebody/notes",
    );
  });

  test("and a path without one is left exactly as it is", () => {
    expect(normalDirectory("/home/somebody/notes")).toBe(
      "/home/somebody/notes",
    );
    expect(normalDirectory("")).toBe("");
  });

  test("a long run of slashes is answered at once", () => {
    // The reason this counts rather than matching: a backtracking regex on
    // this input is what CodeQL raised (`js/polynomial-redos`), and the string
    // arrives from an agent. A tenth of a second here would be a finding.
    const started = performance.now();
    expect(normalDirectory("/".repeat(200_000))).toBe("");
    expect(performance.now() - started).toBeLessThan(100);
  });

  test("two spellings of one directory are one directory", () => {
    expect(sameDirectory("/home/somebody/notes", "/home/somebody/notes/")).toBe(
      true,
    );
    expect(
      sameDirectory("/home/somebody/notes/", "/home/somebody/other/"),
    ).toBe(false);
  });
});
