// @vitest-environment happy-dom
/** THE PORTS SECTION ON A BUSY DEV BOX — 250 listening sockets on one host.
 *
 *  The section's join reads FOUR collections at once, and three of them used
 *  to be walked on the join's own memo: the host's claimed listeners and its
 *  unclaimed binds (`length` leaf, an index leaf per socket and the fields
 *  each row contributes), and the host's open doors. `lsof -i` on a working
 *  machine routinely shows dozens to a couple of hundred listeners, so the
 *  join sat past Solid's 200-source `WIDE_SCOPE_DEPS` judge at about 70 of
 *  them. The same walk was quadratic in time as well: `listenerAt` re-scanned
 *  both of the host's lists once per port the join filed.
 *
 *  EVERY INPUT IS THE REAL STORE. The host reading arrives through a real
 *  `createSubscription` cell store fed by a hand-pushed stream; the doors
 *  through the forwards cell under its own `arrayKey: "key"`; the terminal's
 *  own ports through the real per-key `useCollection` view and the real
 *  `useTerminalMetadata` projection; and the printed ports from the real
 *  scanner writing the real index.
 *
 *  What the test pins is the GROUPING those edges exist for, row for row: this
 *  terminal's subtree ports and the server it printed that detached; every
 *  other listener with a story; the door whose relay listener must not appear
 *  as a second row; the foreign socket with no story, dropped; and the door
 *  onto nothing, last. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { HostKey } from "kolu-common/hostKey";
import type {
  HostListeners,
  KoluForward,
  PortInfo,
  TerminalId,
} from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  /** The active host's scope, as `useTerminalMetadata` reads it. */
  scope: undefined as unknown,
  /** The host's listener reading, pushed one scan pass at a time. */
  pushListeners: ((_reading: HostListeners) => {}) as (
    reading: HostListeners,
  ) => void,
  /** The forwards cell, pushed one whole frame at a time. */
  pushForwards: ((_rows: readonly KoluForward[]) => {}) as (
    rows: readonly KoluForward[],
  ) => void,
  /** The terminal store face, over the real metadata projection. */
  store: undefined as unknown,
}));

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

// `vi.mock` is hoisted above every static import in this file, so the factory
// cannot close over one: the stores it builds are reached through `await
// import` for that reason alone.
vi.mock("../wire", async () => {
  const { controllableStream } = await import("@kolu/surface/solid/testlib");
  const { createSubscription } = await import("@kolu/surface/solid");
  const { Effect } = await import("effect");
  const listeners = controllableStream<HostListeners>();
  const forwards = controllableStream<readonly KoluForward[]>();
  held.pushListeners = (reading) => listeners.push(reading);
  held.pushForwards = (rows) => forwards.push(rows);
  return {
    activeHost: () => ({ kind: "local" }) as HostKey,
    hostKeys: () => [{ kind: "local" }] as HostKey[],
    client: { hosts: { viewer: () => Effect.succeed({ host: null }) } },
    app: {
      cells: {
        forwards: {
          use: () => {
            const sub = createSubscription(forwards.source, {
              arrayKey: "key",
            });
            return { value: sub, sub };
          },
        },
      },
    },
    padiMap: {
      // The host's clock, which the metadata projection reprojects through.
      entry: () => ({ clock: { toLocal: (at: number) => at } }),
      useEntry: () => ({
        cells: {
          hostListeners: {
            use: () => {
              const sub = createSubscription(listeners.source);
              return { value: sub, sub };
            },
          },
        },
      }),
    },
  };
});
vi.mock("../hostScope/hostScopes", () => ({ activeScope: () => held.scope }));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => held.store,
}));
vi.mock("../kaval/useDaemonStatus", () => ({ isActiveHostLocal: () => true }));
vi.mock("../useMobile", () => ({ isTouch: () => false }));
vi.mock("./PortRow", () => ({
  PortRow: (props: {
    row: {
      kind: string;
      port: number;
      origin?: string;
      forward?: { key: string };
    };
  }) => (
    <div
      data-testid="port-row"
      data-port={props.row.port}
      data-origin={props.row.kind === "orphan" ? "orphan" : props.row.origin}
      data-door={props.row.forward?.key ?? ""}
    />
  ),
}));

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import {
  printingTerminal,
  runScans,
  stopScans,
} from "../terminal/printedPortsScan.testlib";
import { useTerminalMetadata } from "../terminal/useTerminalMetadata";
import PortsSection from "./PortsSection";

