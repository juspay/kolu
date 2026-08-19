/**
 * Falsifiability tests for the unix-socket transport pair: a surface served
 * over a REAL `net.Server` (`serveOverUnixSocket`) and consumed over a REAL
 * `net.Socket` (`unixSocketLink`) — plus the bind-time hardening that makes
 * serving additive (outcome verdicts, never a rejection) and safe against data
 * loss (never unlink a path not proven to be a dead socket inode).
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
import { Effect, Schema, Stream } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { defineSurface } from "./define";
import { unixSocketLink } from "./links/unix-socket";
import type { WireLink } from "./links/wire";
import {
  LIFETIME_TICK_TAG,
  lifetimeSurface,
} from "./peer-server.lifetime.contract";
import { implementSurface, type SurfaceHandlers } from "./server";
import {
  getRuntimeSocketPath,
  isPrivateOwnedDir,
  serveOverUnixSocket,
  type UnixSocketListener,
} from "./unix-socket";

const surface = defineSurface({
  procedures: {
    math: {
      double: {
        input: Schema.Struct({ x: Schema.Number }),
        output: Schema.Struct({ y: Schema.Number }),
      },
    },
  },
});

const DOUBLE_TAG = "surface/math/double";

/** The `{ group, handlers }` pair `serveOverUnixSocket` serves. */
function buildServed() {
  const runtime = implementSurface(surface, {
    procedures: {
      math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
    },
  });
  return {
    group: runtime.group,
    handlers: runtime.handlers,
    log: silentLogger,
  };
}

/** The one wire round-trip these tests make. */
function double(link: WireLink, x: number): Promise<unknown> {
  return Effect.runPromise(link.dispatch.unary(DOUBLE_TAG, { x }));
}

