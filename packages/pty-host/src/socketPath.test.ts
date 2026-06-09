/**
 * The socket path is the rendezvous between two separate processes (kolu-server
 * and kolu-tui), so its ONE invariant is: for a given user, every process
 * computes the same path regardless of what launched it. These tests pin that —
 * especially the off-systemd fallback, whose earlier `os.tmpdir()` form was
 * `$TMPDIR`-dependent and so diverged between a launchd server (`/var/folders`)
 * and a `nix run` CLI (`/tmp`), the macOS "no socket at /tmp/kolu" bug.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPtyHostSocketPath } from "./socketPath.ts";

describe("getPtyHostSocketPath", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
  });

  it("returns an explicit override verbatim, ignoring the environment", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath("/custom/x.sock")).toBe("/custom/x.sock");
  });

  it("treats an empty override as absent (falls back to the computed path)", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath("")).toBe("/run/user/1000/kolu/pty-host.sock");
  });

  describe("on systemd Linux (XDG_RUNTIME_DIR set)", () => {
    beforeEach(() => {
      process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    });
    it("anchors the socket under $XDG_RUNTIME_DIR/kolu", () => {
      expect(getPtyHostSocketPath()).toBe("/run/user/1000/kolu/pty-host.sock");
    });
  });

  describe("off systemd (no XDG_RUNTIME_DIR — macOS, non-systemd Linux)", () => {
    beforeEach(() => {
      delete process.env.XDG_RUNTIME_DIR;
    });

    it("uses a fixed per-user /tmp/kolu-$UID dir, NOT os.tmpdir()", () => {
      const uid = process.getuid?.() ?? "shared";
      expect(getPtyHostSocketPath()).toBe(`/tmp/kolu-${uid}/pty-host.sock`);
    });

    it("is $TMPDIR-independent: the same path whatever TMPDIR is", () => {
      const saved = process.env.TMPDIR;
      try {
        process.env.TMPDIR = "/var/folders/xx/private/T"; // a launchd-style TMPDIR
        const underLaunchd = getPtyHostSocketPath();
        process.env.TMPDIR = "/tmp"; // a nix-run-style TMPDIR
        const underNixRun = getPtyHostSocketPath();
        // The pre-fix os.tmpdir() form would differ here; the fix makes them equal.
        expect(underLaunchd).toBe(underNixRun);
      } finally {
        if (saved === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = saved;
      }
    });
  });
});
