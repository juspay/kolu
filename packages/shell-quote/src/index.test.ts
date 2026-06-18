import { describe, expect, it } from "vitest";
import { shellQuoteArg } from "./index.ts";

describe("shellQuoteArg", () => {
  it("leaves a safe bare word (ssh target / plain socket path) unquoted", () => {
    expect(shellQuoteArg("nix@prod")).toBe("nix@prod");
    expect(shellQuoteArg("/run/user/1000/kaval-9221/pty-host.sock")).toBe(
      "/run/user/1000/kaval-9221/pty-host.sock",
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
