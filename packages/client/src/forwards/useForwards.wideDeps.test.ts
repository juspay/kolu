/** THE FORWARD LIST AT FLEET SIZE — 250 open doors on one cell.
 *
 *  Every surface that shows a forward reads one of two derivations here, and
 *  both used to walk the whole list on one memo: the per-host slice filtered
 *  the cell's array by `encodeHostKey(f.host)` and the door-port set mapped
 *  `f.localPort` over it. A store array costs its `length` leaf plus an index
 *  leaf per row plus whatever the callback reads off each row, so a fleet of
 *  doors put four sources a door on each of those scopes — which Solid's
 *  development build judges `WIDE_SCOPE_DEPS` past 200 sources.
 *
 *  THE CELL IS THE REAL ONE: a real `createSubscription` store fed by a
 *  hand-pushed stream, under the member's own `arrayKey: "key"` — so a frame
 *  MERGES its rows by key exactly as the wire's does, row proxies keep their
 *  identity across frames, and reading one row costs what it costs in the
 *  browser.
 *
 *  The doors are spread over three hosts in a repeating cycle, so each host's
 *  published slice is a strict subset in a non-trivial order. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { HostKey } from "kolu-common/hostKey";
import type { KoluForward } from "kolu-common/surface";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  /** The host pool the forwards are spread over. Hoisted because the `../wire`
   *  mock answers `hostKeys` with it, and that mock is evaluated while this
   *  file's own imports are still being initialized. */
  hosts: [
    { kind: "local" },
    { kind: "remote", target: "zest" },
    { kind: "remote", target: "pu-dev" },
  ] as const,
  /** The forwards cell's stream, pushed one whole frame at a time. */
  push: ((_rows: readonly KoluForward[]) => {}) as (
    rows: readonly KoluForward[],
  ) => void,
}));

// `vi.mock` is hoisted above every static import in this file, so the factory
// cannot close over one: the harness it builds the real cell from is reached
// through `await import` for that reason alone.
vi.mock("../wire", async () => {
  const { controllableStream } = await import("@kolu/surface/solid/testlib");
  const { createSubscription } = await import("@kolu/surface/solid");
  const { Effect } = await import("effect");
  const stream = controllableStream<readonly KoluForward[]>();
  held.push = (rows) => stream.push(rows);
  return {
    hostKeys: () => held.hosts,
    client: { hosts: { viewer: () => Effect.succeed({ host: null }) } },
    app: {
      cells: {
        forwards: {
          // The member's OWN identity declaration, so the store under test
          // merges rows the way the client's does. A cell's `.use()` hands
          // back the subscription as its own `value` accessor.
          use: () => {
            const sub = createSubscription(stream.source, { arrayKey: "key" });
            return { value: sub, sub };
          },
        },
      },
    },
  };
});

import { doorLocalPorts, forwardsForHost } from "./useForwards";

const HOSTS = held.hosts as readonly HostKey[];
const DOORS = 250;

/** One door, as the forward map publishes it. `host` cycles through the pool,
 *  so a host's slice is every third row. */
const doorAt = (
  n: number,
  over: { remotePort?: number } = {},
): KoluForward => ({
  key: `door-${n}`,
  host: HOSTS[n % HOSTS.length] as HostKey,
  remotePort: over.remotePort ?? 30_000 + n,
  localPort: 40_000 + n,
  origin: "auto",
  createdAt: n,
});

const frame = (ns: readonly number[]): readonly KoluForward[] =>
  ns.map((n) => doorAt(n));

const ALL = Array.from({ length: DOORS }, (_, n) => n);
const keysOn = (at: number): string[] =>
  ALL.filter((n) => n % HOSTS.length === at).map((n) => `door-${n}`);

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

afterEach(() => {
  // Leave the cell empty for the next case: the subscription is the module's
  // own, held for the lifetime of the page.
  held.push([]);
  flush();
});

it("slices 250 doors by host and folds their local ports with no wide memo", async () => {
  takeSolidDiagnostics();
  held.push(frame(ALL));
  await settle();
  flush();

  expect(forwardsForHost(HOSTS[0] as HostKey).map((f) => f.key)).toEqual(
    keysOn(0),
  );
  expect(forwardsForHost(HOSTS[1] as HostKey).map((f) => f.key)).toEqual(
    keysOn(1),
  );
  expect(forwardsForHost(HOSTS[2] as HostKey).map((f) => f.key)).toEqual(
    keysOn(2),
  );
  expect([...doorLocalPorts()].sort((a, b) => a - b)).toEqual(
    ALL.map((n) => 40_000 + n),
  );
  expect(diagnostics()).toEqual([]);

  // One door is taken down and another opens on the SAME host (252 % 3 is 0,
  // as 3 is): that host's slice moves and the other two are untouched.
  const next = [...ALL.filter((n) => n !== 3), DOORS + 2];
  held.push(frame(next));
  await settle();
  flush();

  expect(forwardsForHost(HOSTS[0] as HostKey).map((f) => f.key)).toEqual(
    next.filter((n) => n % HOSTS.length === 0).map((n) => `door-${n}`),
  );
  expect(forwardsForHost(HOSTS[1] as HostKey).map((f) => f.key)).toEqual(
    keysOn(1),
  );
  expect(doorLocalPorts().has(40_003)).toBe(false);
  expect(doorLocalPorts().has(40_000 + DOORS + 2)).toBe(true);
  expect(diagnostics()).toEqual([]);
});

it("a frame that moves ONE door's far port leaves every other row alone", async () => {
  held.push(frame(ALL));
  await settle();
  flush();
  takeSolidDiagnostics();
  const before = forwardsForHost(HOSTS[1] as HostKey);

  held.push(
    ALL.map((n) => (n === 4 ? doorAt(4, { remotePort: 39_999 }) : doorAt(n))),
  );
  await settle();
  flush();

  // The moved door is on host 1 (`4 % 3`), and the value it publishes is the
  // new one — read off the SAME row the slice held before the frame.
  expect(forwardsForHost(HOSTS[1] as HostKey).map((f) => f.remotePort)).toEqual(
    keysOn(1).map((key) =>
      key === "door-4" ? 39_999 : 30_000 + Number(key.slice("door-".length)),
    ),
  );
  expect(before[1]).toBe(forwardsForHost(HOSTS[1] as HostKey)[1]);
  expect(forwardsForHost(HOSTS[0] as HostKey).map((f) => f.key)).toEqual(
    keysOn(0),
  );
  expect(diagnostics()).toEqual([]);
});
