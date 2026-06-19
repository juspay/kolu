import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { shellJoin, shellQuoteArg, shellSplit } from "./index.ts";

/** The shared round-trip truth table: argv shapes a consumer joins and must get
 *  back unchanged. It is exercised two ways from one corpus — against shellSplit
 *  (the leaf's OWN inverse) and against a real POSIX shell (below) — so the same
 *  cases prove both the self-consistency and the actual no-word-split /
 *  no-injection claim that backs this package.
 *
 *  The entries carry every shape the bug (#1407) was about: the spaced JSON blob
 *  (`--settings '{…}'`), a spaced sentence, the apostrophe `'\''` idiom, an
 *  embedded-double-quote value, the empty token, and a value packed with shell
 *  metacharacters ($ ` ; & | * ( ) { }) whose quoting must neutralize them. The
 *  leading-`~` entry round-trips through shellSplit but is filtered out of the
 *  real-shell test, which deliberately re-expands `~` (see that test's tilde
 *  case) and so cannot byte-match it. */
const ROUND_TRIP_CORPUS: readonly (readonly string[])[] = [
  ["claude", "--model", "sonnet"],
  ["claude", "--settings", `{"ultracode": true}`],
  ["codex", "--config", `model_reasoning_effort="xhigh"`],
  ["claude", "--append-system-prompt", "be terse please"],
  ["claude", "--append-system-prompt", "don't do that"],
  ["claude", "--append-system-prompt", "a $b `c` ; d & e | f * (g) {h}"],
  ["claude", "--add-dir", "~/.claude"],
  ["a", "", "b"], // empty token survives
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
    // The preexec mark captures `~/…` as the user typed it (pre-expansion);
    // quoting it would suppress expansion and replay a literal `~` path.
    expect(shellQuoteArg("~/.claude/settings.json")).toBe(
      "~/.claude/settings.json",
    );
  });

  it("single-quotes a value with spaces so it stays ONE pasted argument", () => {
    // The footgun F8 names: a socket path with a space would otherwise re-split
    // into `--socket /tmp/my` + a stray `sock` and target the wrong daemon.
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
    // `it's` → 'it'\''s' — close the quote, an escaped literal quote, reopen.
    expect(shellQuoteArg("a'b")).toBe("'a'\\''b'");
  });

  it("quotes the empty string (a bare empty arg would just vanish)", () => {
    expect(shellQuoteArg("")).toBe("''");
  });
});

describe("shellSplit", () => {
  it("is the exact inverse of shellJoin (round-trips every token shape)", () => {
    // The property that matters: a consumer reparsing its OWN joined output
    // gets back exactly the argv it joined — including the embedded-single-
    // quote idiom that a general tokenizer (string-argv) shatters.
    for (const argv of ROUND_TRIP_CORPUS) {
      expect(shellSplit(shellJoin(argv))).toEqual([...argv]);
    }
  });

  it("parses the canonical '\\'' idiom that string-argv cannot", () => {
    // shellJoin(["don't"]) === "'don'\\''t'" — one token, an embedded quote.
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

/** Resolve a POSIX shell from PATH without hardcoding `/bin/sh`, so the test runs
 *  against whatever shell the Nix devshell / CI actually provides. Returns null
 *  when none is found (e.g. a stripped sandbox), which SKIPS the real-shell suite
 *  rather than failing it — the suite stays green on any platform. */
function findPosixShell(): string | null {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const name of ["sh", "bash", "dash"]) {
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

// The substantive guarantee: shellJoin's output, parsed by an ACTUAL shell,
// word-splits back into exactly the argv it was built from. The shellSplit
// tests above only check the leaf against its own tokenizer; this checks it
// against the real grammar that backs the no-word-split / no-injection claim.
describe.skipIf(POSIX_SHELL === null)(
  "shellJoin output parsed by a real POSIX shell",
  () => {
    // Non-null here by the skipIf guard above.
    const shell = POSIX_SHELL as string;

    /** Run `<shell> -c "printf '%s\0' <args…>"` and return the argv the shell
     *  actually built — the proof that shellJoin's output word-splits back into
     *  exactly its inputs.
     *
     *  `printf` is the stub: a safe bare word, so shellJoin leaves it unquoted,
     *  and a shell BUILTIN, so no executable temp file is needed (a stub script
     *  would fail under a noexec $TMPDIR). Its recycled `%s\0` format echoes each
     *  remaining argv element NUL-separated — the one separator that cannot
     *  collide with any byte inside a token, so the split is unambiguous. If the
     *  quoting let a value word-split or a metacharacter fire, printf would see a
     *  different field list and the deep-equality below would fail. */
    function replay(
      args: readonly string[],
      env: NodeJS.ProcessEnv = {},
    ): string[] {
      const line = shellJoin(["printf", "%s\\0", ...args]);
      const out = execFileSync(shell, ["-c", line], {
        encoding: "buffer",
        env: { ...process.env, ...env },
      });
      // printf writes a trailing \0 after the final field; drop the empty tail.
      return out.toString("utf8").split("\0").slice(0, -1);
    }

    it("word-splits each joined argv back into exactly its inputs", () => {
      // Strict byte-for-byte corpus: excludes leading-`~` tokens, which a real
      // shell re-expands (asserted separately below) so they cannot byte-match.
      const strict = ROUND_TRIP_CORPUS.filter(
        (argv) => !argv.some((token) => token.startsWith("~")),
      );
      for (const argv of strict) {
        expect(replay(argv)).toEqual([...argv]);
      }
    });

    it("re-expands a space-separated leading ~ value to $HOME (documented carve-out)", () => {
      // shellQuoteArg leaves a leading `~` BARE on purpose so the shell re-expands
      // it to the same home the source used — intended behavior, not a bug. Pin
      // it: `~/x` resolves to "$HOME/x" under a real shell.
      const home = "/home/kolu-tilde-test";
      expect(replay(["--settings", "~/x"], { HOME: home })).toEqual([
        "--settings",
        `${home}/x`,
      ]);
    });
  },
);