/** Listeners on the host — what `lsof -i` shows on a working dev box. */
const SOCKETS = 250;
const FIRST = 30_000;
const hostPortAt = (n: number): number => FIRST + n;

/** The inspected tile, its three splits, and a second tile beside it. */
const TILE = "t0" as TerminalId;
const PANES: TerminalId[] = ["t0", "t1", "t2", "t3", "t4"] as TerminalId[];
/** This tile's own subtree ports — one in the tile, one in a split. */
const IN_TILE = hostPortAt(1);
const IN_SPLIT = hostPortAt(2);
/** A server this tile PRINTED that no terminal's subtree holds — detached. */
const PRINTED_HERE = hostPortAt(100);
/** Where kolu's own relay listener for `THROUGH_DOOR` sits. The host sees it;
 *  the section must not render the door twice. */
const RELAY = hostPortAt(7);
const THROUGH_DOOR = hostPortAt(5);
/** Sockets nobody readable holds. One has a door, one was printed by another
 *  terminal, and one has no story at all. */
const FOREIGN_WITH_DOOR = 40_000;
const FOREIGN_PRINTED = 40_001;
const FOREIGN_SILENT = 40_002;
/** A door onto a port nothing is listening on. */
const ORPHAN = 50_000;

const claimedAt = (n: number): PortInfo & { heldByTerminal: boolean } => ({
  port: hostPortAt(n),
  name: "node",
  command: `node service-${n}.js`,
  scope: "any",
  family: "v4",
  // Only the inspected tile's own two listeners are held by a terminal; every
  // other one on this box detached from whatever started it.
  heldByTerminal: n === 1 || n === 2,
});

const reading = (ns: readonly number[]): HostListeners => ({
  status: "known",
  claimed: ns.map(claimedAt),
  unclaimed: {
    status: "known",
    list: [FOREIGN_WITH_DOOR, FOREIGN_PRINTED, FOREIGN_SILENT].map((port) => ({
      port,
      scope: "any" as const,
      family: "v4" as const,
    })),
  },
});

const door = (
  key: string,
  remotePort: number,
  localPort: number,
): KoluForward => ({
  key,
  host: { kind: "local" },
  remotePort,
  localPort,
  origin: "auto",
  createdAt: 0,
});

const DOORS: readonly KoluForward[] = [
  door("relayed", THROUGH_DOOR, RELAY),
  door("foreign", FOREIGN_WITH_DOOR, 50_500),
  door("onto-nothing", ORPHAN, 50_501),
];

const subtreePort = (port: number): PortInfo => ({
  port,
  name: "node",
  command: `node service-${port - FIRST}.js`,
  scope: "any",
  family: "v4",
});

/** A composed record as the wire serves one. `t0` is the inspected tile, `t1`
 *  to `t3` its splits and `t4` a tile beside it. */
const recordFor = (id: TerminalId): PadiTerminal =>
  ({
    state: "active",
    parentId: id === "t0" || id === "t4" ? null : TILE,
    cwd: `/srv/${id}`,
    git: { kind: "none" },
    lastActivityAt: 0,
    ports: {
      status: "known",
      list:
        id === "t0"
          ? [subtreePort(IN_TILE)]
          : id === "t1"
            ? [subtreePort(IN_SPLIT)]
            : [],
    },
  }) as unknown as PadiTerminal;

const ALL_SOCKETS = Array.from({ length: SOCKETS }, (_, n) => n);

/** What the section must file under "elsewhere on this host", in order: every
 *  listener with a story that is not this tile's and not kolu's own relay,
 *  sorted by port, then the door onto nothing. */
const elsewhereFor = (ns: readonly number[]): number[] => [
  ...[
    ...ns
      .map(hostPortAt)
      .filter(
        (port) =>
          port !== IN_TILE &&
          port !== IN_SPLIT &&
          port !== PRINTED_HERE &&
          port !== RELAY,
      ),
    FOREIGN_WITH_DOOR,
    FOREIGN_PRINTED,
  ].sort((a, b) => a - b),
  ORPHAN,
];

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let disposeStore: (() => void) | undefined;
afterEach(() => {
  stopScans();
  dispose?.();
  disposeStore?.();
  dispose = undefined;
  disposeStore = undefined;
  flush();
});

