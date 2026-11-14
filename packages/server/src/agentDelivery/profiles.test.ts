/** A profile's lock, for the references that need no Nix — a path is used as
 *  it is, a relative one or a bare word is refused — and how a failed Nix run
 *  reads: the cause on one line, Nix's output under it. (Fetching a flake
 *  reference and building one run Nix, and are the delivery's e2e.) */

import type { ExecFileException } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { failureWords } from "@kolu/agent-distro/failure";
import { describe, expect, it } from "vitest";
import { lockProfile, nixFailure, nixWords } from "./profiles.ts";

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
    for (const reference of ["./mine", "../mine", "."])
      await expect(lockProfile(reference)).rejects.toThrow(
        `${reference}: a relative path names no profile here — use an absolute path, or one under ~/`,
      );
  });

  it("a bare word is no reference at all — upstream's rule, as a launch reads it", async () => {
    await expect(lockProfile("juspay")).rejects.toThrow(
      "juspay: not a profile reference — a flake reference (github:owner/repo), an absolute path, or one under ~/",
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

  it("takes the thrown message, not an `error:` frame the trace above it prints", () => {
    // What `builtins.throw` in agent-distro's `mkProfile` prints for a
    // repository that still carries an `agent-distro.nix`: the trace frames
    // come first, and one of them carries `error:` too.
    expect(
      nixWords(
        [
          "error: … while evaluating the 'name' attribute of a derivation",
          "",
          "       … while evaluating a branch condition",
          "",
          "error: /home/me/repo/agent-distro.nix: agent-distro.nix is no longer read — a profile is a plugin.json.",
          'Move its fields into `extensions."asia.nixos.agent-distro"` (see https://agent-distro.kolu.dev/#profiles)',
        ].join("\n"),
        "exit 1",
      ),
    ).toBe(
      "error: /home/me/repo/agent-distro.nix: agent-distro.nix is no longer read — a profile is a plugin.json. " +
        'Move its fields into `extensions."asia.nixos.agent-distro"` (see https://agent-distro.kolu.dev/#profiles)',
    );
  });

  it("is the fallback when Nix said nothing", () => {
    expect(nixWords("  \n", "exit 1")).toBe("exit 1");
  });
});

describe("nixFailure — a failed Nix run as one failure message", () => {
  const TIMEOUT = 15 * 60_000;
  /** `execFile`'s error for a run that ended as `fields` say (its shape
   *  confirmed against Node: a timeout kill sets `killed`, an overflow sets
   *  `code`). */
  const ended = (fields: Partial<ExecFileException>): ExecFileException =>
    Object.assign(new Error("Command failed: nix build"), fields);
  const read = (stderr: string, error: ExecFileException) =>
    failureWords(
      nixFailure("cannot build x for x86_64-linux", { stderr, error }, TIMEOUT),
    );

  it("a failed build: the cause on the first line, the builder's own lines under it", () => {
    const stderr = [
      "error: builder for '/nix/store/aaa-profile-x.drv' failed with exit code 1;",
      "       last 2 log lines:",
      "       > reading plugin.json",
      "       > no plugin.json in /nix/store/bbb-src",
      "error: 1 dependencies of derivation '/nix/store/ccc-x.drv' failed to build",
    ].join("\n");
    const { headline, detail } = read(
      stderr,
      ended({ code: 1, killed: false }),
    );
    expect(headline).toBe(
      "cannot build x for x86_64-linux: error: 1 dependencies of derivation '/nix/store/ccc-x.drv' failed to build",
    );
    expect(detail).toContain("       > no plugin.json in /nix/store/bbb-src");
    expect(detail[0]).toBe(
      "error: builder for '/nix/store/aaa-profile-x.drv' failed with exit code 1;",
    );
  });

  it("the timeout's kill says so, with what Nix last printed under it", () => {
    const { headline, detail } = read(
      "copying path '/nix/store/ddd-nixpkgs' from 'https://cache.nixos.org'...",
      ended({ killed: true, signal: "SIGTERM", code: undefined }),
    );
    expect(headline).toBe(
      "cannot build x for x86_64-linux: nix did not finish in 15 minutes and was stopped",
    );
    expect(detail).toEqual([
      "copying path '/nix/store/ddd-nixpkgs' from 'https://cache.nixos.org'...",
    ]);
  });

  it("more output than kolu reads says so", () => {
    expect(
      read("evaluating…", ended({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }))
        .headline,
    ).toBe("cannot build x for x86_64-linux: nix printed more than kolu reads");
  });

  it("Nix said nothing: the process's own words, and no detail", () => {
    expect(
      read(
        "",
        Object.assign(new Error("spawn nix ENOENT"), { code: "ENOENT" }),
      ),
    ).toEqual({
      headline: "cannot build x for x86_64-linux: spawn nix ENOENT",
      detail: [],
    });
  });

  it("a one-line Nix error is said once", () => {
    expect(
      read(
        "error: flake 'github:me/p' does not provide attribute 'lib'\n",
        ended({ code: 1 }),
      ),
    ).toEqual({
      headline:
        "cannot build x for x86_64-linux: error: flake 'github:me/p' does not provide attribute 'lib'",
      detail: [],
    });
  });
});
