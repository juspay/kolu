/**
 * The W4 warm host pool — `?host` dispatch, `recentHosts` persistence, and the
 * `hosts.add`/`hosts.remove` control plane. Drives the REAL `buildHostRegistry`
 * (the framework map) through `buildHostPool`, mocking only the leaf binders +
 * re-serve so no socket/ssh/router is stood up.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// A minimal `PadiSession` — only `destroy` (the registry's `DestroyableSession`
// slot) and `renew` (drainBoundPadi) are ever touched here.
function fakeSession() {
  return { destroy: vi.fn(), renew: vi.fn(async () => {}) };
}

const ensurePadiBinding = vi.fn(() => fakeSession());
const ensureRemotePadiBinding = vi.fn(() => fakeSession());
const buildAppRouter = vi.fn(() => ({ router: true }));
const surfaceClientRef = vi.fn(() => ({ surface: {} }));

vi.mock("./padiBinding.ts", () => ({ ensurePadiBinding }));
vi.mock("./remotePadiBinding.ts", () => ({ ensureRemotePadiBinding }));
vi.mock("./router.ts", () => ({ buildAppRouter }));
vi.mock("@kolu/surface/project", () => ({ surfaceClientRef }));
vi.mock("@kolu/padi/surface", () => ({
  PADI_FORWARDING_POLICY: {},
  padiSurface: { spec: {} },
  // `hostPool.ts` now imports `LOCAL_HOST` from `kolu-common/contract`, whose eval
  // chain reaches `kolu-common/surface` — it references this schema as a cell field.
  // A minimal ZodType is enough here (the pool never validates against it).
  HostDaemonInventorySchema: z.unknown(),
}));
vi.mock("@orpc/server/ws", () => ({
  // The handler is opaque to the pool — a distinct object per host is enough to
  // assert `getHandler` returns the right one.
  RPCHandler: vi.fn(function (this: { router: unknown }, router: unknown) {
    this.router = router;
  }),
}));
vi.mock("./log.ts", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));
// Keep the REAL `buildHostRegistry` (the framework map under test) and mock only
// `reServeSurface`. `done` is normally never-settling (so the fail-loud `.catch`
// stays dormant), but each call's rejecter is captured in `reServeRejecters` (in
// buildEntry order) so a C2 test can fault ONE host's pump and assert containment.
const reServeRejecters: Array<(err: Error) => void> = [];
/** Fault the re-serve pump of the Nth built host entry (buildEntry order). */
function faultPump(index: number, err: Error): void {
  const reject = reServeRejecters[index];
  if (!reject) throw new Error(`test setup: no re-serve pump #${index}`);
  reject(err);
}
vi.mock("@kolu/surface-nix-host", async (importActual) => {
  const actual = await importActual<typeof import("@kolu/surface-nix-host")>();
  return {
    ...actual,
    reServeSurface: vi.fn(() => {
      let reject!: (err: Error) => void;
      const done = new Promise<void>((_resolve, rej) => {
        reject = rej;
      });
      reServeRejecters.push(reject);
      return { surface: {}, router: { surface: {} }, done };
    }),
  };
});

const { buildHostPool, LOCAL_HOST, UnremovableHostError } = await import(
  "./hostPool.ts"
);

function makePool(opts?: {
  bootHost?: string;
  recentHosts?: string[];
  persistRecentHosts?: (hosts: string[]) => void;
}) {
  return buildHostPool({
    bootHost: opts?.bootHost,
    recentHosts: opts?.recentHosts ?? [],
    persistRecentHosts: opts?.persistRecentHosts ?? (() => {}),
    localArmOpts: {},
    remoteSpawnVersion: "1.0.0",
    koluSurfaceRouter: { surface: { kolu: {} } },
    buildHostKoluCells: () => ({
      processStartedAt: {},
      daemonInventory: {},
      dispose: () => {},
    }),
    rpcPlugins: [],
  });
}

beforeEach(() => {
  ensurePadiBinding.mockClear();
  ensureRemotePadiBinding.mockClear();
  buildAppRouter.mockClear();
  reServeRejecters.length = 0;
});

