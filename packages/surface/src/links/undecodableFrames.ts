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
 * (`../frameLimit`) so the leg is told the moment the parser throws, and
 * told WHAT it refused ({@link UndecodableFrame}), and the leg ends the wire
 * for real. Its reconnect path then heals it: the duplex legs end the stream
 * with the death `"undecodableFrame"` (`./wire.ts`'s `duplexWireLink`), and
 * the websocket leg cycles its socket and names the cycle to its host
 * (`./websocket.ts`).
 *
 * WHEN EFFECT'S PROTOCOL ENDS THE SOCKET RUN ON A DECODE FAILURE, the sever
 * half of this module is dead weight: its two call sites are the protocol
 * layers in `duplexWireLink` and `websocketLink`, and both would stop severing.
 * The naming half stays needed until Effect also reports what it refused, since
 * both legs name the end from it. `stdio.test.ts`, `websocket.test.ts`,
 * `undecodableFrames.test.ts` and `@kolu/surface-remote`'s
 * `undecodableFrame.test.ts` are the measure either way.
 *
 * BETA-ASSUMPTION(4.1.4): a decode throw from the ndjson parser fails every call in flight but keeps the socket run alive.
 * In effect@4.1.4 `rpc/RpcSerialization.ts` `makeNdjson` throws
 * `NdjsonDecodeError` (or `MaxBufferSizeExceeded`) after resetting its
 * buffer, and `rpc/RpcClient.ts` `makeProtocolSocket`'s `processData` catches
 * it and broadcasts a `ClientProtocolError` without ending the run. Measured
 * by `stdio.test.ts` ("a corrupted answer ends the link") and
 * `websocket.test.ts` ("an undecodable frame cycles the socket").
 *
 * BETA-ASSUMPTION(4.1.4): the ndjson parser throws only NdjsonDecodeError (JSON.parse's error as cause) or MaxBufferSizeExceeded.
 * In effect@4.1.4 `rpc/RpcSerialization.ts` `makeNdjson`'s `decode` has
 * exactly those two `throw`s, and the cap it enforces counts UTF-16 code units
 * of the decoded text. {@link classifyUndecodable} keys on the two classes; a
 * third would surface as `"unrecognized"`, never be dropped. Measured by
 * `undecodableFrames.test.ts`.
 */
import { Layer } from "effect";
import { RpcSerialization } from "effect/rpc";
import { messageOf } from "../errors";
import { rpcSerialization } from "../frameLimit";

/** Upper bound on `parserMessage`, in UTF-16 code units. */
export const PARSER_MESSAGE_MAX_CHARS = 200;

/** The size of the transport read whose decode threw.
 *  `"utf16"`: a text read; `length` is `string.length`, the unit the parser's cap counts.
 *  `"bytes"`: a binary read; `length` is `byteLength`, an upper bound on the parser's count.
 *
 *  It is the size of that one read, NOT of the parser's buffer: a tail the
 *  parser was already holding from an earlier read is not counted. Over a
 *  websocket a peer of this protocol ends every message with a newline, so
 *  there is none; counting it would mean mirroring the buffer on every frame. */
export interface FrameRead {
  readonly unit: "utf16" | "bytes";
  readonly length: number;
}

/** What the ndjson parser refused. Never the frame. */
export type UndecodableFrame =
  | {
      readonly kind: "invalidJson";
      /** The JSON engine's own sentence, cut to PARSER_MESSAGE_MAX_CHARS. The ONE field
       *  that can quote characters of the frame: engines quote a few around the fault. */
      readonly parserMessage: string;
      readonly read: FrameRead;
    }
  | {
      readonly kind: "overCap";
      /** The cap the parser enforced, from its own error. */
      readonly cap: number;
      readonly read: FrameRead;
    }
  /** The parser threw something Effect 4.1.4 never throws. Sound, not a fallback: the
   *  socket is still cycled and the original throw still reaches Effect. */
  | { readonly kind: "unrecognized"; readonly read: FrameRead };

/** Name what the parser refused, from the value it threw and the read it threw
 *  on. Pure: keys on Effect's own error classes, never on message text. The
 *  value is frozen, `read` included: it is recorded and handed to a host, and
 *  neither may change it for the other. */
export function classifyUndecodable(
  thrown: unknown,
  data: Uint8Array | string,
): UndecodableFrame {
  const read: FrameRead = Object.freeze(
    typeof data === "string"
      ? { unit: "utf16", length: data.length }
      : { unit: "bytes", length: data.byteLength },
  );
  if (thrown instanceof RpcSerialization.NdjsonDecodeError) {
    return Object.freeze({
      kind: "invalidJson",
      parserMessage: messageOf(thrown.cause).slice(0, PARSER_MESSAGE_MAX_CHARS),
      read,
    });
  }
  if (thrown instanceof RpcSerialization.MaxBufferSizeExceeded) {
    return Object.freeze({ kind: "overCap", cap: thrown.maxBufferSize, read });
  }
  return Object.freeze({ kind: "unrecognized", read });
}

/** The ndjson serialization every leg's CLIENT protocol uses (the shared one),
 *  calling `onUndecodable` with what was refused before the parser's throw
 *  reaches Effect. The throw itself continues unchanged, whatever the handler
 *  does: a handler that throws is logged with `console.error` and stops
 *  nothing, because the parser's error is the fact Effect acts on. */
export function undecodableAware(
  onUndecodable: (frame: UndecodableFrame) => void,
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
              try {
                onUndecodable(classifyUndecodable(cause, bytes));
              } catch (handlerError) {
                console.error(
                  "undecodableAware: the leg's handler threw; the parser's error still reaches Effect",
                  handlerError,
                );
              }
              throw cause;
            }
          },
        };
      },
    }),
  );
}
