/**
 * THE INCIDENT TEST — juspay/kolu#2101, deploy #2 ("one 1500ms probe timeout
 * half-kills padi").
 *
 * The production shape, reproduced with padi's REAL probe machinery: a kaval that
 * accepts the dial and then never answers (a daemon mid-restore-stampede, 24
 * terminals spawning and several agents resuming), the real `probeKavalStatus`
 * deadline expiring on it, the real `enumerateHostDaemons` scan rejecting because
 * of it — all riding the real `derived.cell(source(...))` poll cell under a real
 * `implementSurface`, alongside a live attach-shaped stream being consumed.
 *
 * What it pins (the reviewer's mandated falsifier):
 *   - every live stream keeps flowing across the probe timeout;
 *   - `runtime.done` stays UNSETTLED — so a future genuine fault is still
 *     observable, the property the incident destroyed;
 *   - the cell serves its spec default meanwhile, and CONVERGES on the next tick.
 *
 * On pre-#2101 code the seed rejection propagated out of the poll connector and
 * `runtime.done` rejected with the incident's own line — `timed out after Nms` —
 * which padi's log-and-continue observer then turned into a zombie daemon.
 */

import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineSurface } from "@kolu/surface/define";
import { derived, source } from "@kolu/surface/reactor";
import { implementSurface } from "@kolu/surface/server";
import { Effect, Schema, Stream } from "effect";
import type { KavalDaemon } from "kaval";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enumerateHostDaemons,
  type KavalProbe,
  probeKavalStatus,
} from "./hostInventory.ts";
import {
  DEFAULT_PADI_HOST_INVENTORY,
  type PadiHostInventory,
  PadiHostInventorySchema,
} from "./surface.ts";

/** The probe deadline this test drives the real `probeKavalStatus` with. Small so
 *  the suite is fast; the MECHANISM under it is production's — the same
 *  `Effect.timeoutOrElse` arm that fired at 1500ms on the incident hosts, minting
 *  the same `timed out after Nms` failure. */
const PROBE_DEADLINE_MS = 40;

const settle = (ms = 25): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const servers: Array<{ server: Server; connections: Socket[] }> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      ({ server, connections }) =>
        new Promise<void>((resolve) => {
          // A probe that timed out MID-DIAL never got a link to dispose, so its
          // client socket is still attached — `close()` alone would wait on it
          // forever. Dropping the accepted connections first is the teardown that
          // matches what the test deliberately created.
          for (const c of connections) c.destroy();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A kaval socket that ACCEPTS and then never speaks — a wedged/overloaded daemon
 *  as the prober experiences it. (A socket with nobody listening is a different,
 *  already-handled case: `isNoListenerError` folds it to an empty probe.) */
async function hangingKavalSocket(): Promise<string> {
  const socketPath = join(
    mkdtempSync(join(tmpdir(), "padi-stampede-")),
    "pty-host.sock",
  );
  const connections: Socket[] = [];
  const server = createServer((c) => {
    // Accept, answer nothing — the stampede's slow kaval. Held only so teardown
    // can drop it.
    connections.push(c);
  });
  servers.push({ server, connections });
  await new Promise<void>((resolve) => {
    server.listen(socketPath, () => resolve());
  });
  return socketPath;
}

const HEALTHY_PROBE: KavalProbe = {
  terminalCount: 24,
  buildCommit: "abc1234",
  contractVersion: "5.0",
};

describe("hostInventory under a restore stampede (#2101)", () => {
  it("a timed-out kaval probe is CELL-LOCAL: streams keep flowing, `done` stays unsettled, the cell converges next tick", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const socket = await hangingKavalSocket();
      const wedged: KavalDaemon = {
        socket,
        label: "kolu @ /home/u/.local/state/padi",
        kind: "stateRoot",
        gatePid: 4242,
      };
      // The stampede window, then recovery — what a second kaval restart (the
      // incident's manual workaround) achieved, here without one.
      let stampeding = true;
      const scan = (): Effect.Effect<PadiHostInventory, unknown> =>
        enumerateHostDaemons({
          discoverKavals: () => [wedged],
          discoverPadis: () => [],
          // The REAL probe against the REAL wedged socket while the stampede is on.
          probe: (s) =>
            stampeding
              ? probeKavalStatus(s, PROBE_DEADLINE_MS)
              : Effect.succeed(HEALTHY_PROBE),
          activeKavalSocket: socket,
          activeKavalAtLegacy: false,
          activePadiSocket: null,
        });

      let tick!: () => void;
      const inventory = source({
        label: "hostInventory",
        read: () => Effect.runPromise(scan()),
        // The fused cadence's edge, driven by hand: production's is the 10s
        // interval OR a kaval-connect — which is precisely when the stampede peaks.
        install: (t) => {
          tick = t;
          return () => {};
        },
      });

      const surface = defineSurface({
        cells: {
          hostInventory: {
            schema: PadiHostInventorySchema,
            default: DEFAULT_PADI_HOST_INVENTORY,
            verbs: ["get"],
          },
        },
        events: {
          terminalAttach: {
            inputSchema: Schema.String,
            outputSchema: Schema.String,
          },
        },
      });
      const { ctx, handlers, done } = implementSurface(surface, {
        cells: { hostInventory: derived.cell(inventory) },
        events: { terminalAttach: {} },
      });
      // A passing test never awaits `done`; observe it anyway so a rejection is
      // recorded (and cannot float) instead of taking the whole run down.
      let doneRejection: unknown;
      done.catch((err: unknown) => {
        doneRejection = err;
      });

      // A live attach stream, consumed across the whole incident window.
      const attachHandler = handlers["surface/terminalAttach/get"];
      if (!attachHandler) throw new Error("no terminalAttach handler bound");
      const attachFrames = Effect.runPromise(
        Stream.runCollect(
          Stream.take(attachHandler("t1") as Stream.Stream<string>, 2),
        ),
      ) as unknown as Promise<string[]>;
      await settle();
      ctx.events.terminalAttach.publish("t1", "snapshot");

      // ── the stampede: the T+0 probe blows its deadline ───────────────────
      await settle(PROBE_DEADLINE_MS * 6);

      // 1. The runtime is ALIVE. (Pre-fix: `done` rejected with `timed out after
      //    Nms` — the incident's own log line — and padi became a zombie.)
      expect(doneRejection).toBeUndefined();
      // 2. The cell serves its honest default: no daemons invented from a failed
      //    scan (#1034), and the read failure is LOUD and names the cell.
      expect(ctx.cells.hostInventory.get()).toEqual(
        DEFAULT_PADI_HOST_INVENTORY,
      );
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0])).toContain("hostInventory");
      expect(String(spy.mock.calls[0]?.[1])).toContain("timed out after");
      // 3. The live attach stream never noticed. THIS is the frozen-pane class.
      ctx.events.terminalAttach.publish("t1", "delta");
      expect(await attachFrames).toEqual(["snapshot", "delta"]);

      // ── recovery: the next tick converges, with no restart ────────────────
      stampeding = false;
      tick();
      await settle(50);
      const converged = ctx.cells.hostInventory.get();
      expect(converged.kavals).toHaveLength(1);
      expect(converged.kavals[0]?.terminalCount).toBe(24);
      expect(converged.kavals[0]?.held).toEqual({
        active: true,
        atLegacyAddress: false,
      });
      expect(doneRejection).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  }, 20_000);
});
