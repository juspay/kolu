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
