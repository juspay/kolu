/** A profile's lock, for the references that need no Nix — a path is used as
 *  it is, a relative one is refused — and Nix's words on one line. (Fetching a
 *  flake reference and building one run Nix, and are the delivery's e2e.) */

import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lockProfile, nixWords } from "./profiles.ts";

describe("lockProfile — paths", () => {
  it("an absolute path is its own tree, with no revision", async () => {
    await expect(lockProfile("/home/me/profile")).resolves.toEqual({
      reference: "/home/me/profile",
      tree: "/home/me/profile",
    });
  });

  it("a ~/ path is under this machine's home", async () => {
    await expect(lockProfile("~/profiles/mine")).resolves.toEqual({
      reference: "~/profiles/mine",
      tree: join(homedir(), "profiles/mine"),
    });
  });

  it("a relative path names nothing here, and says what to use instead", async () => {
    for (const reference of ["./mine", "../mine"])
      await expect(lockProfile(reference)).rejects.toThrow(
        `${reference}: a relative path names no profile here — use an absolute path, or one under ~/`,
      );
  });
});

describe("nixWords", () => {
  it("is Nix's error and what follows, on one line", () => {
    expect(
      nixWords(
        "fetching github:me/p\nerror:\n       … while fetching\n       cannot find flake",
        "exit 1",
      ),
    ).toBe("error: … while fetching cannot find flake");
  });

  it("is the last line when Nix said no error:", () => {
    expect(nixWords("one\ntwo\nthree\n", "exit 1")).toBe("three");
  });

  it("is the fallback when Nix said nothing", () => {
    expect(nixWords("  \n", "exit 1")).toBe("exit 1");
  });
});
