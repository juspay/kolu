/**
 * The workaround for a second Effect RPC client hazard. It lives in its own
 * module, apart from the wire links' vocabulary, for the same reason as
 * `./deliveryLanes.ts`: it changes when Effect changes, not when kolu does.
 * This header is the canonical account; everything else that mentions the
 * hazard points here.
 *
 * THE HAZARD (effect@4.1.4). A decode failure is never about one call. The
 * ndjson parser holds a byte buffer shared by every request on the wire, and
 * when it throws it discards that buffer, so whatever followed the bad line in
 * the same read is gone too, and the next read starts at an unknown offset.
 * Effect then fails every call in flight and KEEPS the socket. The link looks
 * alive, but the stream it is reading can no longer be trusted.
 *
 * THE WORKAROUND. {@link undecodableAware} wraps the shared serialization
 * (`../frameLimit`) so the leg is told the moment the parser throws, and the
 * leg ends the wire for real. Its reconnect path then heals it: the duplex
 * legs end the stream with the death `"undecodableFrame"` (`./wire.ts`'s
 * `duplexWireLink`), and the websocket leg cycles its socket (`./websocket.ts`).
 *
 * DELETE THIS MODULE when Effect's protocol ends the socket run on a decode
 * failure. Its two call sites are the protocol layers in `duplexWireLink` and
 * `websocketLink`; the duplex leg would then need another way to name
 * `"undecodableFrame"`. `stdio.test.ts`, `websocket.test.ts` and
 * `@kolu/surface-remote`'s `undecodableFrame.test.ts` are the measure either
 * way.
 *
 * BETA-ASSUMPTION(4.1.4): a decode throw from the ndjson parser fails every call in flight but keeps the socket run alive.
 * In effect@4.1.4 `rpc/RpcSerialization.ts` `makeNdjson` throws
 * `NdjsonDecodeError` (or `MaxBufferSizeExceeded`) after resetting its
 * buffer, and `rpc/RpcClient.ts` `makeProtocolSocket`'s `processData` catches
 * it and broadcasts a `ClientProtocolError` without ending the run. Measured
 * by `stdio.test.ts` ("a corrupted answer ends the link") and
 * `websocket.test.ts` ("an undecodable frame cycles the socket").
 */
import { Layer } from "effect";
import { RpcSerialization } from "effect/rpc";
import { rpcSerialization } from "../frameLimit";

/** The ndjson serialization every leg's CLIENT protocol uses (the shared one),
 *  calling `onUndecodable` before the parser's throw reaches Effect. */
export function undecodableAware(
  onUndecodable: () => void,
): Layer.Layer<RpcSerialization.RpcSerialization> {
  return Layer.succeed(RpcSerialization.RpcSerialization)(
    RpcSerialization.RpcSerialization.of({
      ...rpcSerialization,
      makeUnsafe: () => {
        const parser = rpcSerialization.makeUnsafe();
        return {
          ...parser,
          decode: (bytes) => {
            try {
              return parser.decode(bytes);
            } catch (cause) {
              onUndecodable();
              throw cause;
            }
          },
        };
      },
    }),
  );
}
