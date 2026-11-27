// @vitest-environment happy-dom
/** "WHICH TERMINAL SERVES THIS?" AT FLEET SIZE — 250 panes on one host.
 *
 *  Its sibling `PortsSection.wideDeps.test.tsx` scales the HOST READING (250
 *  listening sockets) and stubs `PortRow`, so nothing there ever reads
 *  `props.serving`. This file scales the other axis — the PANES — and renders
 *  the REAL `PortRow`, because the serving join is only ever asked from inside
 *  a tracked scope: `<Show when={props.serving}>` is a memo per "elsewhere"
 *  row, and a MISS, the normal case for a socket this host's terminals do not
 *  hold, walks every pane before it answers.
 *
 *  EVERY INPUT IS THE REAL STORE: the pane records arrive through the real
 *  per-key `useCollection` view over the real subscription stores
 *  (`../hostScope/hostWireMirror.testlib.ts`) and the real `useTerminalMetadata`
 *  projection; the host reading and the doors through real `createSubscription`
 *  cells fed by hand-pushed streams.
 *
 *  The fleet is 50 tiles of five panes each in server order. The inspected tile
 *  is the first; two panes of OTHER tiles serve a listener, so the rows that
 *  name a terminal name a TILE the user can activate rather than the pane the
 *  scanner attributed the port to. */

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
  /** Every id a row's jump activated, newest last. */
  activated: [] as TerminalId[],
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

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { stopScans } from "../terminal/printedPortsScan.testlib";
import { useTerminalMetadata } from "../terminal/useTerminalMetadata";
import PortsSection from "./PortsSection";

const PANES = 250;
/** The tile itself and four splits. */
const PANES_PER_TILE = 5;

const ids = Array.from({ length: PANES }, (_, n) => `p${n}` as TerminalId);
const tileOf = (n: number): TerminalId =>
  ids[n - (n % PANES_PER_TILE)] as TerminalId;
const parentAt = (n: number): TerminalId | null =>
  n % PANES_PER_TILE === 0 ? null : tileOf(n);

/** The inspected tile — the first one. */
const TILE = ids[0] as TerminalId;

const FIRST = 30_000;
const portNumberAt = (n: number): number => FIRST + n;

/** The inspected tile's own subtree ports: one in the tile, one in a split.
 *  Neither names a terminal — you are looking at it. */
const IN_TILE = portNumberAt(0);
const IN_SPLIT = portNumberAt(2);
/** Listeners held by panes of OTHER tiles — the rows that name a terminal. */
const FAR_SPLIT = portNumberAt(13);
const FAR_TILE = portNumberAt(205);
/** A socket no terminal's subtree holds: it has a story (a command) but no
 *  terminal to jump to, so its row keeps the plain label. This is the MISS,
 *  and the miss is what walks every pane. */
const DETACHED = 40_002;

const portAt = (n: number): PortInfo => ({
  port: portNumberAt(n),
  name: "node",
  command: `node server.js --pane ${n}`,
  scope: "loopback",
  family: "v4",
});

/** Which pane serves which port — the tile's own two, a split of another tile
 *  and a tile serving its own. */
const servedBy = new Map<number, number>([
  [0, 0],
  [2, 2],
  [13, 13],
  [205, 205],
]);

/** A composed record as the wire serves one. */
const recordAt = (
  n: number,
  over: { ports?: readonly PortInfo[] } = {},
): PadiTerminal =>
  ({
    state: "active",
    parentId: parentAt(n),
    cwd: `/srv/pane-${n}`,
    git: { kind: "none" },
    lastActivityAt: n,
    ports: {
      status: "known",
      list: over.ports ?? (servedBy.has(n) ? [portAt(n)] : []),
    },
  }) as unknown as PadiTerminal;

const claimedAt = (port: number): PortInfo & { heldByTerminal: boolean } => ({
  port,
  name: "node",
  command: `node server.js --port ${port}`,
  scope: "any",
  family: "v4",
  // Only the inspected tile's own listeners read as held here; the rest of the
  // box detached from whatever started them.
  heldByTerminal: port === IN_TILE || port === IN_SPLIT,
});

