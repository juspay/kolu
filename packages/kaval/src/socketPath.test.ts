/**
 * Pins kolu's names on the rendezvous path — app dir `kolu`, file
 * `pty-host.sock` — for both anchors. The mechanism (override handling, the
 * XDG/`/tmp/<app>-$UID` split, and the `$TMPDIR`-independence regression
 * behind the macOS "no pty-host socket" bug) is pinned generically in
 * `@kolu/surface`'s `unix-socket.test.ts`; what would break kolu-server ↔
 * kaval-tui rendezvous from HERE is only a drift in these names.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverPtyHostSockets,
  getPtyHostSocketPath,
  KAVAL_NS_PREFIX,
  kavalNamespace,
  PTY_HOST_SOCK_FILE,
} from "./socketPath.ts";

/** Bind a real `net.Server` at `path`, leaving a genuine socket inode behind —
 *  discovery now requires the rendezvous file to be an actual socket, not just an
 *  existing file, so a plain `writeFileSync` stand-in would (correctly) be
 *  skipped. Returns the server so the caller can close it on teardown. */
function listenSocket(path: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(path, () => resolve(server));
  });
}

/** Close a seeded server, removing its socket inode. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("getPtyHostSocketPath", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
  });

  it("returns an explicit override verbatim", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath("/custom/x.sock")).toBe("/custom/x.sock");
  });

  it("anchors under $XDG_RUNTIME_DIR/kolu on systemd Linux", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath()).toBe("/run/user/1000/kolu/pty-host.sock");
  });

  it("falls back to the fixed per-user /tmp/kolu-$UID off systemd", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const uid = process.getuid?.() ?? "shared";
    expect(getPtyHostSocketPath()).toBe(`/tmp/kolu-${uid}/pty-host.sock`);
  });

  it("parameterizes the app dir (default kolu) so a standalone daemon owns its own namespace", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath(undefined, "kaval")).toBe(
      "/run/user/1000/kaval/pty-host.sock",
    );
    // default is unchanged
    expect(getPtyHostSocketPath()).toBe("/run/user/1000/kolu/pty-host.sock");
  });
});

describe("discoverPtyHostSockets", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  const servers: Server[] = [];
  afterEach(async () => {
    vi.restoreAllMocks(); // the off-XDG grammar test stubs process.getuid
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    await Promise.all(servers.splice(0).map((s) => closeServer(s)));
  });

  /** Bind a real socket at `<runtime>/<ns>/pty-host.sock` (real socket inodes,
   *  not plain files — discovery requires `isSocket()`), remembering each server
   *  for teardown. Each namespace dir is created `0o700` to mirror what the
   *  serving side does, so discovery's owner-only privacy check passes. */
  async function seed(namespaces: string[]): Promise<string> {
    const runtime = mkdtempSync(join(tmpdir(), "kdisc-"));
    for (const ns of namespaces) {
      mkdirSync(join(runtime, ns), { recursive: true, mode: 0o700 });
      servers.push(await listenSocket(join(runtime, ns, PTY_HOST_SOCK_FILE)));
    }
    return runtime;
  }

  it("finds per-port server namespaces and a bare standalone one", async () => {
    const runtime = await seed([
      "kaval-7681",
      "kaval-18331",
      "kaval",
      "unrelated",
    ]);
    process.env.XDG_RUNTIME_DIR = runtime;
    const found = discoverPtyHostSockets().sort();
    expect(found).toEqual(
      [
        join(runtime, "kaval", PTY_HOST_SOCK_FILE),
        join(runtime, "kaval-18331", PTY_HOST_SOCK_FILE),
        join(runtime, "kaval-7681", PTY_HOST_SOCK_FILE),
      ].sort(),
    );
  });

  it("ignores a namespace dir with no socket yet", async () => {
    const runtime = await seed(["kaval-7681"]);
    mkdirSync(join(runtime, "kaval-9999")); // dir but no pty-host.sock
    process.env.XDG_RUNTIME_DIR = runtime;
    expect(discoverPtyHostSockets()).toEqual([
      join(runtime, "kaval-7681", PTY_HOST_SOCK_FILE),
    ]);
  });

  it("returns [] when the runtime root is unreadable / absent", () => {
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kdisc-does-not-exist-xyz");
    expect(discoverPtyHostSockets()).toEqual([]);
  });

  // A namespace whose name matches but whose dir is NOT owner-only must be
  // skipped: discovery re-checks the same ownership boundary the serving side
  // enforces, because the off-XDG `/tmp/<ns>-$UID/` root is shared and the
  // `-$UID` in the NAME is not proof of ownership. We can't chown a dir to
  // another uid without root, so we make it fail the OTHER half of the check —
  // loosen its mode so group/other bits are set (mode 0o755) — and a real socket
  // inside it must still not be discovered.
  it.runIf(process.getuid)(
    "skips a name-matching namespace whose dir is not owner-only",
    async () => {
      const runtime = mkdtempSync(join(tmpdir(), "kdisc-priv-"));
      const okDir = join(runtime, "kaval-7681");
      const looseDir = join(runtime, "kaval-9000");
      mkdirSync(okDir, { mode: 0o700 }); // owner-only, like production
      mkdirSync(looseDir, { mode: 0o700 });
      const okServer = await listenSocket(join(okDir, PTY_HOST_SOCK_FILE));
      const looseServer = await listenSocket(
        join(looseDir, PTY_HOST_SOCK_FILE),
      );
      chmodSync(looseDir, 0o755); // group/other access — not owner-only
      process.env.XDG_RUNTIME_DIR = runtime;
      try {
        // Only the owner-only dir's socket is returned; the loose one is dropped
        // despite holding a real, name-matching socket.
        expect(discoverPtyHostSockets()).toEqual([
          join(okDir, PTY_HOST_SOCK_FILE),
        ]);
      } finally {
        await Promise.all([closeServer(okServer), closeServer(looseServer)]);
        rmSync(runtime, { recursive: true, force: true });
      }
    },
  );

  // The off-XDG `/tmp/<ns>-$UID/` branch is the historically buggy macOS/launchd
  // fallback (see socketPath.ts's module doc): the root is the SHARED `/tmp` and
  // the namespace dirs carry a `-$UID` suffix. The ONLY thing unique to this
  // branch is that `-$UID` name decoration — the traversal, privacy check, and
  // socket-inode check are the same code the XDG cases above already exercise.
  // And discovery does not re-spell that decoration: it reads the names back from
  // the same `getRuntimeSocketPath` builder construction uses, so the two cannot
  // drift by design.
  //
  // So we pin exactly that unique surface, WITHOUT touching the user's real
  // `/tmp/kaval-$UID` rendezvous dirs (a unit test that recursively removed those
  // would clobber a developer's running standalone daemon). Mock `getuid` to a
  // fixed fake uid and assert the builder both halves call decorates the off-XDG
  // path with `-$UID`, for the bare and the per-port namespace alike.
  describe.runIf(process.getuid)("off-XDG /tmp/<ns>-$UID name grammar", () => {
    const FAKE_UID = 424242;

    it("decorates the bare and per-port namespaces with -$UID off XDG", () => {
      delete process.env.XDG_RUNTIME_DIR;
      vi.spyOn(process, "getuid").mockReturnValue(FAKE_UID);
      // Bare standalone daemon → /tmp/kaval-<uid>/pty-host.sock.
      expect(getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX)).toBe(
        `/tmp/${KAVAL_NS_PREFIX}-${FAKE_UID}/${PTY_HOST_SOCK_FILE}`,
      );
      // Per-port server daemon → /tmp/kaval-<port>-<uid>/pty-host.sock. This is
      // the suffix discovery's portedRe must (and does, reading it back from the
      // same builder) accept.
      expect(getPtyHostSocketPath(undefined, kavalNamespace(7681))).toBe(
        `/tmp/${KAVAL_NS_PREFIX}-7681-${FAKE_UID}/${PTY_HOST_SOCK_FILE}`,
      );
    });
  });
});
