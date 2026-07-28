/**
 * Pins kolu's names on the rendezvous path — app dir `kolu`, file
 * `pty-host.sock` — for both anchors. The mechanism (override handling, the
 * XDG/`/tmp/<app>-$UID` split, and the `$TMPDIR`-independence regression
 * behind the macOS "no pty-host socket" bug) is pinned generically in
 * `@kolu/surface`'s `unix-socket.test.ts`; what would break kolu-server ↔
 * kaval-tui rendezvous from HERE is only a drift in these names.
 */
import {
  chmodSync,
  type PathLike,
  type Stats,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeSocketPaths = vi.hoisted(() => new Set<string>());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync: (path: PathLike, options?: unknown): Stats => {
      if (fakeSocketPaths.has(String(path))) {
        return { isSocket: () => true } as Stats;
      }
      return (actual.lstatSync as (path: PathLike, options?: unknown) => Stats)(
        path,
        options,
      );
    },
  };
});

import {
  discoverKavalCandidates,
  discoverKavalDaemons,
  discoverPtyHostSockets,
  getPtyHostSocketPath,
  KAVAL_GATE_FILE,
  KAVAL_NS_PREFIX,
  legacyKavalSocketPath,
  PTY_HOST_SOCK_FILE,
  resolveRunningKavalSocket,
  writeStateRootManifest,
} from "./socketPath.ts";

const REAL_GETUID = process.getuid;

/** Simulate a platform without uid semantics (Windows) for the duration of a
 *  discovery test: `process.getuid` becomes undefined, so (a) discovery SKIPS its
 *  owner-only check (returning true, the documented no-uid behaviour) and (b) the
 *  `/tmp` fallback root's namespace grammar keys on `-shared` instead of `-$UID`.
 *
 *  Why: discovery now unions BOTH runtime roots, so it always also scans the real
 *  `/tmp`. A dev box can hold genuine off-XDG `/tmp/kaval-<hex>-$UID` daemons; with
 *  a real uid they'd match the grammar and leak into a test's results. Under the
 *  no-uid grammar those real daemons match neither the ownership nor the `-shared`
 *  suffix, so ONLY the test's own XDG-seeded dirs are found — the scan is HERMETIC
 *  without weakening the production ownership check (pinned separately, under a
 *  real uid, by "skips a name-matching namespace whose dir is not owner-only" and
 *  the both-roots regression). Restored in each describe's `afterEach`. */
function simulateNoUidPlatform(): void {
  process.getuid = undefined;
}
function restoreUid(): void {
  process.getuid = REAL_GETUID;
}

/** Seed the one filesystem fact discovery consumes: this exact rendezvous path
 * is a socket inode. Real listen/close behavior belongs to socketDaemon.test;
 * using net.Server here made pure traversal tests wait on the kernel. */
function seedSocket(path: string): void {
  fakeSocketPaths.add(path);
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

describe("legacyKavalSocketPath — the W2.2 upgrade adopt-hint (binder hints its OWN port)", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
  });

  it("legacy port path is instance-mode kaval-<port>/pty-host.sock with bare kaval.pid", async () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(legacyKavalSocketPath(7681)).toBe(
      "/run/user/1000/kaval-7681/pty-host.sock",
    );
    // Gate stem stays bare under instance mode (never kaval-7681.pid).
    const { resolveDaemonHome } = await import("@kolu/surface-daemon");
    expect(
      resolveDaemonHome({
        app: KAVAL_NS_PREFIX,
        placement: "runtime",
        instance: "7681",
        socketFile: PTY_HOST_SOCK_FILE,
      }).gatePath,
    ).toBe("/run/user/1000/kaval-7681/kaval.pid");
  });

  it("is a pure function of the port — a DIFFERENT listen port yields a DIFFERENT hint (a dev instance at another port is never adopted)", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(legacyKavalSocketPath(9999)).toBe(
      "/run/user/1000/kaval-9999/pty-host.sock",
    );
    expect(legacyKavalSocketPath(7681)).not.toBe(legacyKavalSocketPath(9999));
  });
});