/** Rows under `testid`, as `[port, origin, door key]`. */
const rowsIn = (host: HTMLElement, testid: string): string[][] =>
  [
    ...(host
      .querySelector(`[data-testid="${testid}"]`)
      ?.querySelectorAll<HTMLElement>('[data-testid="port-row"]') ?? []),
  ].map((el) => [
    el.dataset.port as string,
    el.dataset.origin as string,
    el.dataset.door as string,
  ]);

/** Every row of the section, in published order. */
const allRows = (host: HTMLElement): string[][] =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="port-row"]')].map(
    (el) => [
      el.dataset.port as string,
      el.dataset.origin as string,
      el.dataset.door as string,
    ],
  );

it("groups 250 listening sockets with no wide memo", async () => {
  const mirror = hostWireMirror();
  const entry = mirror.entry as {
    collections: {
      terminals: { use: (options: { keys: () => TerminalId[] }) => unknown };
    };
  };
  takeSolidDiagnostics();
  const metadata = createRoot((disposeRoot) => {
    disposeStore = disposeRoot;
    held.scope = {
      wire: {
        terminals: entry.collections.terminals.use({ keys: () => [...PANES] }),
      },
      prefs: {
        activityWindow: () => "all" as const,
        setActivityWindow: () => {},
      },
    };
    return useTerminalMetadata({ list: () => PANES });
  });
  held.store = {
    terminalIds: metadata.terminalIds,
    getTilePaneIds: metadata.getTilePaneIds,
    getMetadata: metadata.getMetadata,
    activate: () => {},
  };
  for (const id of PANES) mirror.pushRecord(id, recordFor(id));
  metadata.getMetadata(TILE);

  // This tile printed a detached server's URL; the tile beside it printed the
  // foreign socket's, which is the only story that one has.
  printingTerminal(TILE)(PRINTED_HERE);
  printingTerminal("t4" as TerminalId)(FOREIGN_PRINTED);
  runScans();

  const host = document.createElement("div");
  dispose = render(() => <PortsSection terminalId={TILE} />, host);
  held.pushListeners(reading(ALL_SOCKETS));
  held.pushForwards(DOORS);
  await settle();
  flush();

  // ── From this terminal ──
  expect(rowsIn(host, "inspector-ports")).toEqual([
    [`${IN_TILE}`, "subtree", ""],
    [`${IN_SPLIT}`, "subtree", ""],
    [`${PRINTED_HERE}`, "printed", ""],
    // Folded, the elsewhere group shows only the rows holding a door.
    [`${THROUGH_DOOR}`, "host", "relayed"],
    [`${FOREIGN_WITH_DOOR}`, "host", "foreign"],
    [`${ORPHAN}`, "orphan", "onto-nothing"],
  ]);
  const expected = elsewhereFor(ALL_SOCKETS);
  expect(
    host.querySelector('[data-testid="inspector-ports-elsewhere"]')
      ?.textContent,
  ).toContain(`· ${expected.length}`);
  // The socket nobody holds and nobody can tell a story about is not a row.
  expect(allRows(host).map(([port]) => port)).not.toContain(
    `${FOREIGN_SILENT}`,
  );
  expect(diagnostics()).toEqual([]);

  // Unfolded, the whole of the host — in port order, the door onto nothing
  // last.
  host
    .querySelector<HTMLElement>(
      '[data-testid="inspector-ports-elsewhere-toggle"]',
    )
    ?.click();
  flush();
  expect(
    rowsIn(host, "inspector-ports-elsewhere").map(([port]) => Number(port)),
  ).toEqual(expected);
  expect(diagnostics()).toEqual([]);

  // The next scan pass loses one listener and finds another: exactly those two
  // rows move, and the groups keep their order.
  const next = [...ALL_SOCKETS.filter((n) => n !== 50), SOCKETS];
  held.pushListeners(reading(next));
  await settle();
  flush();
  expect(
    rowsIn(host, "inspector-ports-elsewhere").map(([port]) => Number(port)),
  ).toEqual(elsewhereFor(next));
  expect(rowsIn(host, "inspector-ports").slice(0, 3)).toEqual([
    [`${IN_TILE}`, "subtree", ""],
    [`${IN_SPLIT}`, "subtree", ""],
    [`${PRINTED_HERE}`, "printed", ""],
  ]);
  expect(diagnostics()).toEqual([]);
});
