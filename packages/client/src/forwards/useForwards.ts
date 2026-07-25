/**
 * The client's view of kolu's port forwards — one subscription, three surfaces.
 *
 * The Inspector's Forwarded Ports group, the host tab's dropdown, and the `⇄ n`
 * badge on the host tab all render the same list, so they read it through here
 * rather than each opening its own subscription to the same cell.
 *
 * Nothing here decides anything: the list is the server's, the acts are the
 * server's, and the whole death policy (auto vs manual, when a door closes on its
 * own) lives in `server/src/forwards.ts` where it belongs — a browser tab closing
 * must not be able to change which doors are open.
 */

import type { ForwardOrigin, Forwards } from "kolu-common/surface";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createMemo, createRoot } from "solid-js";
import { app } from "../wire";

// An app-lifetime subscription, for the same reason `useDaemonInventory`'s is:
// a bare module-const `.use()` is the cache's ownerless path, torn down a
// microtask after load with no owner holding its listener count above zero — so
// the cell's first real frame lands on nobody and the list renders empty forever.
const sub = createRoot(() => app.cells.forwards.use());

/** Every live forward, oldest first. */
export function allForwards(): Forwards {
  return sub.value() ?? [];
}

/** The forwards whose far end is on `host` — what the Inspector group and the
 *  host popover each render. A memo per host key rather than a filter at each
 *  call site: three surfaces ask this on every tick of an unrelated field. */
const byHost = new Map<string, () => Forwards>();

export function forwardsForHost(host: HostKey): Forwards {
  const enc = encodeHostKey(host);
  let memo = byHost.get(enc);
  if (memo === undefined) {
    memo = createRoot(() =>
      createMemo(() =>
        allForwards().filter((f) => encodeHostKey(f.host) === enc),
      ),
    );
    byHost.set(enc, memo);
  }
  return memo();
}

/** The live forward for `(host, port)`, if kolu holds one — what a port chip
 *  reads to decide between "open it" and "open a door, then open it", and what
 *  gives it its `⇄ :<localPort>` badge. */
export function forwardFor(host: HostKey, port: number) {
  const enc = encodeHostKey(host);
  return allForwards().find(
    (f) => f.remotePort === port && encodeHostKey(f.host) === enc,
  );
}

/** Open a forward, or return the live one for the same target. Idempotent by
 *  target on the server, so a double-clicked chip opens exactly one door. */
export function createForward(input: {
  host: HostKey;
  port: number;
  origin: ForwardOrigin;
}) {
  return app.procedures.forwards.create(input);
}

/** Take one down. Rejects on a key the server does not hold. */
export function cancelForward(key: string) {
  return app.procedures.forwards.cancel({ key });
}