describe("discoverPtyHostSockets", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    vi.restoreAllMocks(); // the off-XDG grammar test stubs process.getuid
    restoreUid(); // the hermetic tests below null process.getuid directly
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    fakeSocketPaths.clear();
  });

  /** Seed socket facts at `<runtime>/<ns>/pty-host.sock`. Each namespace dir is
   * created `0o700` to mirror the serving side's ownership boundary. */
  function seed(namespaces: string[]): string {
    const runtime = mkdtempSync(join(tmpdir(), "kdisc-"));
    for (const ns of namespaces) {
      mkdirSync(join(runtime, ns), { recursive: true, mode: 0o700 });
      seedSocket(join(runtime, ns, PTY_HOST_SOCK_FILE));
    }
    return runtime;
  }

  it("finds per-port server namespaces and a bare standalone one", async () => {
    simulateNoUidPlatform(); // hermetic: don't let real off-XDG /tmp daemons leak in
    const runtime = seed(["kaval-7681", "kaval-18331", "kaval", "unrelated"]);
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
    simulateNoUidPlatform(); // hermetic: don't let real off-XDG /tmp daemons leak in
    const runtime = seed(["kaval-7681"]);
    mkdirSync(join(runtime, "kaval-9999")); // dir but no pty-host.sock
    process.env.XDG_RUNTIME_DIR = runtime;
    expect(discoverPtyHostSockets()).toEqual([
      join(runtime, "kaval-7681", PTY_HOST_SOCK_FILE),
    ]);
  });

  it("returns [] when the runtime root is unreadable / absent", () => {
    // Both roots empty: the XDG root doesn't exist and (under the no-uid grammar)
    // the /tmp fallback matches nothing — so the union is genuinely empty.
    simulateNoUidPlatform();
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kdisc-does-not-exist-xyz");
    expect(discoverPtyHostSockets()).toEqual([]);
  });

  // A namespace whose name matches but whose dir is NOT owner-only must be
  // skipped: discovery re-checks the same ownership boundary the serving side
  // enforces, because the off-XDG `/tmp/<ns>-$UID/` root is shared and the
  // `-$UID` in the NAME is not proof of ownership. We can't chown a dir to
  // another uid without root, so we make it fail the OTHER half of the check —
  // loosen its mode so group/other bits are set (mode 0o755) — and a seeded
  // socket-inode fact inside it must still not be discovered.
  it.runIf(process.getuid)(
    "skips a name-matching namespace whose dir is not owner-only",
    async () => {
      const runtime = mkdtempSync(join(tmpdir(), "kdisc-priv-"));
      const okDir = join(runtime, "kaval-7681");
      const looseDir = join(runtime, "kaval-9000");
      mkdirSync(okDir, { mode: 0o700 }); // owner-only, like production
      mkdirSync(looseDir, { mode: 0o700 });
      seedSocket(join(okDir, PTY_HOST_SOCK_FILE));
      seedSocket(join(looseDir, PTY_HOST_SOCK_FILE));
      chmodSync(looseDir, 0o755); // group/other access — not owner-only
      process.env.XDG_RUNTIME_DIR = runtime;
      // The owner-only dir's socket is returned; the loose one is dropped
      // despite holding a name-matching socket. This runs under a REAL uid (it
      // pins the ownership check), so assert membership to tolerate a genuine
      // off-XDG daemon on the box.
      const found = new Set(discoverPtyHostSockets());
      expect(found.has(join(okDir, PTY_HOST_SOCK_FILE))).toBe(true);
      expect(found.has(join(looseDir, PTY_HOST_SOCK_FILE))).toBe(false);
      rmSync(runtime, { recursive: true, force: true });
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
      // same builder) accept. Spelled via instance mode (not pre-joined app).
      expect(legacyKavalSocketPath(7681)).toBe(
        `/tmp/${KAVAL_NS_PREFIX}-7681-${FAKE_UID}/${PTY_HOST_SOCK_FILE}`,
      );
    });
  });
});

