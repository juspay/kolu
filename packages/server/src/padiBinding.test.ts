/**
 * The W2.2 CUTOVER acceptance gate — kolu-server's padi BINDER end-to-end.
 *
 * `ensurePadiBinding` spawns a REAL padi process from source (under a private
 * state-root + a shared temp `$XDG_RUNTIME_DIR`, `KOLU_KAVAL_SPAWN=detached`, the
 * nix-shell whitelist, and scrubbed `INVOCATION_ID`/`KOLU_STATE_DIR`/
 * `KOLU_PADI_BIN`), handshakes its frozen control core, and produces the
 * reconnect-mirror session `reServeSurface` consumes. This test proves:
 *
 *   1. **boot + re-serve + router splice** — the re-served `padiSurface`, spliced
 *      under the `padi` key of the host router (via `buildAppRouter`, the real
 *      assembly path), round-trips a terminal end-to-end: dial `/surface/padi/*`
 *      → `lifecycle.create` → `terminalAttach` (a snapshot frame) → `sendInput`
 *      → `screen.state` shows the echoed output. This is the empirical proof that
 *      the splice routes at `/surface/padi/<member>` with NO `surface/surface`
 *      double-prefix (gotcha 3).
 *   2. **reconnect** — kill the bound padi; the `PadiBindingSession` drives
 *      `adoptOrSpawnOrRefuse` again (re-adopts the surviving kaval, or spawns
 *      fresh), the pump rebinds a FRESH client, and the SAME re-served surface
 *      round-trips a terminal again.
 *
 * Every padi + its detached kaval is reaped (SIGKILL via the gate files).
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PADI_FORWARDING_POLICY, padiSurface } from "@kolu/padi/surface";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
} from "@kolu/padi/stateRoot";
import type { HostSession } from "@kolu/surface-nix-host";
import { reServeSurface } from "@kolu/surface-nix-host";
import { createRouterClient } from "@orpc/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensurePadiBinding, type PadiBindingSession } from "./padiBinding.ts";
import { buildAppRouter } from "./router.ts";

// tsx must resolve so the spawned padi (and its kaval) launch from source.
createRequire(import.meta.url).resolve("tsx");

// Isolate every padi under ONE temp runtime root: a distinct state-root (→ distinct
// digest) is the only thing separating two bindings. Saved + restored file-local.
const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "padi-bind-rt-"));
const prior: Record<string, string | undefined> = {};
const CLEARED = [
  "INVOCATION_ID", // force the driver's DETACHED path (no systemd-run)
  "KOLU_PADI_BIN", // force from-source launch
  "KOLU_STATE_DIR", // never run padi's one-shot legacy import against a real config
  "KOLU_PADI_SPAWN",
] as const;

beforeAll(() => {
  for (const k of ["XDG_RUNTIME_DIR", "KOLU_KAVAL_SPAWN", ...CLEARED] as const)
    prior[k] = process.env[k];
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
  process.env.KOLU_KAVAL_SPAWN = "detached"; // padi's kaval detaches (survives padi restarts)
  for (const k of CLEARED) delete process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const makeStateRoot = (): string =>
  mkdtempSync(join(tmpdir(), "padi-bind-sr-"));

/** The pid a gate file records (decimal text), or undefined if unreadable. */
function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

const activeSessions: PadiBindingSession[] = [];
const activeStateRoots = new Set<string>();

/** SIGKILL the CURRENT padi (its gate may point at a respawned one) AND its
 *  detached kaval, given a binding's state-root. */
