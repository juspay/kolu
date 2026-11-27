// @vitest-environment happy-dom
/** THE BOUND HOST'S DAEMON SCAN AT 250 DAEMONS.
 *
 *  `hostInventory` is a CELL: its frame is held in a `createStore`, so every
 *  field of every row the scan serves is its own store leaf. The two readings
 *  the dialogs take — "is any padi active?" (`boundHostScan`) and "which padi
 *  is kolu using?" (`activePadi`) — walked that served array, so each took a
 *  source per daemon on the SCOPE THAT CALLED IT (both are plain accessors; the
 *  cost is the caller's). A render effect or memo reading either on a machine
 *  running a few hundred daemons was therefore past Solid's 200-source
 *  `WIDE_SCOPE_DEPS` judge.
 *
 *  THE CELL IS THE REAL ONE: `createSubscription` over a controllable stream,
 *  exactly as `entry.cells.X.use()` builds it, so a frame costs what it costs
 *  in the browser. A plain record standing in for the store would measure
 *  nothing.
 *
 *  The reader under test is a memo, because the dialogs read these inside their
 *  own render scopes and that is where the sources land. */

import type { HostDaemonInventory } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { type ControllableStream, settle } from "@kolu/surface/solid/testlib";
import { createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  stream: undefined as ControllableStream<HostDaemonInventory> | undefined,
}));

vi.mock("../wire", async () => {
  // `vi.mock`'s factory is hoisted above this file's imports, so the real
  // subscription and the stream it reads can only be reached from inside it.
  // The cell is opened ONCE, when the module under test loads its app-scope
  // root — exactly as in the app — so the stream outlives any one test.
  const { createSubscription } = await import("@kolu/surface/solid");
  const { controllableStream } = await import("@kolu/surface/solid/testlib");
  const stream = controllableStream<HostDaemonInventory>();
  held.stream = stream;
  return {
    activeHost: () => ({ kind: "local" }),
    padiMap: {
      entry: () => ({ state: () => ({ kind: "connected" }) }),
      useEntry: () => ({
        cells: {
          hostInventory: {
            use: () => {
              const sub = createSubscription(stream.source);
              return { value: sub, sub };
            },
          },
        },
      }),
    },
  };
});

vi.mock("../kaval/useDaemonStatus", () => ({ daemonChannelLive: () => true }));

import {
  activePadi,
  boundHostKavals,
  boundHostPadis,
  boundHostScan,
} from "./useHostInventory";

const DAEMONS = 250;
/** The one padi kolu is bound to — late in the list, so a reading that
 *  short-circuits early could not pass by accident. */
const ACTIVE_AT = 200;

const inventory = (
  options: { activeAt?: number; socketOf?: (n: number) => string } = {},
): HostDaemonInventory =>
  ({
    kavals: Array.from({ length: DAEMONS }, (_, n) => ({
      socket: `/run/kaval-${n}.sock`,
      label: `kolu @ /state/${n}`,
      kind: "stateRoot" as const,
      gatePid: 1000 + n,
      terminalCount: n % 7,
      buildCommit: `commit-${n}`,
      contractVersion: "1",
      held:
        n === (options.activeAt ?? ACTIVE_AT)
          ? { active: true as const, atLegacyAddress: false }
          : { active: false as const },
    })),
    padis: Array.from({ length: DAEMONS }, (_, n) => ({
      socket: options.socketOf?.(n) ?? `/run/padi-${n}.sock`,
      stateRoot: `/state/${n}`,
      gatePid: 2000 + n,
      active: n === (options.activeAt ?? ACTIVE_AT),
    })),
  }) as unknown as HostDaemonInventory;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** The cell behind the module's app-scope root, opened when it loaded. */
const cell = (): ControllableStream<HostDaemonInventory> =>
  held.stream as ControllableStream<HostDaemonInventory>;

/** The dialogs' own reading, in one scope: the scan's liveness cause beside the
 *  bound padi's socket — which is how the Padi dialog reads them. */
async function readings() {
  takeSolidDiagnostics();
  const read = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createMemo(
      () => ({
        scan: boundHostScan().kind,
        socket: activePadi()?.socket ?? null,
        kavals: boundHostKavals().length,
        padis: boundHostPadis().length,
      }),
      { name: "padiDialog.readings" },
    );
  });
  cell().push(inventory());
  await settle();
  flush();
  return read;
}

it("reads a 250-daemon scan with no wide scope", async () => {
  const read = await readings();

  expect(read()).toEqual({
    scan: "live",
    socket: `/run/padi-${ACTIVE_AT}.sock`,
    kavals: DAEMONS,
    padis: DAEMONS,
  });
  expect(diagnostics()).toEqual([]);

  // The bound padi moves to another socket: the reading follows, and the scan
  // stays live.
  cell().push(inventory({ activeAt: 7 }));
  await settle();
  flush();
  expect(read()).toEqual({
    scan: "live",
    socket: "/run/padi-7.sock",
    kavals: DAEMONS,
    padis: DAEMONS,
  });
  expect(diagnostics()).toEqual([]);
});

it("holds an untouched daemon row still across a frame", async () => {
  await readings();
  const before = boundHostPadis();
  takeSolidDiagnostics();

  // One row's socket is rewritten; every other row is served identically.
  cell().push(
    inventory({
      socketOf: (n) =>
        n === 3 ? "/run/padi-moved.sock" : `/run/padi-${n}.sock`,
    }),
  );
  await settle();
  flush();

  const after = boundHostPadis();
  expect(after[3]?.socket).toBe("/run/padi-moved.sock");
  // The rows that did not move are the SAME objects, so a `<For>` over this
  // list rebuilds exactly the row that changed.
  for (const [n, row] of after.entries())
    if (n !== 3) expect(row).toBe(before[n]);
  expect(diagnostics()).toEqual([]);
});
