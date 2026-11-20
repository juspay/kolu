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

function simulateNoUidPlatform(): void {
  process.getuid = undefined;
}
function restoreUid(): void {
  process.getuid = REAL_GETUID;
}

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
    vi.restoreAllMocks();
    restoreUid();
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    fakeSocketPaths.clear();
  });

  function seed(namespaces: string[]): string {
    const runtime = mkdtempSync(join(tmpdir(), "kdisc-"));
    for (const ns of namespaces) {
      mkdirSync(join(runtime, ns), { recursive: true, mode: 0o700 });
      seedSocket(join(runtime, ns, PTY_HOST_SOCK_FILE));
    }
    return runtime;
  }

  it("finds per-port server namespaces and a bare standalone one", async () => {
    simulateNoUidPlatform();
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
    simulateNoUidPlatform();
    const runtime = seed(["kaval-7681"]);
    mkdirSync(join(runtime, "kaval-9999"));
    process.env.XDG_RUNTIME_DIR = runtime;
    expect(discoverPtyHostSockets()).toEqual([
      join(runtime, "kaval-7681", PTY_HOST_SOCK_FILE),
    ]);
  });

  it("returns [] when the runtime root is unreadable / absent", () => {
    simulateNoUidPlatform();
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kdisc-does-not-exist-xyz");
    expect(discoverPtyHostSockets()).toEqual([]);
  });

  it.runIf(process.getuid)(
    "skips a name-matching namespace whose dir is not owner-only",
    async () => {
      const runtime = mkdtempSync(join(tmpdir(), "kdisc-priv-"));
      const okDir = join(runtime, "kaval-7681");
      const looseDir = join(runtime, "kaval-9000");
      mkdirSync(okDir, { mode: 0o700 });
      mkdirSync(looseDir, { mode: 0o700 });
      seedSocket(join(okDir, PTY_HOST_SOCK_FILE));
      seedSocket(join(looseDir, PTY_HOST_SOCK_FILE));
      chmodSync(looseDir, 0o755);
      process.env.XDG_RUNTIME_DIR = runtime;
      const found = new Set(discoverPtyHostSockets());
      expect(found.has(join(okDir, PTY_HOST_SOCK_FILE))).toBe(true);
      expect(found.has(join(looseDir, PTY_HOST_SOCK_FILE))).toBe(false);
      rmSync(runtime, { recursive: true, force: true });
    },
  );

  describe.runIf(process.getuid)("off-XDG /tmp/<ns>-$UID name grammar", () => {
    const FAKE_UID = 424242;

    it("decorates the bare and per-port namespaces with -$UID off XDG", () => {
      delete process.env.XDG_RUNTIME_DIR;
      vi.spyOn(process, "getuid").mockReturnValue(FAKE_UID);
      expect(getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX)).toBe(
        `/tmp/${KAVAL_NS_PREFIX}-${FAKE_UID}/${PTY_HOST_SOCK_FILE}`,
      );
      expect(legacyKavalSocketPath(7681)).toBe(
        `/tmp/${KAVAL_NS_PREFIX}-7681-${FAKE_UID}/${PTY_HOST_SOCK_FILE}`,
      );
    });
  });
});

describe.runIf(process.getuid)(
  "discoverKavalCandidates — scans the regime in force, and only that one",
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

    it("ignores a /tmp daemon while $XDG_RUNTIME_DIR is set, and finds it once it is not", async () => {
      const uid = process.getuid?.();
      if (uid === undefined) return;
      const tmpNs = `${KAVAL_NS_PREFIX}-de${process.pid.toString(16)}-${uid}`;
      const tmpDir = join("/tmp", tmpNs);
      mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
      dirs.push(tmpDir);
      const tmpSock = join(tmpDir, PTY_HOST_SOCK_FILE);
      seedSocket(tmpSock);

      const xdgRoot = mkdtempSync(join(tmpdir(), "kboth-xdg-"));
      dirs.push(xdgRoot);
      mkdirSync(join(xdgRoot, KAVAL_NS_PREFIX), {
        recursive: true,
        mode: 0o700,
      });
      const xdgSock = join(xdgRoot, KAVAL_NS_PREFIX, PTY_HOST_SOCK_FILE);
      seedSocket(xdgSock);

      process.env.XDG_RUNTIME_DIR = xdgRoot;
      const withXdg = new Set(discoverPtyHostSockets());
      expect(withXdg.has(xdgSock)).toBe(true);
      expect(withXdg.has(tmpSock)).toBe(false);

      delete process.env.XDG_RUNTIME_DIR;
      const offXdg = new Set(discoverPtyHostSockets());
      expect(offXdg.has(tmpSock)).toBe(true);
      expect(offXdg.has(xdgSock)).toBe(false);
    });
  },
);

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
    simulateNoUidPlatform();
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
    expect(byKind.get(join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE))).toBe(
      "port",
    );
    expect(
      byKind.get(join(runtime, `kaval-${digest}`, PTY_HOST_SOCK_FILE)),
    ).toBe("stateRoot");
  });

  it("reads the gate pid from kaval.pid beside the socket (null when absent)", async () => {
    simulateNoUidPlatform();
    const runtime = seed(["kaval-7692", "kaval"]);
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

describe("resolveRunningKavalSocket", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  const savedKavalSocket = process.env.KAVAL_SOCKET;
  beforeEach(() => {
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

  it("returns $KAVAL_SOCKET and does NOT consult discovery when it is set", async () => {
    simulateNoUidPlatform();
    const runtime = seed(["kaval", "kaval-7692"]);
    process.env.XDG_RUNTIME_DIR = runtime;
    expect(resolveRunningKavalSocket(undefined).kind).toBe("many");
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
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kresolve-none-xyz");
    expect(resolveRunningKavalSocket("/x/kaval.sock")).toEqual({
      kind: "explicit",
      socket: "/x/kaval.sock",
    });
  });

  it("discovers a single running kaval → one", async () => {
    simulateNoUidPlatform();
    const runtime = seed(["kaval-7692"]);
    process.env.XDG_RUNTIME_DIR = runtime;
    expect(resolveRunningKavalSocket(undefined)).toEqual({
      kind: "one",
      socket: join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE),
    });
  });

  it("falls back to the bare default → none when nothing is running", () => {
    simulateNoUidPlatform();
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kresolve-empty-xyz");
    expect(resolveRunningKavalSocket(undefined)).toEqual({
      kind: "none",
      socket: getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX),
    });
  });

  it("reports every candidate with an UNAMBIGUOUS namespace label → many", async () => {
    simulateNoUidPlatform();
    const runtime = seed(["kaval", "kaval-7692"]);
    process.env.XDG_RUNTIME_DIR = runtime;
    const resolved = resolveRunningKavalSocket(undefined);
    expect(resolved.kind).toBe("many");
    if (resolved.kind !== "many") throw new Error("unreachable");
    const byLabel = new Map(
      resolved.candidates.map((c) => [c.socket, c.label] as const),
    );
    expect(byLabel.get(join(runtime, "kaval", PTY_HOST_SOCK_FILE))).toBe(
      "standalone kaval",
    );
    expect(byLabel.get(join(runtime, "kaval-7692", PTY_HOST_SOCK_FILE))).toBe(
      "kolu-server on port 7692",
    );
  });

  it("labels a padi's kaval-<digest> from its state-root manifest, distinct from a legacy port", async () => {
    simulateNoUidPlatform();
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
