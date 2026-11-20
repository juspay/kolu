/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { shellJoin, shellQuoteArg, shellSplit } from "./index.ts";

/** The POSIX shells this package's replay guarantee assumes — the same four the
 *  README's "Target shell" note enumerates. Declared once so `findPosixShell`'s
 *  probe order has a single home in code; keep it in step with the README prose,
 *  which can't import it. */
const POSIX_SHELLS = ["sh", "bash", "zsh", "dash"] as const;

const ROUND_TRIP_CORPUS: readonly (readonly string[])[] = [
  ["claude", "--model", "sonnet"],
  ["claude", "--settings", `{"ultracode": true}`],
  ["codex", "--config", `model_reasoning_effort="xhigh"`],
  ["claude", "--append-system-prompt", "be terse please"],
  ["claude", "--append-system-prompt", "don't do that"],
  ["claude", "--append-system-prompt", "a $b `c` ; d & e | f * (g) {h}"],
  ["claude", "--add-dir", "~/.claude"],
  ["a", "", "b"],
  ["weird", "a'b'c", "x  y"],
];

describe("shellQuoteArg", () => {
  it("leaves a safe bare word (ssh target / plain socket path) unquoted", () => {
    expect(shellQuoteArg("nix@prod")).toBe("nix@prod");
    expect(shellQuoteArg("/run/user/1000/kaval-9221/pty-host.sock")).toBe(
      "/run/user/1000/kaval-9221/pty-host.sock",
    );
  });

  it("leaves a leading-tilde path BARE so the shell re-expands it", () => {
    expect(shellQuoteArg("~/.claude/settings.json")).toBe(
      "~/.claude/settings.json",
    );
  });

  it("single-quotes a value with spaces so it stays ONE pasted argument", () => {
    expect(shellQuoteArg("/tmp/my sock/pty-host.sock")).toBe(
      "'/tmp/my sock/pty-host.sock'",
    );
  });

  it("quotes shell metacharacters/backticks so the pasted command can't run them", () => {
    expect(shellQuoteArg("/tmp/$(rm -rf ~)/sock")).toBe(
      "'/tmp/$(rm -rf ~)/sock'",
    );
    expect(shellQuoteArg("a`whoami`b")).toBe("'a`whoami`b'");
    expect(shellQuoteArg("a;b&c|d")).toBe("'a;b&c|d'");
  });

  it("escapes an embedded single quote the canonical '\\'' way", () => {
    expect(shellQuoteArg("a'b")).toBe("'a'\\''b'");
  });

  it("quotes the empty string (a bare empty arg would just vanish)", () => {
    expect(shellQuoteArg("")).toBe("''");
  });
});

describe("shellSplit", () => {
  it("is the exact inverse of shellJoin (round-trips every token shape)", () => {
    for (const argv of ROUND_TRIP_CORPUS) {
      expect(shellSplit(shellJoin(argv))).toEqual([...argv]);
    }
  });

  it("parses the canonical '\\'' idiom that string-argv cannot", () => {
    expect(shellSplit(`'don'\\''t'`)).toEqual(["don't"]);
  });

  it("ignores leading/trailing/extra whitespace between tokens", () => {
    expect(shellSplit("  claude   --model    sonnet  ")).toEqual([
      "claude",
      "--model",
      "sonnet",
    ]);
    expect(shellSplit("")).toEqual([]);
    expect(shellSplit("   ")).toEqual([]);
  });
});

function findPosixShell(): string | null {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const name of POSIX_SHELLS) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not executable here — keep scanning PATH
      }
    }
  }
  return null;
}

const POSIX_SHELL = findPosixShell();

describe.skipIf(POSIX_SHELL === null)(
  "shellJoin output parsed by a real POSIX shell",
  () => {
    const shell = POSIX_SHELL as string;

    function replay(
      args: readonly string[],
      env: NodeJS.ProcessEnv = {},
    ): string[] {
      const line = shellJoin(["printf", "%s\\0", ...args]);
      const out = execFileSync(shell, ["-c", line], {
        encoding: "buffer",
        env: { ...process.env, ...env },
      });
      return out.toString("utf8").split("\0").slice(0, -1);
    }

    it("word-splits each joined argv back into exactly its inputs", () => {
      const strict = ROUND_TRIP_CORPUS.filter(
        (argv) => !argv.some((token) => token.startsWith("~")),
      );
      for (const argv of strict) {
        expect(replay(argv)).toEqual([...argv]);
      }
    });

    it("re-expands a space-separated leading ~ value to $HOME (documented carve-out)", () => {
      const home = "/home/kolu-tilde-test";
      expect(replay(["--settings", "~/x"], { HOME: home })).toEqual([
        "--settings",
        `${home}/x`,
      ]);
    });
  },
);
