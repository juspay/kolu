/**
 * The client's view of kolu's port forwards — one subscription, three surfaces.
 *
 * The Inspector's Ports list, the host tab's dropdown, and the thin teal ring on
 * the host tab all render the same list, so they read it through here rather
 * than each opening its own subscription to the same cell.
 *
 * Nothing here decides anything: the list is the server's, the acts are the
 * server's, and the whole death policy (auto vs manual, when a door closes on its
 * own) lives in `server/src/portForward/forwards.ts` where it belongs — a browser tab closing
 * must not be able to change which doors are open.
 */

import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { ForwardOrigin, Forwards, KoluForward } from "kolu-common/surface";
import { createMemo, createRoot, mapArray } from "solid-js";
import { toast } from "solid-sonner";
import { sameItems } from "../conductor/sameItems";
import { runActionPromise } from "../runAction";
import { foldEach } from "@kolu/surface/solid";
import { app, client, hostKeys } from "../wire";

/** No doors on this host — the ONE empty array every quiet host's slice
 *  answers with, so a tick that moves another host's door leaves this host's
 *  reference alone. */
const NO_FORWARDS: Forwards = [];

/** ONE ROW PER LIVE DOOR, and the two derivations every surface reads built
 *  off those rows rather than off the cell's array.
 *
 *  The cell's value is a store ARRAY: walking it in user code costs its
 *  `length` leaf, an index leaf per door and whatever the walk reads off each
 *  row — three sources a door, which Solid's development build judges
 *  `WIDE_SCOPE_DEPS` past 200 sources at about 65 doors, on the per-host
 *  slice AND on the door-port set. {@link foldEach} puts each door's reading
 *  on its own row memo and leaves every join at `1 + ⌈N / 128⌉`.
 *
 *  A row is addressed by its SLOT, not by the row object `mapArray` would
 *  hand it: the member declares `arrayKey: "key"`, so the store MERGES a
 *  door's fields in place across frames, and a row that read them off the
 *  raw item would never be told one moved. The row carries the store's own
 *  proxy through, so a keyed `<For>` downstream keeps following it. */
const forwards = createRoot(() => {
  // An app-lifetime subscription, for the same reason `useDaemonInventory`'s
  // is: a bare module-const `.use()` is the cache's ownerless path, torn down
  // a microtask after load with no owner holding its listener count above
  // zero — so the cell's first real frame lands on nobody and the list
  // renders empty forever.
  const sub = app.cells.forwards.use();
  /** Every live forward, oldest first. Module-local: every surface wants the
   *  per-host slice below, and a whole-fleet reader on the outside would be a
   *  second way to ask a question that has one right shape. */
  const allForwards = (): Forwards => sub.value() ?? [];

  /** One slot per door, read off the array's `length` alone. */
  const slots = createMemo(
    () => Array.from({ length: allForwards().length }, (_, at) => at),
    { name: "forwardSlots", equals: sameItems },
  );

  const rows = foldEach(
    "forwardRow",
    slots,
    (at) => {
      const one = allForwards()[at];
      return one === undefined
        ? undefined
        : {
            enc: encodeHostKey(one.host),
            localPort: one.localPort,
            forward: one,
          };
    },
    (a, b) =>
      a.enc === b.enc && a.localPort === b.localPort && a.forward === b.forward,
  );

  /** Every host's doors in one pass over the rows — one source. */
  const byEncodedHost = createMemo(
    () => {
      const index = new Map<string, KoluForward[]>();
      for (const row of rows()) {
        const held = index.get(row.enc);
        if (held === undefined) index.set(row.enc, [row.forward]);
        else held.push(row.forward);
      }
      return index;
    },
    { name: "forwardsByHostIndex" },
  );

  /** The forwards whose far end is on `host` — what the Inspector group and
   *  the host popover each render. A memo per host key rather than a filter
   *  at each call site: three surfaces ask this on every tick of an unrelated
   *  field, and the `equals` gate keeps a quiet host's array reference across
   *  a tick that moved somebody else's door. */
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (enc) => ({
      enc,
      read: createMemo(() => byEncodedHost().get(enc) ?? NO_FORWARDS, {
        name: "forwardsByHost",
        equals: sameItems,
      }),
    }),
  );
  const byHost = createMemo(
    () => new Map(roots().map(({ enc, read }) => [enc, read])),
    { name: "forwardsByHostKey" },
  );

  /** The LOCAL listen ports of every door kolu holds — kolu-server's own
   *  relay listeners, which live on the kolu server's machine whatever host
   *  they reach. The Ports section leaves these out of that machine's
   *  listener list: a door is shown as the row it serves, and its relay
   *  listener as a second row would be one door rendered twice. */
  const doorLocal = createMemo(
    () => {
      const ports = new Set<number>();
      for (const row of rows()) ports.add(row.localPort);
      return ports;
    },
    {
      name: "doorLocalPorts",
      // An unrelated forward tick with the same doors must not re-run the join.
      equals: (a, b) => a.size === b.size && [...a].every((p) => b.has(p)),
    },
  );

  return { byHost, doorLocal };
});

