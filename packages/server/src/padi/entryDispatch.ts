import { SurfaceRelayTransportLost } from "@kolu/surface/errors";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { isMiddleHopTransportLoss } from "@kolu/surface-remote";
import { Effect, Stream } from "effect";

export interface EntryDispatchOptions {
  siblingTagPrefixes: readonly string[];
  mirror: SurfaceDispatch;
  link: () => SurfaceDispatch | undefined;
  host: string;
}

export function entryDispatch(opts: EntryDispatchOptions): SurfaceDispatch {
  const isSibling = (tag: string): boolean =>
    opts.siblingTagPrefixes.some((prefix) => tag.startsWith(prefix));
  const lost = (what: string): SurfaceRelayTransportLost =>
    new SurfaceRelayTransportLost({ reason: `host ${opts.host} ${what}` });
  const noLink = (): SurfaceRelayTransportLost =>
    lost("has no live padi link to forward a sibling call to");
  const reraiseLinkDeathAsRetryable = (err: unknown): unknown =>
    isMiddleHopTransportLoss(err)
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
                  Effect.fail(reraiseLinkDeathAsRetryable(err)),
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
                  Stream.fail(reraiseLinkDeathAsRetryable(err)),
                );
          })
        : opts.mirror.stream(tag, input),
  };
}
