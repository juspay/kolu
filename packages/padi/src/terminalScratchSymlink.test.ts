/**
 * `XDG_RUNTIME_DIR` has to be set BEFORE `koluRoot` is loaded — it captures the
 * root in a module-level const — hence the dynamic imports below and the
 * separate file (vitest gives each test file its own module registry, so a
 * sibling file that already imported `koluRoot` cannot poison this one).
 */

import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const realRoot = mkdtempSync(
  join(realpathSync(tmpdir()), "kolu-scratch-real-"),
);
const linkRoot = `${realRoot}-link`;
symlinkSync(realRoot, linkRoot);
process.env.XDG_RUNTIME_DIR = linkRoot;

const { appendTerminalFile, saveTerminalFile, cleanupTerminalScratch } =
  await import("./terminalScratch.ts");
const { setDaemonProcessId } = await import("./koluRoot.ts");

setDaemonProcessId("scratch-symlink-test-server");

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("scratch paths are stable under a symlinked temp root", () => {
  const terminalId = "scratch-symlink-terminal";
  afterAll(() => {
    cleanupTerminalScratch(terminalId);
    rmSync(linkRoot, { force: true });
    rmSync(realRoot, { recursive: true, force: true });
  });

  it("guard: the fixture really does diverge (else this file proves nothing)", () => {
    expect(realpathSync(linkRoot)).toBe(realRoot);
    expect(linkRoot).not.toBe(realRoot);
  });

  it("create and append answer with the SAME path", () => {
    const created = saveTerminalFile(terminalId, "n.md", b64("ab"));
    const appended = appendTerminalFile(terminalId, created, b64("cd"));
    expect(appended.path).toBe(created);
  });

  it("stays stable across MANY chunks, feeding each answer to the next", () => {
    let path = saveTerminalFile(terminalId, "many.md", b64("0"));
    const first = path;
    for (const piece of ["1", "2", "3", "4"]) {
      const out = appendTerminalFile(terminalId, path, b64(piece));
      expect(out.path).toBe(first);
      path = out.path;
    }
    expect(path).toBe(first);
  });

  it("answers with the RESOLVED spelling, not the symlinked one", () => {
    const created = saveTerminalFile(terminalId, "canon.md", b64("x"));
    expect(created.startsWith(realRoot)).toBe(true);
    expect(created.startsWith(linkRoot)).toBe(false);
  });

  it("accepts the caller's UNRESOLVED alias and canonicalizes the answer", () => {
    const created = saveTerminalFile(terminalId, "alias.md", b64("a"));
    const alias = created.replace(realRoot, linkRoot);
    expect(alias).not.toBe(created);
    const out = appendTerminalFile(terminalId, alias, b64("b"));
    expect(out.path).toBe(created);
    expect(out.totalBytes).toBe(2);
  });

  it("the containment fence still refuses an escape through the symlink", () => {
    const outside = saveTerminalFile(
      "some-other-terminal",
      "victim.md",
      b64("t"),
    );
    expect(() => appendTerminalFile(terminalId, outside, b64("x"))).toThrow(
      /outside the terminal's dir/,
    );
    cleanupTerminalScratch("some-other-terminal");
  });
});