export function forwardsForHost(host: HostKey): Forwards {
  const read = forwards.byHost().get(encodeHostKey(host));
  if (!read)
    throw new Error(
      `Forwards requested for non-member host ${encodeHostKey(host)}`,
    );
  return read();
}

export const doorLocalPorts = forwards.doorLocal;

/** Open a forward, or return the live one for the same target. Idempotent by
 *  target on the server, so a double-clicked chip opens exactly one door. */
export function createForward(input: {
  host: HostKey;
  port: number;
  origin: ForwardOrigin;
}) {
  return app.procedures.forwards.create(input);
}

/** Take one down. FAILS on a key the server does not hold. */
export function cancelForward(key: string) {
  return app.procedures.forwards.cancel({ key });
}

/** WHICH of kolu's hosts this browser is sitting at, or `null`.
 *
 *  Asked ONCE per page: it is a fact about where the browser is, which does not
 *  change while the page is open. The server answers it (only it can see the
 *  address the connection comes from), and answers `null` for every uncertain
 *  case — so a `null` here means "keep offering the forward", which is the
 *  behaviour that always works.
 *
 *  It exists because a host in kolu's fleet can be the machine you are reading
 *  kolu FROM: forwarding one of its loopback ports then opens a door on the kolu
 *  server so your browser can reach a port on the machine you are sitting at, by
 *  way of a third one.
 *
 *  A FAILED read lands on `null` rather than escaping. This is read during
 *  render — `PortsSection` calls it per port row inside a `<For>` child — and
 *  an async memo THROWS its compute's rejection at whoever reads it, so
 *  without the catch a transient RPC failure would abort the render pass, with
 *  no `Errored` boundary anywhere in the client to catch it.
 *  `null` degrades to "keep offering the forward" for BOTH causes on purpose —
 *  the server's own honest "cannot tell" and a caught RPC failure both want the
 *  safe default, never a withheld feature — but the two are not the same fact,
 *  so a caught failure still gets its own toast (not just a console line, which
 *  is invisible outside DevTools) even though the render behaviour it feeds
 *  stays identical either way.
 *
 *  THE PRE-ANSWER WINDOW IS `null` TOO, declared as the memo's loading value:
 *  the one-shot is read bare during render by a section with no `Loading`
 *  boundary over it, and "we cannot tell yet" is the same fact for the row as
 *  "the server cannot tell" — the forward stays on offer, and the row settles
 *  to the real answer when it lands. Nothing on screen is ever held waiting
 *  for this read. */
const viewerHostQuery = createRoot(() =>
  createMemo<HostKey | null>(
    () =>
      runActionPromise(
        client.hosts.viewer().pipe(
          Effect.map((r): HostKey | null => r.host),
          Effect.catch((err) =>
            Effect.sync((): HostKey | null => {
              toast.warning(
                `Viewer-host lookup failed: ${toError(err).message}`,
              );
              return null;
            }),
          ),
        ),
      ),
    { loadingValue: null, name: "viewerHostQuery" },
  ),
);

export function viewerHost(): HostKey | null {
  return viewerHostQuery();
}