function reap(stateRoot: string): void {
  const padiGate = padiGatePath(padiSocketPath(stateRoot));
  const kavalGate = join(dirname(padiKavalSocketPath(stateRoot)), "kaval.pid");
  for (const g of [padiGate, kavalGate]) {
    const pid = gatePid(g);
    if (pid !== undefined) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

afterEach(async () => {
  // Stop every reconnect loop BEFORE reaping, else the loop respawns padi after
  // we kill it. Then SIGKILL the current padi + its kaval.
  for (const s of activeSessions.splice(0)) s.destroy();
  await sleep(50);
  for (const sr of [...activeStateRoots]) reap(sr);
  activeStateRoots.clear();
});

/** Boot a binding + re-serve, and dial it through the REAL host-router splice
 *  (`buildAppRouter` → `directLink`), so calls land at `/surface/padi/<member>`. */
async function bootReServedPadi(stateRoot: string): Promise<{
  session: PadiBindingSession;
  // biome-ignore lint/suspicious/noExplicitAny: the dialed client is walked structurally in the round-trip helper.
  padi: any;
}> {
  activeStateRoots.add(stateRoot);
  const session = await ensurePadiBinding({
    stateRoot,
    nixShellWhitelist: "default", // the test runs inside the nix devshell
    reconnectDelayMs: 400, // snappy reconnect for the kill test
  });
  activeSessions.push(session);

  const reServed = reServeSurface({
    source: padiSurface,
    policy: PADI_FORWARDING_POLICY,
    session: session as unknown as HostSession<typeof padiSurface.contract>,
    log: () => {},
  });
  // Never let `done` float; a clean session.destroy() resolves it.
  void reServed.done.catch(() => {});

  // Splice the re-serve's inner surface under `padi`, then assemble the host router
  // exactly as `index.ts` does — proving the splice routes at `/surface/padi/*`.
  const surfaceRouter = {
    surface: {
      padi: (reServed.router as { surface: Record<string, unknown> }).surface,
    },
  };
  const appRouter = buildAppRouter({
    surfaceRouter,
    drainBoundPadi: () => session.drainBoundPadi(),
  });
  // `directLink` internally; drive the assembled router in-process and walk it
  // structurally (`surface.padi.<member>`).
  const client = createRouterClient(
    appRouter as Parameters<typeof createRouterClient>[0],
    // biome-ignore lint/suspicious/noExplicitAny: test dials the assembled router structurally (surface.padi.*).
  ) as any;
  return { session, padi: client.surface.padi };
}

/** Round-trip a fresh terminal THROUGH the re-served surface: create (retry until
 *  the pump has bound the live upstream), attach (a snapshot frame), drive it, and
 *  read the echo back off `screen.state`. */
// biome-ignore lint/suspicious/noExplicitAny: `padi` is the structurally-dialed re-served client.
async function roundTripTerminal(padi: any, mark: string): Promise<void> {
  // The pump binds `liveProcedures` a tick after the session reports connected;
  // a create in that gap throws "no live upstream link" — retry until it binds.
  let id: string | undefined;
  for (let i = 0; i < 200 && id === undefined; i++) {
    try {
      ({ id } = await padi.lifecycle.create({ cwd: makeStateRoot() }));
    } catch {
      await sleep(100);
    }
  }
  if (id === undefined)
    throw new Error("re-served lifecycle.create never bound");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  // terminalAttach is a DELTA member — its first frame is the snapshot, forwarded
  // 1:1 through the re-serve's fail-through relay.
  const attach = (await padi.terminalAttach.get({ id }))[
    Symbol.asyncIterator
  ]();
  const first = await attach.next();
  expect(typeof first.value).toBe("string");
  await attach.return?.();

  await padi.lifecycle.sendInput({ id, data: `echo ${mark}\r` });
  let screen = "";
  for (let i = 0; i < 160 && !screen.includes(mark); i++) {
    screen = await padi.screen.state({ id });
    if (!screen.includes(mark)) await sleep(50);
  }
  expect(screen).toContain(mark);
}

describe("kolu-server padi binder — cutover acceptance", () => {
  it("binds a spawned padi and the re-served surface round-trips a terminal", async () => {
    const { padi } = await bootReServedPadi(makeStateRoot());
    await roundTripTerminal(padi, "BINDMARK");
  }, 60000);

  it("reconnects when padi dies, and the re-served surface round-trips again", async () => {
    const stateRoot = makeStateRoot();
    const { padi } = await bootReServedPadi(stateRoot);
    await roundTripTerminal(padi, "FIRST");

    // Kill the bound padi (its detached kaval survives). The socket close flips the
    // endpoint to degraded → the session schedules `adoptOrSpawnOrRefuse` → a fresh
    // padi comes up (adopting the surviving kaval) → the pump rebinds.
    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();
    process.kill(padiPid as number, "SIGTERM");

    // The re-served surface round-trips a fresh terminal again once the binder has
    // re-established the link (roundTripTerminal retries create across the gap).
    await roundTripTerminal(padi, "SECOND");
  }, 90000);

  it("a kolu-server (binder) restart keeps padi's registry WARM — adopts, never respawns (done-criterion b)", async () => {
    const stateRoot = makeStateRoot();
    const first = await bootReServedPadi(stateRoot);

    // Create a terminal through the FIRST binding and drive it to a known mark.
    let id: string | undefined;
    for (let i = 0; i < 200 && id === undefined; i++) {
      try {
        ({ id } = await first.padi.lifecycle.create({ cwd: makeStateRoot() }));
      } catch {
        await sleep(100);
      }
    }
    if (id === undefined)
      throw new Error("re-served lifecycle.create never bound");
    await first.padi.lifecycle.sendInput({ id, data: "echo WARMMARK\r" });
    let screen = "";
    for (let i = 0; i < 160 && !screen.includes("WARMMARK"); i++) {
      screen = await first.padi.screen.state({ id });
      if (!screen.includes("WARMMARK")) await sleep(50);
    }
    expect(screen).toContain("WARMMARK");

    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();

    // Simulate a kolu-server RESTART: destroy the binder session (drop the link)
    // WITHOUT touching padi — padi is a detached process that outlives its binder,
    // holding the registry + live PTYs. This is the whole point of the split.
    first.session.destroy();
    await sleep(400);
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(isAlive(padiPid as number)).toBe(true); // padi survived the binder restart.

    // Re-bind at the SAME state-root — adopt-or-spawn-or-refuse ADOPTS the surviving
    // padi (same digest → same socket), never recycling it.
    const second = await bootReServedPadi(stateRoot);
    const padiPid2 = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid2).toBe(padiPid); // SAME process — adopted, not respawned.

    // The terminal created BEFORE the restart is still live with its screen intact,
    // read through the FRESH binding — the metadata survived warm in padi.
    let warm = "";
    for (let i = 0; i < 160 && !warm.includes("WARMMARK"); i++) {
      warm = await second.padi.screen.state({ id });
      if (!warm.includes("WARMMARK")) await sleep(50);
    }
    expect(warm).toContain("WARMMARK");
  }, 90000);
});
