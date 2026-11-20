import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PADI_HOST_INVENTORY,
  type PadiHostInventory,
  PadiHostInventorySchema,
} from "@kolu/padi-client/surface";
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

const PROBE_DEADLINE_MS = 40;

const settle = (ms = 25): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const servers: Array<{ server: Server; connections: Socket[] }> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      ({ server, connections }) =>
        new Promise<void>((resolve) => {
          for (const c of connections) c.destroy();
          server.close(() => resolve());
        }),
    ),
  );
});

async function hangingKavalSocket(): Promise<string> {
  const socketPath = join(
    mkdtempSync(join(tmpdir(), "padi-stampede-")),
    "pty-host.sock",
  );
  const connections: Socket[] = [];
  const server = createServer((c) => {
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
      let stampeding = true;
      const scan = (): Effect.Effect<PadiHostInventory, unknown> =>
        enumerateHostDaemons({
          discoverKavals: () => [wedged],
          discoverPadis: () => [],
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
      let doneRejection: unknown;
      done.catch((err: unknown) => {
        doneRejection = err;
      });

      const attachHandler = handlers["surface/terminalAttach/get"];
      if (!attachHandler) throw new Error("no terminalAttach handler bound");
      const attachFrames = Effect.runPromise(
        Stream.runCollect(
          Stream.take(attachHandler("t1") as Stream.Stream<string>, 2),
        ),
      ) as unknown as Promise<string[]>;
      await settle();
      ctx.events.terminalAttach.publish("t1", "snapshot");

      await settle(PROBE_DEADLINE_MS * 6);

      expect(doneRejection).toBeUndefined();
      expect(ctx.cells.hostInventory.get()).toEqual(
        DEFAULT_PADI_HOST_INVENTORY,
      );
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0])).toContain("hostInventory");
      expect(String(spy.mock.calls[0]?.[1])).toContain("timed out after");
      ctx.events.terminalAttach.publish("t1", "delta");
      expect(await attachFrames).toEqual(["snapshot", "delta"]);

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