// THE REGRESSION for the reported bug: `kaval-tui` and the Kaval dialog reported
// DIFFERENT daemon sets on the same box because discovery scanned only the ONE
// root the CALLER's own env pointed at. It must now union BOTH the XDG root and
// the fixed `/tmp` fallback, so a daemon in the /tmp drawer is visible to an
// XDG-set caller (the production dialog) too. Runs under a REAL uid — it seeds a
// genuine `/tmp/kaval-<hex>-$UID` daemon, the exact shape the fix must see — so it
// asserts MEMBERSHIP (tolerating any other daemon on the box), never exact set.
describe.runIf(process.getuid)(
  "discoverKavalCandidates — unions the XDG root AND the /tmp fallback",
  () => {
    const savedXdg = process.env.XDG_RUNTIME_DIR;
    const dirs: string[] = [];
    afterEach(() => {
      if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = savedXdg;
      fakeSocketPaths.clear();
      for (const d of dirs.splice(0))
        rmSync(d, { recursive: true, force: true });
    });

    it("finds a /tmp daemon EVEN with $XDG_RUNTIME_DIR set, and finds it whether or not XDG is set", async () => {
      const uid = process.getuid?.();
      if (uid === undefined) return; // guarded by describe.runIf; narrows the type
      // A daemon in the /tmp fallback drawer — the one an XDG-set caller was BLIND
      // to before the fix. Its namespace is unique to THIS test run (a hex pid
      // suffix) and ends in `-$UID`, so it matches the off-XDG grammar without ever
      // colliding with (or touching) a real `/tmp/kaval-*` daemon on the box.
      const tmpNs = `${KAVAL_NS_PREFIX}-de${process.pid.toString(16)}-${uid}`;
      const tmpDir = join("/tmp", tmpNs);
      mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
      dirs.push(tmpDir);
      const tmpSock = join(tmpDir, PTY_HOST_SOCK_FILE);
      seedSocket(tmpSock);

      // A daemon in the XDG drawer.
      const xdgRoot = mkdtempSync(join(tmpdir(), "kboth-xdg-"));
      dirs.push(xdgRoot);
      mkdirSync(join(xdgRoot, KAVAL_NS_PREFIX), {
        recursive: true,
        mode: 0o700,
      });
      const xdgSock = join(xdgRoot, KAVAL_NS_PREFIX, PTY_HOST_SOCK_FILE);
      seedSocket(xdgSock);

      // With XDG set, BOTH drawers are scanned — the /tmp daemon is no longer
      // invisible to an XDG-set caller (the exact production bug).
      process.env.XDG_RUNTIME_DIR = xdgRoot;
      const withXdg = new Set(discoverPtyHostSockets());
      expect(withXdg.has(tmpSock)).toBe(true);
      expect(withXdg.has(xdgSock)).toBe(true);

      // With XDG unset, the /tmp daemon is STILL found: the fallback root is
      // scanned unconditionally, so the /tmp drawer (the source of the leaked
      // pile) is visible regardless of the caller's env. That caller-independence
      // for the /tmp drawer is the regression this pins. (The XDG daemon's root is
      // $XDG itself, so it is unreachable with XDG unset — by construction.)
      delete process.env.XDG_RUNTIME_DIR;
      expect(new Set(discoverPtyHostSockets()).has(tmpSock)).toBe(true);
    });
  },
);