describe("buildHostPool — the warm pool", () => {
  it("seeds LOCAL + the boot default + every recent host, deduped", () => {
    const pool = makePool({
      bootHost: "zest",
      recentHosts: ["zest", "oldbox"],
    });
    expect(pool.defaultHost).toBe("zest");
    // local (endpoint arm) + zest + oldbox — zest de-duped between bootHost and recents.
    expect(ensurePadiBinding).toHaveBeenCalledTimes(1); // only the local arm
    expect(ensureRemotePadiBinding).toHaveBeenCalledTimes(2); // zest + oldbox
    expect(pool.registry.hosts().sort()).toEqual(["local", "oldbox", "zest"]);
  });

  it("dispatches getHandler by host; an unknown host is undefined (upgrade rejects it)", () => {
    const pool = makePool({ bootHost: "zest" });
    expect(pool.registry.getHandler(LOCAL_HOST)).toBeDefined();
    expect(pool.registry.getHandler("zest")).toBeDefined();
    // Distinct handler per host — a call minted on one host's socket can't cross.
    expect(pool.registry.getHandler(LOCAL_HOST)).not.toBe(
      pool.registry.getHandler("zest"),
    );
    expect(pool.registry.getHandler("never-added")).toBeUndefined();
  });

  it("defaults to the local host when no bootHost is set", () => {
    const pool = makePool();
    expect(pool.defaultHost).toBe(LOCAL_HOST);
    expect(pool.registry.hosts()).toEqual([LOCAL_HOST]);
  });

  it("hosts.add warms a NEW host and persists it onto recentHosts (local excluded)", async () => {
    const persisted: string[][] = [];
    const pool = makePool({ persistRecentHosts: (h) => persisted.push(h) });
    await pool.hosts.add("newbox");
    expect(pool.registry.has("newbox")).toBe(true);
    expect(ensureRemotePadiBinding).toHaveBeenCalledWith(
      expect.objectContaining({ host: "newbox" }),
    );
    // recentHosts = the pool's host set MINUS the always-present local host.
    expect(persisted.at(-1)).toEqual(["newbox"]);
  });

  it("hosts.add is idempotent and never adds the local host", async () => {
    const persisted: string[][] = [];
    const pool = makePool({ persistRecentHosts: (h) => persisted.push(h) });
    await pool.hosts.add("dup");
    const remoteCalls = ensureRemotePadiBinding.mock.calls.length;
    await pool.hosts.add("dup"); // already warm — no-op
    await pool.hosts.add(LOCAL_HOST); // local is always present — no-op
    expect(ensureRemotePadiBinding.mock.calls.length).toBe(remoteCalls);
    expect(persisted.length).toBe(1); // only the first, real add persisted
  });

  it("serializes CONCURRENT adds of the same new host (no double-provision)", async () => {
    const pool = makePool();
    // Two devices add the same brand-new host at nearly the same moment. Without the
    // in-flight fence both pass the `has()` check (neither committed yet) and each
    // dials a live session — the loser's session/pump is then orphaned (never
    // destroyed), and its fail-loud pump can crash the server. The fence makes the
    // second call JOIN the first, so exactly one session is provisioned.
    await Promise.all([pool.hosts.add("race"), pool.hosts.add("race")]);
    const raceProvisions = ensureRemotePadiBinding.mock.calls.filter(
      (c) => ((c as unknown[])[0] as { host: string })?.host === "race",
    ).length;
    expect(raceProvisions).toBe(1);
    expect(pool.registry.has("race")).toBe(true);
  });

  it("hosts.remove forgets a host and re-persists recentHosts", async () => {
    const persisted: string[][] = [];
    const pool = makePool({
      recentHosts: ["a", "b"],
      persistRecentHosts: (h) => persisted.push(h),
    });
    const aSession = pool.registry.getSession("a");
    await pool.hosts.remove("a");
    expect(pool.registry.has("a")).toBe(false);
    expect(aSession?.destroy).toHaveBeenCalled();
    expect(persisted.at(-1)).toEqual(["b"]);
    // The local host can never be removed — `hosts.remove` REJECTS loudly (not the old
    // silent no-op), so a raw RPC fails honestly and the client toasts it.
    await expect(pool.hosts.remove(LOCAL_HOST)).rejects.toBeInstanceOf(
      UnremovableHostError,
    );
    expect(pool.registry.has(LOCAL_HOST)).toBe(true);
  });

  it("REJECTS removing the DEFAULT host — even a REMOTE one (A3 brick guard: loud, not a silent no-op)", async () => {
    // KOLU_PADI_HOST may be remote, and its session backs the HTTP `/rpc` handler +
    // the samplers. Removing it (via the picker's forget list OR the raw RPC) would
    // brick the server — so `hosts.remove(default)` REJECTS with a typed
    // `UnremovableHostError` (the client toasts it), never the old silent success.
    const pool = makePool({ bootHost: "zest", recentHosts: ["zest"] });
    expect(pool.defaultHost).toBe("zest");
    const zestSession = pool.registry.getSession("zest");
    await expect(pool.hosts.remove("zest")).rejects.toThrow(
      /cannot remove host "zest": it is the server's default host/,
    );
    expect(pool.registry.has("zest")).toBe(true); // still warm — not bricked
    expect(zestSession?.destroy).not.toHaveBeenCalled();
  });

  it("getSession(defaultHost) stays REFERENCE-IDENTICAL across a renew() — the boot-captured sampler session is sound ONLY because the default is unremovable (1b(ii))", async () => {
    const pool = makePool({ bootHost: "zest", recentHosts: ["zest"] });
    // index.ts captures this ONCE at boot + subscribes to its `onState`.
    const captured = pool.registry.getSession(pool.defaultHost);
    expect(captured).toBeDefined();
    // A "restart" drains + respawns padi IN-PLACE — `renew()` never replaces the
    // session object (padi's PTYs survive in kaval).
    await captured?.renew();
    // So the registry still hands back the SAME object — the captured ref can't go
    // stale. This pin is the tripwire: if anyone ever makes the default removable (and
    // the remove-rejects pins above are relaxed), the boot-capture could drift, and THIS
    // reference-identity assertion fails loudly first.
    expect(pool.registry.getSession(pool.defaultHost)).toBe(captured);
  });

  it("a GUEST host's pump fault RETIRES the binding — never exits the whole server (C2)", async () => {
    // initialHosts = [local, "g"] → reServeRejecters[0]=local, [1]="g".
    const pool = makePool({ recentHosts: ["g"] });
    const gSession = pool.registry.getSession("g");
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    // Fault the GUEST's re-serve pump.
    faultPump(1, new Error("adopt-loudly: divergent same-contract build"));
    await new Promise((r) => setTimeout(r, 0)); // let the .catch + hosts.remove settle
    await new Promise((r) => setTimeout(r, 0));
    expect(exitSpy).not.toHaveBeenCalled(); // NO global exit for a guest's fault
    expect(pool.registry.has("g")).toBe(false); // retired from the pool
    expect(gSession?.destroy).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("the DEFAULT host's pump fault is FATAL — fail-fast (C2)", async () => {
    const pool = makePool(); // defaultHost = local
    expect(pool.defaultHost).toBe(LOCAL_HOST);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    faultPump(0, new Error("default pump died")); // the default/local binding
    await new Promise((r) => setTimeout(r, 0));
    expect(exitSpy).toHaveBeenCalledWith(1); // load-bearing — the server can't serve without it
    exitSpy.mockRestore();
  });

  it("the LOCAL host's pump fault, when local is NOT the default, is LOGGED + LEFT — never a remove-reject, never a global exit (structural)", async () => {
    // bootHost="zest" → default=zest → initialHosts=[local, zest] → rejecters[0]=local.
    const pool = makePool({ bootHost: "zest", recentHosts: ["zest"] });
    expect(pool.defaultHost).toBe("zest");
    const localSession = pool.registry.getSession(LOCAL_HOST);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    // Fault the LOCAL (non-default) re-serve pump.
    faultPump(0, new Error("local endpoint terminally faulted"));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(exitSpy).not.toHaveBeenCalled(); // NOT fatal — a remote default still serves
    expect(pool.registry.has(LOCAL_HOST)).toBe(true); // left in place (structural)
    expect(localSession?.destroy).not.toHaveBeenCalled(); // not retired — no remove(local)
    exitSpy.mockRestore();
  });
});
