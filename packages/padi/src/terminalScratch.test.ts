import { statSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setKoluServerProcessId } from "./koluRoot.ts";
import {
  cleanupTerminalScratch,
  sanitizeUploadName,
  saveTerminalFile,
} from "./terminalScratch.ts";

describe("sanitizeUploadName", () => {
  it("preserves unicode letters and digits in the name", () => {
    // The old ASCII allowlist replaced every non-ASCII byte with `_`, so a
    // name like `berichte_märz.pdf` became `berichte______.pdf`.
    const a = "berichte_märz.pdf";
    expect(sanitizeUploadName(a)).toBe(a.normalize("NFC"));
    const b = "文件.txt";
    expect(sanitizeUploadName(b)).toBe(b.normalize("NFC"));
  });

  it("composes decomposed (NFD) input to NFC", () => {
    const nfd = "Café.md".normalize("NFD");
    expect(nfd).not.toBe(nfd.normalize("NFC")); // guard: truly NFD
    expect(sanitizeUploadName(nfd)).toBe("Café.md".normalize("NFC"));
  });

  it("still strips directory components and traversal", () => {
    expect(sanitizeUploadName("a/b/c.png")).toBe("c.png");
    expect(sanitizeUploadName("../../etc/passwd")).toBe("passwd");
    // basename doesn't split backslashes on POSIX, but the allowlist still
    // collapses them so a name can't smuggle a separator through.
    expect(sanitizeUploadName("a\\b.png")).toBe("a_b.png");
  });

  it("collapses control chars and shell metacharacters to underscores", () => {
    expect(sanitizeUploadName("na;me$().png")).toBe("na_me___.png");
  });

  it("falls back to 'upload' when nothing survives", () => {
    expect(sanitizeUploadName("...")).toBe("upload");
    expect(sanitizeUploadName("")).toBe("upload");
  });
});

describe("saveTerminalFile creates owner-only scratch (js/insecure-temporary-file)", () => {
  const terminalId = "scratch-perms-test-terminal";
  beforeAll(() => {
    // koluScratchDir() reads the injected server id (fail-fast otherwise).
    setKoluServerProcessId("scratch-perms-test-server");
  });
  afterAll(() => {
    cleanupTerminalScratch(terminalId);
  });

  it("writes the scratch file 0600 and its dir 0700 — no group/other access", () => {
    // Browser-pasted/dropped content is potentially sensitive; the receiving
    // agent runs as THIS user, so owner-only is byte-identical for the real read
    // while closing the world-readable exposure. Reverting the explicit modes
    // leaves the fs defaults (0644 file / 0755 dir under a standard 022 umask),
    // which fail these assertions.
    const path = saveTerminalFile(
      terminalId,
      "secret.txt",
      Buffer.from("sensitive").toString("base64"),
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });
});
