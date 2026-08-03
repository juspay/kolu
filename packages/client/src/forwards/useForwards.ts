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
import type { ForwardOrigin, Forwards } from "kolu-common/surface";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createMemo, createResource, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { runActionPromise } from "../runAction";
import { app, client } from "../wire";

// An app-lifetime subscription, for the same reason `useDaemonInventory`'s is:
// a bare module-const `.use()` is the cache's ownerless path, torn down a
// microtask after load with no owner holding its listener count above zero — so
// the cell's first real frame lands on nobody and the list renders empty forever.
const sub = createRoot(() => app.cells.forwards.use());

/** Every live forward, oldest first. Module-local: every surface wants the
 *  per-host slice below, and a whole-fleet reader on the outside would be a
 *  second way to ask a question that has one right shape. */
function allForwards(): Forwards {
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
 *  render — `PortsSection` calls it per port row inside a `<For>` child — and a
 *  Solid resource accessor RE-THROWS its fetcher's error instead of returning
 *  `undefined`, so without the catch a transient RPC failure would abort the
 *  render pass, with no `ErrorBoundary` anywhere in the client to catch it.
 *  `null` degrades to "keep offering the forward" for BOTH causes on purpose —
 *  the server's own honest "cannot tell" and a caught RPC failure both want the
 *  safe default, never a withheld feature — but the two are not the same fact,
 *  so a caught failure still gets its own toast (not just a console line, which
 *  is invisible outside DevTools) even though the render behaviour it feeds
 *  stays identical either way. */
const viewerHostQuery = createRoot(() =>
  createResource(() =>
    runActionPromise(
      client.hosts.viewer().pipe(
        Effect.map((r): HostKey | null => r.host),
        Effect.catch((err) =>
          Effect.sync((): HostKey | null => {
            toast.warning(`Viewer-host lookup failed: ${toError(err).message}`);
            return null;
          }),
        ),
      ),
    ),
  ),
);

export function viewerHost(): HostKey | null {
  const [data] = viewerHostQuery;
  return data() ?? null;
}
