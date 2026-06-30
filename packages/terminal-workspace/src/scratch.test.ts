import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sanitizeUploadName, writeScratchFile } from "./scratch.ts";

describe("sanitizeUploadName", () => {
  it("keeps a unicode basename (NFC), drops directories and shell metachars", () => {
    expect(sanitizeUploadName("berichte_märz.pdf")).toBe(
      "berichte_märz.pdf".normalize("NFC"),
    );
    expect(sanitizeUploadName("a/b/c.png")).toBe("c.png");
    expect(sanitizeUploadName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeUploadName("na;me$().png")).toBe("na_me___.png");
    expect(sanitizeUploadName("...")).toBe("upload");
    expect(sanitizeUploadName("")).toBe("upload");
  });
});

describe("writeScratchFile", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-scratch-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("writes base64 bytes under <root>/<terminalId>/ and returns the path", () => {
    const data = Buffer.from("hello bytes").toString("base64");
    const p = writeScratchFile(root, "term-1", "drop.txt", data);
    expect(p).toBe(path.join(root, "term-1", "drop.txt"));
    expect(fs.readFileSync(p, "utf8")).toBe("hello bytes");
  });

  it("never clobbers a prior file — appends a collision suffix", () => {
    const a = writeScratchFile(
      root,
      "t",
      "x.png",
      Buffer.from("a").toString("base64"),
    );
    const b = writeScratchFile(
      root,
      "t",
      "x.png",
      Buffer.from("b").toString("base64"),
    );
    expect(a).not.toBe(b);
    expect(fs.readFileSync(a, "utf8")).toBe("a");
    expect(fs.readFileSync(b, "utf8")).toBe("b");
  });
});
