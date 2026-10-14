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
 *
 * WHAT A LINK DEATH COSTS A SIBLING SUBSCRIBER. The mirror ABSORBS one: a
 * value member's relay holds the browser's subscription open across a padi
 * respawn and rebinds to the next spawn. A forward has nothing to hold with, so
 * the subscription ENDS — and it ends as the one RETRYABLE framework tag
 * (`SurfaceRelayTransportLost`), so the browser's own fence re-subscribes and
 * the next frame it paints is a fresh reading rather than a replay. That is
 * what makes the end safe here: odu's carried members are snapshot-first.
 *
 * A link that is merely NOT UP YET ends the same way, deliberately, and it is
 * the one place this hop pays for the simplicity: a subscriber re-asks on the
 * fence's cadence while a host is connecting rather than parking until it is.
 * Holding instead would reintroduce the silent park the per-host eviction
 * exists to prevent — a dispatch built over a session the pool has since
 * destroyed would hold a subscriber forever on a link that is never coming.
 * An end the fence retries is self-correcting; a hold on a corpse is not.
 */

import { isTransportError } from "@kolu/surface/client";
import {
  isDeadTransportError,
  SurfaceRelayTransportLost,
} from "@kolu/surface/errors";
import type { SurfaceDispatch } from "@kolu/surface/link";
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
  const lost = (what: string): SurfaceRelayTransportLost =>
    new SurfaceRelayTransportLost({ reason: `host ${opts.host} ${what}` });
  const noLink = (): SurfaceRelayTransportLost =>
    lost("has no live padi link to forward a sibling call to");
  /** A failure the LINK produced, re-raised as the one tag the client's fence
   *  re-subscribes on. The link's own death tags (`SurfaceStdioTransportClosed`,
   *  an RPC transport error) are permanently-dead corpses by definition — true
   *  of THAT socket, false of this host, which re-dials. Forwarded verbatim
   *  they would strand the subscriber on a link that has already been replaced.
   *  A DECLARED failure is the far end's own answer and crosses unchanged. */
  const classify = (err: unknown): SurfaceRelayTransportLost | unknown =>
    isDeadTransportError(err) || isTransportError(err)
      ? lost("lost its padi link mid-call while forwarding a sibling call")
      : err;
  return {
    unary: (tag, input) =>
      isSibling(tag)
        ? Effect.suspend(() => {
            const link = opts.link();
            return link === undefined
              ? Effect.fail(noLink())
              : Effect.catch(link.unary(tag, input), (err: unknown) =>
                  Effect.fail(classify(err)),
                );
          })
        : opts.mirror.unary(tag, input),
    stream: (tag, input) =>
      isSibling(tag)
        ? Stream.suspend(() => {
            const link = opts.link();
            return link === undefined
              ? Stream.fail(noLink())
              : Stream.catch(link.stream(tag, input), (err: unknown) =>
                  Stream.fail(classify(err)),
                );
          })
        : opts.mirror.stream(tag, input),
  };
}
