/**
 * The scratch path is stable across create and append even when the temp root
 * is reached through a SYMLINK — the darwin bug, reproduced on any platform.
 *
 * macOS's `/tmp` is a symlink to `/private/tmp`, and `os.tmpdir()` on macOS
 * returns a per-user dir under `/var/folders/…` which is itself reached through
 * the `/var → /private/var` symlink. So on darwin, and only on darwin, the
 * unresolved and realpath-resolved spellings of a scratch file differ. The
 * chunked upload's create call answered with the first and its append calls
 * with the second, which darwin CI caught as
 *
 *   AssertionError: expected '/private/tmp/…/n.md' to be '/tmp/…/n.md'
 *
 * and which linux could never catch, because its temp root has no symlinked
 * ancestor and the two spellings coincide.
 *
 * This file removes the platform's luck from the equation: it points
 * `XDG_RUNTIME_DIR` at a symlink to a real directory, so the divergence exists
 * on linux too. The env var has to be set BEFORE `koluRoot` is loaded — it
 * captures the root in a module-level const — hence the dynamic imports below
 * and the separate file (vitest gives each test file its own module registry,
 * so a sibling file that already imported `koluRoot` cannot poison this one).
 */

import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// A real directory, and a symlink pointing at it. Everything below reaches the
// scratch tree THROUGH the symlink, exactly as macOS reaches /tmp.
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
    // If the symlink resolved to itself, every assertion below would pass
    // vacuously and the darwin bug would sail through again.
    expect(realpathSync(linkRoot)).toBe(realRoot);
    expect(linkRoot).not.toBe(realRoot);
  });

  it("create and append answer with the SAME path", () => {
    // The regression: these two disagreed on darwin, so the second chunk of an
    // upload appeared to rename the file mid-flight.
    const created = saveTerminalFile(terminalId, "n.md", b64("ab"));
    const appended = appendTerminalFile(terminalId, created, b64("cd"));
    expect(appended.path).toBe(created);
  });

  it("stays stable across MANY chunks, feeding each answer to the next", () => {
    // The real client loop: every chunk hands back the path it was given. A
    // path that shifted even once would break the chain here.
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
    // "Canonical" is the resolved form — realpath both, not neither.
    const created = saveTerminalFile(terminalId, "canon.md", b64("x"));
    expect(created.startsWith(realRoot)).toBe(true);
    expect(created.startsWith(linkRoot)).toBe(false);
  });

  it("accepts the caller's UNRESOLVED alias and canonicalizes the answer", () => {
    // A client that kept an old-style unresolved path must still be able to
    // continue its upload — and gets the canonical spelling back.
    const created = saveTerminalFile(terminalId, "alias.md", b64("a"));
    const alias = created.replace(realRoot, linkRoot);
    expect(alias).not.toBe(created); // guard: it really is a different string
    const out = appendTerminalFile(terminalId, alias, b64("b"));
    expect(out.path).toBe(created);
    expect(out.totalBytes).toBe(2);
  });

  it("the containment fence still refuses an escape through the symlink", () => {
    // Canonicalizing the RETURN value must not be mistaken for the fence. A
    // path outside the terminal's dir is refused however it is spelled.
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
