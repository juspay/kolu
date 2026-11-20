import { describe, expect, it } from "vitest";
import { isFileGoneError } from "./errors.ts";

describe("isFileGoneError", () => {
  it("classifies a native ENOENT from its code", () => {
    expect(
      isFileGoneError(Object.assign(new Error("boom"), { code: "ENOENT" })),
    ).toBe(true);
  });

  it("does NOT classify an error that carries a different code", () => {
    expect(
      isFileGoneError(Object.assign(new Error("boom"), { code: "EACCES" })),
    ).toBe(false);
  });

  it("does NOT mistake a PATH containing the token for the status", () => {
    const err = Object.assign(
      new Error("EACCES: permission denied, scandir '/repo/ENOENT-artifacts'"),
      { code: "EACCES" },
    );
    expect(isFileGoneError(err)).toBe(false);
  });

  it("still recognizes an ENOENT whose code was stripped crossing a boundary", () => {
    expect(
      isFileGoneError(
        new Error("ENOENT: no such file or directory, scandir '/repo/out'"),
      ),
    ).toBe(true);
  });

  it("does not match a bare mention of the token with no code and no errno shape", () => {
    expect(
      isFileGoneError(new Error("failed to read /repo/ENOENT-notes.txt")),
    ).toBe(false);
  });
});