const reading = (ports: readonly number[]): HostListeners => ({
  status: "known",
  claimed: ports.map(claimedAt),
  unclaimed: { status: "known", list: [] },
});

const LISTENING = [IN_TILE, IN_SPLIT, FAR_SPLIT, FAR_TILE, DETACHED];

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

/** Every rendered row as `[port, the terminal it names or ""]`. */
const rows = (host: HTMLElement): string[][] =>
  [
    ...host.querySelectorAll<HTMLElement>('[data-testid="inspector-port-row"]'),
  ].map((el) => [
    el.dataset.port as string,
    el.querySelector<HTMLElement>('[data-testid="terminal-jump"]')
      ?.textContent ?? "",
  ]);

const jump = (host: HTMLElement, port: number): void => {
  host
    .querySelector<HTMLElement>(
      `[data-testid="inspector-port-row"][data-port="${port}"] [data-testid="terminal-jump"]`,
    )
    ?.click();
};

it("names the serving terminal of each row over 250 panes with no wide memo", async () => {
  held.activated = [];
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
        terminals: entry.collections.terminals.use({ keys: () => [...ids] }),
      },
      prefs: {
        activityWindow: () => "all" as const,
        setActivityWindow: () => {},
      },
    };
    return useTerminalMetadata({ list: () => ids });
  });
  held.store = {
    terminalIds: metadata.terminalIds,
    getTilePaneIds: metadata.getTilePaneIds,
    getMetadata: metadata.getMetadata,
    activate: (id: TerminalId) => held.activated.push(id),
  };
  for (const [n, id] of ids.entries()) mirror.pushRecord(id, recordAt(n));
  // The projection is PULLED: reading one slot builds the table and opens
  // every key's subscription.
  metadata.getMetadata(TILE);

  const host = document.createElement("div");
  dispose = render(() => <PortsSection terminalId={TILE} />, host);
  held.pushListeners(reading(LISTENING));
  held.pushForwards([]);
  await settle();
  flush();

  // Unfold "elsewhere", which is where the serving question is asked: every
  // row there is served by some terminal OTHER than the one on screen, or by
  // none at all.
  host
    .querySelector<HTMLElement>(
      '[data-testid="inspector-ports-elsewhere-toggle"]',
    )
    ?.click();
  flush();

  // This tile's own two rows name nobody; the two held elsewhere name their
  // TILE, not the pane the scanner attributed the port to; the detached one
  // keeps its label.
  expect(rows(host)).toEqual([
    [`${IN_TILE}`, ""],
    [`${IN_SPLIT}`, ""],
    [`${FAR_SPLIT}`, "/srv/pane-10"],
    [`${FAR_TILE}`, "/srv/pane-205"],
    [`${DETACHED}`, ""],
  ]);
  jump(host, FAR_SPLIT);
  expect(held.activated).toEqual([ids[10]]);
  expect(diagnostics()).toEqual([]);

  // The far split hands its server to a sibling split of the same tile: the
  // row still names that tile, and nothing else on screen moves.
  mirror.pushRecord(ids[13] as TerminalId, recordAt(13, { ports: [] }));
  mirror.pushRecord(
    ids[14] as TerminalId,
    recordAt(14, { ports: [portAt(13)] }),
  );
  await settle();
  flush();
  expect(rows(host)).toEqual([
    [`${IN_TILE}`, ""],
    [`${IN_SPLIT}`, ""],
    [`${FAR_SPLIT}`, "/srv/pane-10"],
    [`${FAR_TILE}`, "/srv/pane-205"],
    [`${DETACHED}`, ""],
  ]);
  held.activated = [];
  jump(host, FAR_TILE);
  expect(held.activated).toEqual([ids[205]]);
  expect(diagnostics()).toEqual([]);
});
