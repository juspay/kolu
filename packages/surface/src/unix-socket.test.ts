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
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { implement, type Router } from "@orpc/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { unixSocketLink } from "./links/unix-socket";
import { lifetimeContract } from "./peer-server.lifetime.contract";
import { implementSurface } from "./server";
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
  const runtime = implementSurface(surface, {
    procedures: {
      math: { double: async ({ input }) => ({ y: input.x * 2 }) },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: runtime.router is typed `unknown`; narrow to the `Router<any, any>` serving wants.
  return runtime.router as Router<any, any>;
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
    const dead = join(
      mkdtempSync(join(tmpdir(), "surface-usock-dead-")),
      "no.sock",
    );
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
    // The exact machine-readable verdict, not merely "not listening": a
    // regular file at the path is `not-a-socket` whether the probe returned
    // ENOTSOCK (refined via lstat) or a stale-looking code (caught by the
    // inode guard). Either route must land on the same outcome.
    expect(l.outcome).toEqual({ kind: "not-a-socket" });
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

  it("refuses when the socket dir is a SYMLINK, even to an owner-private target", async () => {
    // A `statSync` privacy check follows symlinks: an attacker who owns the
    // `/tmp` path component could point the rendezvous dir at any owner-
    // private directory, sail past the perm check, then later re-point the
    // link to redirect clients. The check must `lstat` and reject a symlink
    // outright — its perms/target are irrelevant, the link itself is the hole.
    if (process.getuid?.() === undefined) return; // no uid semantics (Windows)
    const base = mkdtempSync(join(tmpdir(), "surface-usock-symlink-"));
    const realDir = join(base, "real"); // a genuinely owner-private 0700 dir
    mkdirSync(realDir, { mode: 0o700 });
    const linkDir = join(base, "link");
    symlinkSync(realDir, linkDir);
    const l = await serveOverUnixSocket({
      socketPath: join(linkDir, "a.sock"),
      router: buildRouter(),
    });
    expect(l.outcome).toMatchObject({ kind: "dir-not-private" });
    expect(existsSync(join(linkDir, "a.sock"))).toBe(false);
  });

  it("close() removes the socket file and is idempotent", async () => {
    const p = join(
      mkdtempSync(join(tmpdir(), "surface-usock-close-")),
      "a.sock",
    );
    const l = await serveOverUnixSocket({
      socketPath: p,
      router: buildRouter(),
    });
    expect(l.outcome).toEqual({ kind: "listening" });
    expect(existsSync(p)).toBe(true);
    l.close();
    expect(existsSync(p)).toBe(false);
    expect(() => l.close()).not.toThrow();
  });
});

describe("close() disconnects established peers (surface-lifetime-audit step 3)", () => {
  const freshListener = async (
    tag: string,
    // biome-ignore lint/suspicious/noExplicitAny: the shape `serveOverUnixSocket` accepts, mirroring its own `Router<any, any>` param.
    router: Router<any, any> = buildRouter(),
  ) => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), `surface-usock-${tag}-`)),
      "a.sock",
    );
    const listener = await serveOverUnixSocket({ socketPath, router });
    expect(listener.outcome).toEqual({ kind: "listening" });
    return { socketPath, listener };
  };

  it("a call that succeeded before close() is REFUSED after it — the established peer is destroyed", async () => {
    const { socketPath, listener } = await freshListener("drop");
    const { client, dispose } = await unixSocketLink<typeof surface.contract>({
      socketPath,
    });
    // Established and served: the peer is real, not merely accepted.
    expect(await client.surface.math.double({ x: 21 })).toEqual({ y: 42 });

    listener.close();

    // Red on the pre-fix code: server.close() only stopped ACCEPTING — the
    // established connection kept serving and this call still resolved
    // { y: 42 } (the illegal state "a closed host still serving live
    // peers", made visible). The destroyed link now rejects.
    await expect(client.surface.math.double({ x: 2 })).rejects.toThrow();
    dispose();
  });

  it("tears down an in-flight subscription handler — its generator finalizes with the peer", async () => {
    // An interval-free forever-generator whose finally flips a test-local
    // flag: the serve runs in-process, so handler teardown is directly
    // observable. The teardown path under test is the reused settle chain:
    // socket.destroy() → serveOverStdio settles → peer.close() → the
    // handler's abort signal fires → the generator's finally runs.
    let finalized = false;
    // The contract is the existing shared one (a value import is safe — it is
    // the contract module, not a fixture); only the handlers are local.
    const t = implement(lifetimeContract);
    const router = t.router({
      ping: t.ping.handler(() => "pong"),
      tick: t.tick.handler(async function* () {
        try {
          for (let n = 0; ; n++) {
            yield { n };
            await delay(10);
          }
        } finally {
          finalized = true;
        }
      }),
    });
    const { socketPath, listener } = await freshListener("sub", router);

    const { client, dispose } = await unixSocketLink<typeof lifetimeContract>({
      socketPath,
    });
    const ticks = await client.tick();
    const it1 = ticks[Symbol.asyncIterator]();
    expect((await it1.next()).value).toEqual({ n: 0 }); // live subscription

    listener.close();

    // Red on the pre-fix code: the generator kept yielding forever (nothing
    // ended the peer), so `finalized` never flipped. The settle chain now
    // aborts the handler and the finally runs promptly.
    await expect
      .poll(() => finalized, { timeout: 2_000, interval: 25 })
      .toBe(true);
    dispose();
  });

  it("destroys a half-open peer that never wrote a byte", async () => {
    const { socketPath, listener } = await freshListener("halfopen");
    const raw = createConnection(socketPath); // wedged: connects, never writes
    await once(raw, "connect");
    let closed = false;
    raw.once("close", () => {
      closed = true;
    });

    listener.close();

    // Red on the pre-fix code: nothing ever ended the wedged peer.
    // destroy() is now unconditional — no drain negotiation with a peer
    // that never spoke.
    await expect
      .poll(() => closed, { timeout: 2_000, interval: 25 })
      .toBe(true);
  });

  it("close() after a peer already left: doesn't throw, stays idempotent, still disconnects the remaining live peer", async () => {
    const { socketPath, listener } = await freshListener("shed");
    // Peer A is a raw connection so its lifecycle is directly observable —
    // both ends live in this process. The shed itself is not behaviorally
    // assertable (destroy() on a closed socket is a no-op; the shed's value
    // is the index not retaining dead sockets) — the waits below give the
    // SERVER-side 'close' handler its event-loop turns (the client-side
    // 'close' fires first; the server socket sees EOF at the next poll
    // phase and emits 'close' a turn later — measured at two setImmediate
    // turns), so the close() under test iterates a Set that has already
    // shed peer A: the named code path is the one exercised.
    const rawA = createConnection(socketPath);
    await once(rawA, "connect");
    const b = await unixSocketLink<typeof surface.contract>({ socketPath });
    expect(await b.client.surface.math.double({ x: 3 })).toEqual({ y: 6 });

    // Peer A leaves on its own: the tracked set sheds it via its 'close'.
    const aGone = once(rawA, "close");
    rawA.destroy();
    await aGone;
    // Two turns, not one — the server-side 'close' (and its Set delete)
    // lands two setImmediate turns behind the client-side 'close'.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(() => listener.close()).not.toThrow();
    expect(() => listener.close()).not.toThrow(); // still idempotent

    // Peer B was disconnected by the close.
    await expect(b.client.surface.math.double({ x: 4 })).rejects.toThrow();
    b.dispose();
  });
});
