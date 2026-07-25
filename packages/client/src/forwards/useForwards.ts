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
import { createMemo, createResource, createRoot } from "solid-js";
import { app, client } from "../wire";

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
 *  way of a third one. */
const viewerHostQuery = createRoot(() =>
  createResource(async () => (await client.hosts.viewer()).host),
);

export function viewerHost(): HostKey | null {
  const [data] = viewerHostQuery;
  return data() ?? null;
}
