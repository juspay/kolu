import { describe, expect, it } from "vitest";
import {
  forceQuoteArg,
  shellJoin,
  shellQuoteArg,
  shellSplit,
} from "./index.ts";

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

describe("forceQuoteArg", () => {
  it("quotes a token even when it would be a safe bare word", () => {
    // A caller forces quoting to override a bare-word default — e.g. a leading
    // `~` the user QUOTED in source, which must stay literal (no expansion).
    expect(forceQuoteArg("~/x")).toBe("'~/x'");
    expect(forceQuoteArg("sonnet")).toBe("'sonnet'");
  });

  it("escapes an embedded single quote the canonical '\\'' way", () => {
    expect(forceQuoteArg("a'b")).toBe("'a'\\''b'");
  });

  it("round-trips through shellSplit", () => {
    expect(shellSplit(forceQuoteArg("~/x"))).toEqual(["~/x"]);
  });
});

describe("shellSplit", () => {
  it("is the exact inverse of shellJoin (round-trips every token shape)", () => {
    // The property that matters: a consumer reparsing its OWN joined output
    // gets back exactly the argv it joined — including the embedded-single-
    // quote idiom that a general tokenizer (string-argv) shatters.
    const cases: string[][] = [
      ["claude", "--model", "sonnet"],
      ["claude", "--settings", `{"ultracode": true}`],
      ["codex", "--config", `model_reasoning_effort="xhigh"`],
      ["claude", "--append-system-prompt", "be terse please"],
      ["claude", "--append-system-prompt", "don't do that"],
      ["claude", "--add-dir", "~/.claude"],
      ["a", "", "b"], // empty token survives
      ["weird", "a'b'c", "x  y"],
    ];
    for (const argv of cases) {
      expect(shellSplit(shellJoin(argv))).toEqual(argv);
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
