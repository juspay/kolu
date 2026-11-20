import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import {
  appendTerminalFile,
  cleanupTerminalScratch,
  sanitizeUploadName,
  saveTerminalFile,
} from "./terminalScratch.ts";

describe("sanitizeUploadName", () => {
  it("preserves unicode letters and digits in the name", () => {
    const a = "berichte_märz.pdf";
    expect(sanitizeUploadName(a)).toBe(a.normalize("NFC"));
    const b = "文件.txt";
    expect(sanitizeUploadName(b)).toBe(b.normalize("NFC"));
  });

  it("composes decomposed (NFD) input to NFC", () => {
    const nfd = "Café.md".normalize("NFD");
    expect(nfd).not.toBe(nfd.normalize("NFC"));
    expect(sanitizeUploadName(nfd)).toBe("Café.md".normalize("NFC"));
  });

  it("still strips directory components and traversal", () => {
    expect(sanitizeUploadName("a/b/c.png")).toBe("c.png");
    expect(sanitizeUploadName("../../etc/passwd")).toBe("passwd");
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
    setDaemonProcessId("scratch-perms-test-server");
  });
  afterAll(() => {
    cleanupTerminalScratch(terminalId);
  });

  it("writes the scratch file 0600 and its dir 0700 — no group/other access", () => {
    const path = saveTerminalFile(
      terminalId,
      "secret.txt",
      Buffer.from("sensitive").toString("base64"),
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });
});

describe("appendTerminalFile — the chunked upload's continuation", () => {
  const terminalId = "scratch-append-test-terminal";
  const other = "scratch-append-other-terminal";
  beforeAll(() => setDaemonProcessId("scratch-append-test-server"));
  afterAll(() => {
    cleanupTerminalScratch(terminalId);
    cleanupTerminalScratch(other);
  });

  const b64 = (s: string) => Buffer.from(s).toString("base64");

  it("stitches chunks back into the original bytes, in order", () => {
    const path = saveTerminalFile(terminalId, "joined.txt", b64("hello "));
    const first = appendTerminalFile(terminalId, path, b64("chunked "));
    const second = appendTerminalFile(terminalId, first.path, b64("world"));
    expect(readFileSync(second.path, "utf8")).toBe("hello chunked world");
    expect(second.totalBytes).toBe("hello chunked world".length);
  });

  it("keeps the appended file owner-only", () => {
    const path = saveTerminalFile(terminalId, "perms.txt", b64("a"));
    const out = appendTerminalFile(terminalId, path, b64("b"));
    expect(statSync(out.path).mode & 0o777).toBe(0o600);
  });

  it("refuses a path outside the terminal's own scratch dir", () => {
    const outside = saveTerminalFile(other, "victim.txt", b64("theirs"));
    expect(() => appendTerminalFile(terminalId, outside, b64("mine"))).toThrow(
      /outside the terminal's dir/,
    );
    expect(readFileSync(outside, "utf8")).toBe("theirs");
  });

  it("refuses a traversal path", () => {
    const path = saveTerminalFile(terminalId, "base.txt", b64("x"));
    const traversal = `${dirname(path)}/../../etc/passwd`;
    expect(() => appendTerminalFile(terminalId, traversal, b64("y"))).toThrow();
  });

  it("refuses a target that does not exist — an append never creates", () => {
    expect(() =>
      appendTerminalFile(
        terminalId,
        `${dirname(
          saveTerminalFile(terminalId, "anchor.txt", b64("x")),
        )}/never-written.txt`,
        b64("y"),
      ),
    ).toThrow(/does not exist/);
  });
});
