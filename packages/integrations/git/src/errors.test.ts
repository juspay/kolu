import { describe, expect, it } from "vitest";
import { isFileGoneError } from "./errors.ts";

/** `isFileGoneError` is the ONE authority for "is this failure a missing path?".
 *  Every kolu-git read that can lose its file underneath it (`readFile`,
 *  `filePreviewTag`, `listDirectory`) calls it to mint a `FILE_GONE` result,
 *  which `unwrapGit` then maps to a typed `NOT_FOUND` that consumers
 *  deliberately SWALLOW as an expected deletion — so a false positive here
 *  hides a real fault rather than merely mislabelling it. */
describe("isFileGoneError", () => {
  it("classifies a native ENOENT from its code", () => {
    expect(
      isFileGoneError(Object.assign(new Error("boom"), { code: "ENOENT" })),
    ).toBe(true);
  });

  it("does NOT classify an error that carries a different code", () => {
    // The regression this pins: reading the code and the message as
    // ALTERNATIVES let an error with its own, different code still be
    // classified by its text. A native errno is authoritative and is consulted
    // alone; the message is a fallback for a boundary that STRIPPED the code,
    // not a second opinion about an error that still has one.
    expect(
      isFileGoneError(Object.assign(new Error("boom"), { code: "EACCES" })),
    ).toBe(false);
  });

  it("does NOT mistake a PATH containing the token for the status", () => {
    // The concrete input: a permission failure on a directory whose own name
    // contains `ENOENT`. Answering true here turns a real EACCES into a
    // NOT_FOUND the Code tab swallows silently.
    const err = Object.assign(
      new Error("EACCES: permission denied, scandir '/repo/ENOENT-artifacts'"),
      { code: "EACCES" },
    );
    expect(isFileGoneError(err)).toBe(false);
  });

  it("still recognizes an ENOENT whose code was stripped crossing a boundary", () => {
    // The fallback's whole reason to exist — an error re-wrapped by a transport
    // that kept only the message. Matched on the errno SHAPE (`ENOENT:`), which
    // is how node spells it.
    expect(
      isFileGoneError(
        new Error("ENOENT: no such file or directory, scandir '/repo/out'"),
      ),
    ).toBe(true);
  });

  it("does not match a bare mention of the token with no code and no errno shape", () => {
    // Without a code AND without the errno shape there is no evidence of a
    // missing path — only a word inside a path.
    expect(
      isFileGoneError(new Error("failed to read /repo/ENOENT-notes.txt")),
    ).toBe(false);
  });
});