// The STRUCTURAL `kind` each candidate carries (decided at the matching branch, the
// inverse of `kavalNamespace`) + the gate-pid enrichment `discoverKavalDaemons` adds —
// the read-only enumeration the Kaval info dialog lists. Exercised over seeded
// socket-inode facts + real gate files, so the classification (esp. the LEGACY
// `port` leak signal) and the gate read are pinned without opening OS sockets.
describe("discoverKavalDaemons + candidate kind", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    restoreUid();
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    fakeSocketPaths.clear();
  });

  function seed(namespaces: string[]): string {
    const runtime = mkdtempSync(join(tmpdir(), "kkind-"));
    for (const ns of namespaces) {
      mkdirSync(join(runtime, ns), { recursive: true, mode: 0o700 });
      seedSocket(join(runtime, ns, PTY_HOST_SOCK_FILE));
    }
    return runtime;
  }

  it("classifies standalone / stateRoot (manifest) / legacy port by matching branch", async () => {
    simulateNoUidPlatform(); // hermetic: don't let real off-XDG /tmp daemons leak in
    const digest = "680023982235a767";
    const runtime = seed([`kaval-${digest}`, "kaval-7692", "kaval"]);
    writeStateRootManifest(
      join(runtime, `kaval-${digest}`),
      "/home/u/.local/state/padi",
    );
    process.env.XDG_RUNTIME_DIR = runtime;
    const byKind = new Map(
      discoverKavalCandidates().map((c) => [c.socket, c.kind] as const),
    );
    expect(byKind.get(join(runtime, "kaval", PTY_HOST_SOCK_FILE))).toBe(
      "standalone",
    );
    // The LEGACY pre-W2.2 keying — a kaval NOT owned by any padi, the leak signal.
    expect(byKind.get(join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE))).toBe(
      "port",
    );
    expect(
      byKind.get(join(runtime, `kaval-${digest}`, PTY_HOST_SOCK_FILE)),
    ).toBe("stateRoot");
  });

  it("reads the gate pid from kaval.pid beside the socket (null when absent)", async () => {
    simulateNoUidPlatform(); // hermetic: don't let real off-XDG /tmp daemons leak in
    const runtime = seed(["kaval-7692", "kaval"]);
    // Write a gate holding a pid for one, leave the other gate-less.
    writeFileSync(join(runtime, "kaval-7692", KAVAL_GATE_FILE), "4242\n");
    process.env.XDG_RUNTIME_DIR = runtime;
    const byGate = new Map(
      discoverKavalDaemons().map((d) => [d.socket, d.gatePid] as const),
    );
    expect(byGate.get(join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE))).toBe(
      4242,
    );
    expect(byGate.get(join(runtime, "kaval", PTY_HOST_SOCK_FILE))).toBeNull();
  });
});