function connectLink(socketPath: string): Promise<WireLink> {
  return unixSocketLink({ group: surface.group, socketPath });
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

describe("isPrivateOwnedDir", () => {
  // The public predicate is the same three checks `serveOverUnixSocket` uses
  // on the parent dir. Pin them at the export so a consumer (olai's vault
  // lock) cannot drift from the serve-time verdict without this file failing.
  const skipWithoutUid = process.getuid?.() === undefined;

  it("accepts an owner-only directory the current uid owns", () => {
    if (skipWithoutUid) return;
    const dir = mkdtempSync(join(tmpdir(), "surface-priv-ok-"));
    chmodSync(dir, 0o700);
    expect(isPrivateOwnedDir(dir)).toBe(true);
  });

  it("rejects a directory with group or other access", () => {
    if (skipWithoutUid) return;
    const dir = mkdtempSync(join(tmpdir(), "surface-priv-loose-"));
    chmodSync(dir, 0o770);
    expect(isPrivateOwnedDir(dir)).toBe(false);
  });

  it("rejects a symlink, even when the target is owner-private", () => {
    if (skipWithoutUid) return;
    const base = mkdtempSync(join(tmpdir(), "surface-priv-symlink-"));
    const realDir = join(base, "real");
    mkdirSync(realDir, { mode: 0o700 });
    chmodSync(realDir, 0o700);
    const linkDir = join(base, "link");
    symlinkSync(realDir, linkDir);
    expect(isPrivateOwnedDir(linkDir)).toBe(false);
  });

  it("rejects a regular file", () => {
    if (skipWithoutUid) return;
    const dir = mkdtempSync(join(tmpdir(), "surface-priv-file-"));
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "x", { mode: 0o600 });
    expect(isPrivateOwnedDir(file)).toBe(false);
  });

  it("lets lstatSync throw when the path cannot be stated", () => {
    if (skipWithoutUid) return;
    const missing = join(
      mkdtempSync(join(tmpdir(), "surface-priv-gone-")),
      "no-such-dir",
    );
    expect(() => isPrivateOwnedDir(missing)).toThrow(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });
});

describe("serveOverUnixSocket + unixSocketLink — real socket round-trip", () => {
  let listener: UnixSocketListener;
  let socketPath: string;

  beforeAll(async () => {
    socketPath = join(mkdtempSync(join(tmpdir(), "surface-usock-")), "a.sock");
    listener = await serveOverUnixSocket({ socketPath, ...buildServed() });
  });

  afterAll(() => listener.close());

  it("binds the requested path and reports a listening outcome", () => {
    expect(listener.socketPath).toBe(socketPath);
    expect(listener.outcome).toEqual({ kind: "listening" });
    expect(existsSync(socketPath)).toBe(true);
  });

  it("round-trips a procedure over the socket", async () => {
    const link = await connectLink(socketPath);
    expect(await double(link, 21)).toEqual({ y: 42 });
    await link.dispose();
  });

  it("accepts more than one independent client connection", async () => {
    const a = await connectLink(socketPath);
    const b = await connectLink(socketPath);
    expect(await double(a, 1)).toEqual({ y: 2 });
    expect(await double(b, 2)).toEqual({ y: 4 });
    await a.dispose();
    await b.dispose();
  });

  it("rejects the connect with the raw socket error when nothing serves the path", async () => {
    const dead = join(
      mkdtempSync(join(tmpdir(), "surface-usock-dead-")),
      "no.sock",
    );
    await expect(connectLink(dead)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("degrades to a no-op with an already-served outcome when a live peer owns the path", async () => {
    const second = await serveOverUnixSocket({ socketPath, ...buildServed() });
    expect(second.outcome).toEqual({ kind: "already-served" });
    expect(() => second.close()).not.toThrow();
    // the original listener is untouched and still serving
    const link = await connectLink(socketPath);
    expect(await double(link, 3)).toEqual({ y: 6 });
    await link.dispose();
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
      ...buildServed(),
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
    // yet `connect()` fails with EACCES because we strip the socket file's own
    // perms (connecting a unix socket needs write perm on it). The probe must
    // report unknown, not stale, so the socket survives the bind attempt.
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
        ...buildServed(),
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
      ...buildServed(),
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
      ...buildServed(),
    });
    expect(l.outcome).toMatchObject({ kind: "dir-not-private" });
    expect(existsSync(join(linkDir, "a.sock"))).toBe(false);
  });

  it("close() removes the socket file and is idempotent", async () => {
    const p = join(
      mkdtempSync(join(tmpdir(), "surface-usock-close-")),
      "a.sock",
    );
    const l = await serveOverUnixSocket({ socketPath: p, ...buildServed() });
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
    served: {
      group: ReturnType<typeof buildServed>["group"];
      handlers: SurfaceHandlers;
    } = buildServed(),
  ) => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), `surface-usock-${tag}-`)),
      "a.sock",
    );
    const listener = await serveOverUnixSocket({
      socketPath,
      ...served,
      log: silentLogger,
    });
    expect(listener.outcome).toEqual({ kind: "listening" });
    return { socketPath, listener };
  };

  it("a call that succeeded before close() is REFUSED after it — the established peer is destroyed", async () => {
    const { socketPath, listener } = await freshListener("drop");
    const link = await connectLink(socketPath);
    // Established and served: the peer is real, not merely accepted.
    expect(await double(link, 21)).toEqual({ y: 42 });

    listener.close();

    // Red on the pre-fix code: server.close() only stopped ACCEPTING — the
    // established connection kept serving and this call still resolved
    // { y: 42 } (the illegal state "a closed host still serving live peers",
    // made visible). The destroyed link now fails.
    await expect(double(link, 2)).rejects.toThrow();
    await link.dispose();
  });

  it("tears down an in-flight subscription handler — its stream finalizes with the peer", async () => {
    // A forever-stream whose finalizer flips a test-local flag: the serve runs
    // in-process, so handler teardown is directly observable. The path under
    // test is the ordered close — scope close → the accepted socket is
    // destroyed → that peer's in-flight handlers are interrupted → the
    // stream's finalizer runs.
    let finalized = false;
    const runtime = implementSurface(lifetimeSurface, {
      procedures: { sys: { ping: () => Effect.succeed("pong") } },
      streams: {
        tick: {
          source: () =>
            Stream.ensuring(
              Stream.concat(
                Stream.make({ n: 0 }),
                Stream.never as Stream.Stream<{ n: number }>,
              ),
              Effect.sync(() => {
                finalized = true;
              }),
            ),
        },
      },
    });
    const { socketPath, listener } = await freshListener("sub", {
      group: runtime.group,
      handlers: runtime.handlers,
    });

    const link = await unixSocketLink({
      group: lifetimeSurface.group,
      socketPath,
    });
    const seen: number[] = [];
    void Effect.runPromise(
      Stream.runForEach(
        link.dispatch.stream(LIFETIME_TICK_TAG, undefined) as Stream.Stream<
          { n: number },
          unknown
        >,
        (frame) =>
          Effect.sync(() => {
            seen.push(frame.n);
          }),
      ),
    ).catch(() => {});
    await expect.poll(() => seen.length, { timeout: 2_000 }).toBeGreaterThan(0);

    listener.close();

    // Red on the pre-fix code: the handler kept producing forever (nothing
    // ended the peer), so `finalized` never flipped.
    await expect.poll(() => finalized, { timeout: 2_000 }).toBe(true);
    await link.dispose();
    await runtime.close();
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

    // Red on the pre-fix code: nothing ever ended the wedged peer. The destroy
    // is unconditional — no drain negotiation with a peer that never spoke.
    await expect.poll(() => closed, { timeout: 2_000 }).toBe(true);
  });

  it("close() after a peer already left: doesn't throw, stays idempotent, still disconnects the remaining live peer", async () => {
    const { socketPath, listener } = await freshListener("shed");
    // Peer A is a raw connection so its lifecycle is directly observable —
    // both ends live in this process.
    const rawA = createConnection(socketPath);
    await once(rawA, "connect");
    const b = await connectLink(socketPath);
    expect(await double(b, 3)).toEqual({ y: 6 });

    // Peer A leaves on its own.
    const aGone = once(rawA, "close");
    rawA.destroy();
    await aGone;
    // Give the SERVER-side 'close' its event-loop turns (the client-side
    // 'close' fires first; the server socket sees EOF a turn or two later).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(() => listener.close()).not.toThrow();
    expect(() => listener.close()).not.toThrow(); // still idempotent

    // Peer B was disconnected by the close.
    await expect(double(b, 4)).rejects.toThrow();
    await b.dispose();
  });
});
