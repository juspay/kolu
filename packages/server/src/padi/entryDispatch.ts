/**
 * ONE host entry's dispatch — where the host map's calls actually go.
 *
 * Two kinds of call arrive at the same per-entry dispatch, and they want
 * opposite things:
 *
 *   - AN ENTRY MEMBER (padi's own) goes to the host's re-served MIRROR, in
 *     process. kolu-server holds every host's padi link open whether or not a
 *     browser is looking, folds its cells once, and relays its streams per
 *     subscriber — so a browser reconnect costs nothing upstream.
 *
 *   - A SIBLING MEMBER (odu's) goes STRAIGHT DOWN the padi link. The daemon on
 *     the far end already re-serves odu, demand-gated: it dials odu when
 *     somebody subscribes and lets go when the last subscriber leaves. A second
 *     mirror HERE would fold the sibling's cells the moment this hop had a
 *     link — which it always does — so that demand would never fall back to
 *     zero and every machine would dial odu for as long as a browser was open.
 *     Nothing in between means the browser's demand IS the far daemon's demand.
 *
 * The two tag sets are disjoint by construction: `surface/<member>/<verb>` for
 * an entry member, `surface/<sibling>/<member>/<verb>` for a sibling one — the
 * same tag that daemon serves it at, which is why forwarding is literal.
 */

import type { SurfaceDispatch } from "@kolu/surface/link";
import { SurfaceRelayTransportLost } from "@kolu/surface/errors";
import { Effect, Stream } from "effect";

export interface EntryDispatchOptions {
  /** Upstream tag prefixes (`surface/<sibling>/`) whose calls are forwarded
   *  rather than mirrored. Derived from the map's own `siblings` declaration, so
   *  a sibling added there needs no second list here. */
  siblingTagPrefixes: readonly string[];
  /** The in-process dispatch over this host's re-served handler records. */
  mirror: SurfaceDispatch;
  /** The host's live link, read PER CALL — never captured. A reconnect replaces
   *  it, and a forward holding the old one would be talking to a socket nobody
   *  is on the other end of. `undefined` while the link is down. */
  link: () => SurfaceDispatch | undefined;
  /** The host, for the sentence a down link produces. */
  host: string;
}

/** The dispatch `serveHostMap` forwards one host's calls to. */
export function entryDispatch(opts: EntryDispatchOptions): SurfaceDispatch {
  const isSibling = (tag: string): boolean =>
    opts.siblingTagPrefixes.some((prefix) => tag.startsWith(prefix));
  // RETRYABLE by tag, because this one heals: the host's padi link is coming
  // back (kolu-server pins it), and the subscriber should be re-asking when it
  // does rather than left holding a dead subscription or a silent hold that
  // never fills.
  const noLink = (): SurfaceRelayTransportLost =>
    new SurfaceRelayTransportLost({
      reason: `host ${opts.host} has no live padi link to forward a sibling call to`,
    });
  return {
    unary: (tag, input) =>
      isSibling(tag)
        ? Effect.suspend(() => {
            const link = opts.link();
            return link === undefined
              ? Effect.fail(noLink())
              : link.unary(tag, input);
          })
        : opts.mirror.unary(tag, input),
    stream: (tag, input) =>
      isSibling(tag)
        ? Stream.suspend(() => {
            const link = opts.link();
            return link === undefined
              ? Stream.fail(noLink())
              : link.stream(tag, input);
          })
        : opts.mirror.stream(tag, input),
  };
}
