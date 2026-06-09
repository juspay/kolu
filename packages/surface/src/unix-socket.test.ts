/**
 * Falsifiability tests for the unix-socket transport pair: a router served
 * over a REAL `net.Server` (`serveOverUnixSocket`) and consumed over a REAL
 * `net.Socket` (`unixSocketLink`) — plus the bind-time hardening that makes
 * serving additive (outcome verdicts, never a rejection) and safe against
 * data loss (never unlink a path not proven to be a dead socket inode).
 *
 * Also pins `getRuntimeSocketPath`'s one invariant: for a given user, every
 * process computes the same path regardless of what launched it — especially
 * the off-systemd fallback, whose `os.tmpdir()` form would be
 * `$TMPDIR`-dependent and so diverge between a launchd-spawned server
 * (`/var/folders/.../T`) and a `nix run` CLI (`/tmp`).
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Router } from "@orpc/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { unixSocketLink } from "./links/unix-socket";
import { implement } from "./peer-server";
import { type Channel, implementSurface, inMemoryChannel } from "./server";
import {
  getRuntimeSocketPath,
  serveOverUnixSocket,
  type UnixSocketListener,
} from "./unix-socket";

const surface = defineSurface({
  procedures: {
    math: {
      double: {
        input: z.object({ x: z.number() }),
        output: z.object({ y: z.number() }),
      },
    },
  },
});

// biome-ignore lint/suspicious/noExplicitAny: the shape `serveOverUnixSocket` accepts, mirroring its own `Router<any, any>` param.
function buildRouter(): Router<any, any> {
  const fragment = implementSurface(surface, {
    channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
    procedures: {
      math: { double: async ({ input }) => ({ y: input.x * 2 }) },
    },
  });
  return implement(surface.contract).router(
    // biome-ignore lint/suspicious/noExplicitAny: fragment procedure-context vs. contract-derived param mismatch; runtime shape is valid (same cast as mini-ci and kolu's createInProcessPtyHost).
    { ...fragment.router } as any,
    // biome-ignore lint/suspicious/noExplicitAny: narrow back to the `Router<any, any>` serving wants (see above).
  ) as Router<any, any>;
}

describe("getRuntimeSocketPath", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
  });

  it("returns an explicit override verbatim, ignoring the environment", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(
      getRuntimeSocketPath({
        app: "myapp",
        file: "a.sock",
        override: "/custom/x.sock",
      }),
    ).toBe("/custom/x.sock");
  });

  it("treats an empty override as absent (falls back to the computed path)", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(
      getRuntimeSocketPath({ app: "myapp", file: "a.sock", override: "" }),
    ).toBe("/run/user/1000/myapp/a.sock");
  });

  it("anchors under $XDG_RUNTIME_DIR/<app> when XDG is set (systemd Linux)", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getRuntimeSocketPath({ app: "myapp", file: "a.sock" })).toBe(
      "/run/user/1000/myapp/a.sock",
    );
  });

  describe("off systemd (no XDG_RUNTIME_DIR — macOS, non-systemd Linux)", () => {
    it("uses a fixed per-user /tmp/<app>-$UID dir, NOT os.tmpdir()", () => {
      delete process.env.XDG_RUNTIME_DIR;
      const uid = process.getuid?.() ?? "shared";
      expect(getRuntimeSocketPath({ app: "myapp", file: "a.sock" })).toBe(
        `/tmp/myapp-${uid}/a.sock`,
      );
    });

    it("is $TMPDIR-independent: the same path whatever TMPDIR is", () => {
      delete process.env.XDG_RUNTIME_DIR;
      const saved = process.env.TMPDIR;
      try {
        process.env.TMPDIR = "/var/folders/xx/private/T"; // a launchd-style TMPDIR
        const underLaunchd = getRuntimeSocketPath({
          app: "myapp",
          file: "a.sock",
        });
        process.env.TMPDIR = "/tmp"; // a nix-run-style TMPDIR
        const underNixRun = getRuntimeSocketPath({
          app: "myapp",
          file: "a.sock",
        });
        // An os.tmpdir()-based form would differ here; a fixed /tmp anchor cannot.
        expect(underLaunchd).toBe(underNixRun);
      } finally {
        if (saved === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = saved;
      }
    });
  });
});

describe("serveOverUnixSocket + unixSocketLink — real socket round-trip", () => {
  let listener: UnixSocketListener;
  let socketPath: string;

  beforeAll(async () => {
    socketPath = join(mkdtempSync(join(tmpdir(), "surface-usock-")), "a.sock");
    listener = await serveOverUnixSocket({
      socketPath,
      router: buildRouter(),
    });
  });

  afterAll(() => listener.close());

  it("binds the requested path and reports a listening outcome", () => {
    expect(listener.socketPath).toBe(socketPath);
    expect(listener.outcome).toEqual({ kind: "listening" });
    expect(existsSync(socketPath)).toBe(true);
  });

  it("round-trips a procedure over the socket", async () => {
    const { client, dispose } = await unixSocketLink<typeof surface.contract>({
      socketPath,
    });
    expect(await client.surface.math.double({ x: 21 })).toEqual({ y: 42 });
    dispose();
  });

  it("accepts more than one independent client connection", async () => {
    const a = await unixSocketLink<typeof surface.contract>({ socketPath });
    const b = await unixSocketLink<typeof surface.contract>({ socketPath });
    expect(await a.client.surface.math.double({ x: 1 })).toEqual({ y: 2 });
    expect(await b.client.surface.math.double({ x: 2 })).toEqual({ y: 4 });
    a.dispose();
    b.dispose();
  });

  it("rejects the connect with the raw socket error when nothing serves the path", async () => {
    const dead = join(mkdtempSync(join(tmpdir(), "surface-usock-dead-")), "no.sock");
    await expect(
      unixSocketLink<typeof surface.contract>({ socketPath: dead }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("degrades to a no-op with an already-served outcome when a live peer owns the path", async () => {
    const second = await serveOverUnixSocket({
      socketPath,
      router: buildRouter(),
    });
    expect(second.outcome).toEqual({ kind: "already-served" });
    expect(() => second.close()).not.toThrow();
    // the original listener is untouched and still serving
    const { client, dispose } = await unixSocketLink<typeof surface.contract>({
      socketPath,
    });
    expect(await client.surface.math.double({ x: 3 })).toEqual({ y: 6 });
    dispose();
  });

  it("refuses to delete an existing regular file at the socket path (no data loss)", async () => {
    // A user-supplied path may name their own regular file; a connect() probe
    // against it fails (ENOTSOCK-ish), which must not be read as "stale
    // socket → safe to delete".
    const filePath = join(
      mkdtempSync(join(tmpdir(), "surface-usock-file-")),
      "important.txt",
    );
    writeFileSync(filePath, "precious user data");
    const l = await serveOverUnixSocket({
      socketPath: filePath,
      router: buildRouter(),
    });
    expect(l.outcome.kind).not.toBe("listening");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("precious user data");
    expect(() => l.close()).not.toThrow();
    expect(existsSync(filePath)).toBe(true);
  });

  it("refuses to delete a real socket inode it could not probe (EACCES, not stale)", async () => {
    // A connect() probe that fails for a NON-stale reason must NOT be read as
    // "stale socket → safe to delete". Here the inode IS a real socket (lstat
    // confirms it — so the inode-type guard alone would happily unlink it),
    // yet `connect()` fails with EACCES because we strip the socket file's
    // own perms (connecting a unix socket needs write perm on it). The probe
    // must report unknown, not stale, so the socket survives the bind attempt.
    if (process.getuid?.() === 0) return; // root bypasses unix perm checks
    const dir = mkdtempSync(join(tmpdir(), "surface-usock-eacces-"));
    const liveSocketPath = join(dir, "live.sock");
    const peer: Server = await new Promise((resolve) => {
      const s = createServer();
      s.listen(liveSocketPath, () => resolve(s));
    });
    try {
      chmodSync(liveSocketPath, 0o000); // connect() → EACCES; lstat still works
      const l = await serveOverUnixSocket({
        socketPath: liveSocketPath,
        router: buildRouter(),
      });
      expect(l.outcome).toMatchObject({ kind: "probe-failed" });
      expect(existsSync(liveSocketPath)).toBe(true);
      expect(() => l.close()).not.toThrow();
      expect(existsSync(liveSocketPath)).toBe(true);
    } finally {
      peer.close();
    }
  });

  it("refuses to serve from a dir with group/other access (dir-not-private)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "surface-usock-loose-"));
    chmodSync(dir, 0o770); // group access — another principal could reach in
    const l = await serveOverUnixSocket({
      socketPath: join(dir, "a.sock"),
      router: buildRouter(),
    });
    expect(l.outcome).toMatchObject({ kind: "dir-not-private" });
    expect(existsSync(join(dir, "a.sock"))).toBe(false);
  });

  it("close() removes the socket file and is idempotent", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "surface-usock-close-")), "a.sock");
    const l = await serveOverUnixSocket({ socketPath: p, router: buildRouter() });
    expect(l.outcome).toEqual({ kind: "listening" });
    expect(existsSync(p)).toBe(true);
    l.close();
    expect(existsSync(p)).toBe(false);
    expect(() => l.close()).not.toThrow();
  });
});
