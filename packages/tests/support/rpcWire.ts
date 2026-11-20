import { isTransportError } from "@kolu/surface/client";
import { mergeDisjointGroups } from "@kolu/surface/define";
import {
  isSurfaceRelayTransportLost,
  isSurfaceStdioTransportClosed,
} from "@kolu/surface/errors";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  websocketLink,
  type WebsocketLink,
} from "@kolu/surface/links/websocket";
import { surfaceWsUrl } from "@kolu/surface-app";
import { isStaleProcessClose } from "@kolu/surface-app/connect";
import { fold } from "@kolu/surface-map";
import { Cause, Effect, Exit, Option, Result, Schema, Stream } from "effect";
import { koluSurfaceGroup } from "kolu-common/contract";
import { encodeHostKey, LOCAL_HOST, parseHostInput } from "kolu-common/hostKey";
import { PADI_SURFACE_NAME, padiHostMap } from "kolu-common/surfacesWithPadi";

const clientGroup = mergeDisjointGroups({
  koluSurfaces: koluSurfaceGroup,
  padiMap: padiHostMap.group,
});

const LOCAL_WIRE_KEY = encodeHostKey(LOCAL_HOST);
export const PADI_HOST_KEY: string =
  process.env.KOLU_E2E_PADI_HOST?.split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) => encodeHostKey(parseHostInput(h)))
    .find((enc) => enc !== LOCAL_WIRE_KEY) ?? LOCAL_WIRE_KEY;

const DEFAULT_CALL_TIMEOUT_MS = 5_000;

export class RpcCallFailed extends Error {
  constructor(
    readonly tag: string,
    readonly failure: unknown,
    readonly timedOut: boolean,
  ) {
    super(
      `${tag}: ${
        timedOut
          ? "timed out"
          : failure instanceof Error
            ? `${failure.name}: ${failure.message}`
            : String(failure)
      }`,
    );
    this.name = "RpcCallFailed";
  }
}

const WARMING_UP_TAGS: Record<string, true> = { MapKeyUnknown: true };

const WARMING_UP_ERROR_NAMES: Record<string, true> = {
  UpstreamUnavailableError: true,
};

export function isPadiWarmingUp(err: unknown): boolean {
  if (!(err instanceof RpcCallFailed)) return false;
  if (err.timedOut) return true;
  const failure = err.failure;
  if (
    isTransportError(failure) ||
    isSurfaceStdioTransportClosed(failure) ||
    isSurfaceRelayTransportLost(failure)
  )
    return true;
  const tag = (failure as { readonly _tag?: unknown } | null)?._tag;
  if (typeof tag === "string" && WARMING_UP_TAGS[tag]) return true;
  return (
    failure instanceof Error && WARMING_UP_ERROR_NAMES[failure.name] === true
  );
}

interface Wire {
  readonly url: string;
  readonly link: WebsocketLink;
}

let wire: Wire | undefined;
let baseUrl: string | undefined;

export async function setRpcBaseUrl(url: string): Promise<void> {
  if (baseUrl === url) return;
  await disposeRpcWire();
  baseUrl = url;
}

export async function disposeRpcWire(): Promise<void> {
  const open = wire;
  wire = undefined;
  if (open) await open.link.dispose();
}

async function dispatch(): Promise<SurfaceDispatch> {
  const url = baseUrl;
  if (url === undefined) {
    throw new Error(
      "rpcWire: no server base URL — call `setRpcBaseUrl(baseUrl)` before issuing an RPC.",
    );
  }
  if (wire?.url === url) return wire.link.dispatch;
  await disposeRpcWire();
  const link = await websocketLink({
    group: clientGroup,
    url: () => surfaceWsUrl(url),
    isTerminalClose: isStaleProcessClose,
  });
  wire = { url, link };
  return link.dispatch;
}

async function settle<A>(
  tag: string,
  effect: Effect.Effect<A, unknown>,
  timeoutMs: number,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (Exit.isSuccess(exit)) return exit.value;
  const cause: Cause.Cause<unknown> = exit.cause;
  if (Cause.hasInterrupts(cause)) throw new RpcCallFailed(tag, cause, true);
  const failure = Cause.findError(cause);
  if (Result.isSuccess(failure))
    throw new RpcCallFailed(tag, failure.success, false);
  const defect = Cause.findDefect(cause);
  throw new RpcCallFailed(
    tag,
    Result.isSuccess(defect) ? defect.success : Cause.squash(cause),
    false,
  );
}

function decodePayload(tag: string, payload: unknown): unknown {
  const rpc = clientGroup.requests.get(tag);
  if (rpc === undefined) {
    throw new Error(
      `rpcWire: no member is served at tag "${tag}" — check the spelling against the surface spec ` +
        "(a padi entry member is `surface/padi/<member>/<verb>`).",
    );
  }
  return Schema.decodeUnknownSync(
    rpc.payloadSchema as unknown as Schema.Codec<unknown, unknown>,
  )(payload);
}

export interface RpcCallOptions {
  readonly timeoutMs?: number;
}

export async function surfaceCall(
  tag: string,
  payload?: unknown,
  opts: RpcCallOptions = {},
): Promise<unknown> {
  const decoded = decodePayload(tag, payload);
  const d = await dispatch();
  return settle(
    tag,
    d.unary(tag, decoded),
    opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
  );
}

export async function surfaceFirstFrame(
  tag: string,
  payload?: unknown,
  opts: RpcCallOptions = {},
): Promise<unknown> {
  const decoded = decodePayload(tag, payload);
  const d = await dispatch();
  const head = Effect.flatMap(
    Stream.runHead(d.stream(tag, decoded)),
    (frame) =>
      Option.isSome(frame)
        ? Effect.succeed(frame.value)
        : Effect.fail(
            new Error(`${tag}: subscription closed before its first frame`),
          ),
  );
  return settle(tag, head, opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
}

const padiTag = (memberVerb: string): string =>
  `surface/${PADI_SURFACE_NAME}/${memberVerb}`;

const padiPayload = (input: unknown): unknown => fold(PADI_HOST_KEY, input);

export function padiCall(
  memberVerb: string,
  input?: unknown,
  opts: RpcCallOptions = {},
): Promise<unknown> {
  return surfaceCall(padiTag(memberVerb), padiPayload(input), opts);
}

export async function padiFirstFrameThenClose(
  memberVerb: string,
  input?: unknown,
  opts: RpcCallOptions = {},
): Promise<unknown> {
  const tag = padiTag(memberVerb);
  const decoded = decodePayload(tag, padiPayload(input));
  const d = await dispatch();
  const head = Effect.flatMap(
    Stream.runHead(d.stream(tag, decoded)),
    (frame) =>
      Option.isSome(frame)
        ? Effect.succeed(frame.value)
        : Effect.fail(
            new Error(`${tag}: subscription closed before its first frame`),
          ),
  );
  return settle(tag, head, opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
}