// The selection policy (explicit wins; else discover; one→use it;
// many→ambiguous-with-labels; none→bare default) plus the candidate labels — the
// inverse of `kavalNamespace` — live here, beside the construction they decode,
// so both consumers (pulam's daemon, kaval-tui) only render their own
// many/none error surface. Discovery is exercised over seeded socket-inode
// facts, so the policy is pinned without waiting on kernel socket scheduling.
describe("resolveRunningKavalSocket", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  const savedKavalSocket = process.env.KAVAL_SOCKET;
  beforeEach(() => {
    // $KAVAL_SOCKET now takes precedence over discovery; clear it so the
    // discovery-path tests below aren't hijacked by an inherited value, and each
    // env-precedence test sets it explicitly.
    delete process.env.KAVAL_SOCKET;
  });
  afterEach(() => {
    restoreUid();
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    if (savedKavalSocket === undefined) delete process.env.KAVAL_SOCKET;
    else process.env.KAVAL_SOCKET = savedKavalSocket;
    fakeSocketPaths.clear();
  });

  function seed(namespaces: string[]): string {
    const runtime = mkdtempSync(join(tmpdir(), "kresolve-"));
    for (const ns of namespaces) {
      mkdirSync(join(runtime, ns), { recursive: true, mode: 0o700 });
      seedSocket(join(runtime, ns, PTY_HOST_SOCK_FILE));
    }
    return runtime;
  }

  // $KAVAL_SOCKET is stamped into every PTY a kaval/padi spawns; inside a kolu
  // terminal it names the exact daemon that owns you, so it must win over the
  // env-blind discovery scan (the ambiguous "more than one daemon" bug). These
  // pin the precedence chain --socket → $KAVAL_SOCKET → discover.
  it("returns $KAVAL_SOCKET and does NOT consult discovery when it is set", async () => {
    // Seed TWO daemons so discovery, IF consulted, would return `many`. With
    // $KAVAL_SOCKET set we get `env` instead — behavioural proof the env
    // short-circuits the scan (a `many` here would mean discovery ran).
    simulateNoUidPlatform(); // hermetic: only the seeded daemons count
    const runtime = seed(["kaval", "kaval-7692"]);
    process.env.XDG_RUNTIME_DIR = runtime;
    // Sanity: without the env var, this exact state IS ambiguous.
    expect(resolveRunningKavalSocket(undefined).kind).toBe("many");
    // With it, the scan is never reached.
    process.env.KAVAL_SOCKET = "/run/user/1000/kaval-abc123/pty-host.sock";
    expect(resolveRunningKavalSocket(undefined)).toEqual({
      kind: "env",
      socket: "/run/user/1000/kaval-abc123/pty-host.sock",
    });
  });

  it("an explicit --socket still overrides $KAVAL_SOCKET", () => {
    process.env.KAVAL_SOCKET = "/from/env.sock";
    expect(resolveRunningKavalSocket("/from/flag.sock")).toEqual({
      kind: "explicit",
      socket: "/from/flag.sock",
    });
  });

  it("returns an explicit socket verbatim, without discovery", () => {
    // No XDG root seeded — discovery would find nothing — yet the explicit path
    // is returned as-is, proving it short-circuits discovery.
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kresolve-none-xyz");
    expect(resolveRunningKavalSocket("/x/kaval.sock")).toEqual({
      kind: "explicit",
      socket: "/x/kaval.sock",
    });
  });

  it("discovers a single running kaval → one", async () => {
    simulateNoUidPlatform(); // hermetic: only the seeded daemon counts
    const runtime = seed(["kaval-7692"]);
    process.env.XDG_RUNTIME_DIR = runtime;
    expect(resolveRunningKavalSocket(undefined)).toEqual({
      kind: "one",
      socket: join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE),
    });
  });

  it("falls back to the bare default → none when nothing is running", () => {
    // Both roots empty under the no-uid grammar, so discovery is genuinely empty.
    simulateNoUidPlatform();
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kresolve-empty-xyz");
    expect(resolveRunningKavalSocket(undefined)).toEqual({
      kind: "none",
      socket: getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX),
    });
  });

  it("reports every candidate with an UNAMBIGUOUS namespace label → many", async () => {
    simulateNoUidPlatform(); // hermetic: only the seeded daemons count
    const runtime = seed(["kaval", "kaval-7692"]);
    process.env.XDG_RUNTIME_DIR = runtime;
    const resolved = resolveRunningKavalSocket(undefined);
    expect(resolved.kind).toBe("many");
    if (resolved.kind !== "many") throw new Error("unreachable");
    const byLabel = new Map(
      resolved.candidates.map((c) => [c.socket, c.label] as const),
    );
    // Under XDG the bare `kaval/` IS the standalone daemon and `kaval-7692/` IS a
    // kolu-server on port 7692 — discovery decides each at its matching branch,
    // so the port candidate is named outright, NOT hedged as "port 7692, or a
    // standalone kaval" (the basename-reparse confusion this fix removes).
    expect(byLabel.get(join(runtime, "kaval", PTY_HOST_SOCK_FILE))).toBe(
      "standalone kaval",
    );
    expect(byLabel.get(join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE))).toBe(
      "kolu-server on port 7692",
    );
  });

  it("labels a padi's kaval-<digest> from its state-root manifest, distinct from a legacy port", async () => {
    // A padi's kaval lives under `kaval-<digest>/` with a `state-root` manifest;
    // discovery labels it by that state-root (the digest carries no meaning). A
    // legacy in-process kolu-server's `kaval-<port>/` has NO manifest, so it keeps
    // the port label — manifest presence is the discriminant, so an all-decimal
    // digest could never masquerade as a port.
    simulateNoUidPlatform(); // hermetic: only the seeded daemons count
    const digest = "680023982235a767";
    const runtime = seed([`kaval-${digest}`, "kaval-7692"]);
    writeStateRootManifest(
      join(runtime, `kaval-${digest}`),
      "/home/u/.local/state/padi",
    );
    process.env.XDG_RUNTIME_DIR = runtime;
    const resolved = resolveRunningKavalSocket(undefined);
    expect(resolved.kind).toBe("many");
    if (resolved.kind !== "many") throw new Error("unreachable");
    const byLabel = new Map(
      resolved.candidates.map((c) => [c.socket, c.label] as const),
    );
    expect(
      byLabel.get(join(runtime, `kaval-${digest}`, PTY_HOST_SOCK_FILE)),
    ).toBe("kolu @ /home/u/.local/state/padi");
    expect(byLabel.get(join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE))).toBe(
      "kolu-server on port 7692",
    );
  });
});
