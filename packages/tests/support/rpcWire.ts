/**
 * The e2e harness's Node-side RPC caller — the ONE place the suite speaks kolu's
 * real wire.
 *
 * The suite used to drive the server over an oRPC HTTP arm (`POST
 * /rpc/surface/<sibling>/<member>/<verb>` with a `{ json: … }` body). That arm is
 * GONE: under Effect RPC the wire is a single ndjson websocket at `/rpc/ws`
 * carrying flat, tag-keyed messages (`surface/<sibling>/<member>/<verb>`), which is
 * why every one of those POSTs answered 404.
 *
 * So the harness dials the product's OWN transport instead of re-inventing a
 * server-side test arm: `websocketLink` from `@kolu/surface` (the exact link
 * `packages/client/src/wire.ts` dials in the browser, with surface-app's
 * `isStaleProcessClose` as the terminal-close classifier), over the group the
 * server actually serves. Nothing about the server changes, and the harness cannot
 * drift onto a route the product doesn't have.
 *
 * ## Payloads are the ENCODED side
 *
 * Call sites pass the same JSON bodies the HTTP arm posted; {@link decodePayload}
 * decodes each through its own member's schema before dispatching — the exact edge
 * the typed client face owns (`@kolu/surface`'s `link.ts`: the face accepts the
 * Encoded side publicly and hands the dispatch the decoded value). That is what
 * keeps every ported call site byte-identical AND keeps a schema's decoding defaults
 * working for a fixture that omits an optional field.
 *
 * ## The padi sibling rides the surface-map fold
 *
 * padi is a keyed `SurfaceMap` (W4, "the switch"): its members are served at
 * `surface/padi/<member>/<verb>` behind the uniform `{ mapKey, input }` envelope
 * (`@kolu/surface-map`'s own `fold()` — the ONE encoder). The typed client folds
 * automatically; the harness reaches members by tag, so it folds by hand HERE,
 * once, rather than at each call site.
 *
 * ## Lifetime
 *
 * ONE wire per cucumber worker, re-dialled whenever the server moves (a worker
 * restarts its server on a fresh port for `@kaval-restart`). {@link setRpcBaseUrl}
 * is the single seam that notices; `AfterAll` disposes through
 * {@link disposeRpcWire}, so a worker never leaks a socket the reaper has to clean
 * up. The link owns its own retry schedule, so a call issued while the server is
 * still coming up parks rather than failing — every call is therefore BOUNDED by
 * `timeoutMs` (an `AbortSignal` the Effect runtime turns into fiber interruption,
 * which tears the in-flight request down).
 */

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

/** The client group: kolu's own siblings (`surface/kolu/*`, `surface/surfaceApp/*`)
 *  PLUS the padi host map's key-folded members (`surface/padi/*`). Assembled from the
 *  SAME two sources `packages/server/src/surface.ts` merges into `servedGroup`, so a
 *  tag the harness can spell is a tag the server serves — the client group is a
 *  strict subset of the served one (the root `server/*` / `daemon/*` / `hosts/*`
 *  procedures are not merged because no scenario drives them from here).
 *
 *  No cast: `mergeDisjointGroups` takes the element-union erasure on itself
 *  (`RpcGroup` is invariant in that union), so the precisely-typed halves go in as
 *  they are. */
const clientGroup = mergeDisjointGroups({
  koluSurfaces: koluSurfaceGroup,
  padiMap: padiHostMap.group,
});

/** The wire `mapKey` — the CANONICAL encoded form (`encodeHostKey`) — the e2e drives its
 *  padi resets against: the local default's `"local"` (the single-host CI e2e —
 *  `parseKoluPadiHostSeed` seeds `[LOCAL_HOST]`), or the remote seeded via
 *  `KOLU_E2E_PADI_HOST` (the ssh-leg e2e — the same host `waitForPadiLive` polls).
 *  `KOLU_E2E_PADI_HOST` carries the same RAW ssh-target tokens `KOLU_PADI_HOST` does
 *  (order-preserved after the local default in `parseKoluPadiHostSeed`), so each is parsed
 *  the same HUMAN-input way (`parseHostInput`) before being encoded onto the wire. */
const LOCAL_WIRE_KEY = encodeHostKey(LOCAL_HOST);
export const PADI_HOST_KEY: string =
  process.env.KOLU_E2E_PADI_HOST?.split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) => encodeHostKey(parseHostInput(h)))
    .find((enc) => enc !== LOCAL_WIRE_KEY) ?? LOCAL_WIRE_KEY;

/** Default per-call bound. The link retries a dial forever in its own fiber, so a call
 *  against a server that is down would otherwise park indefinitely; every caller either
 *  takes this or passes its own deadline-aware budget. */
const DEFAULT_CALL_TIMEOUT_MS = 5_000;

/** A wire call that did not succeed, carrying the failure the server (or the transport)
 *  actually answered with — never flattened to a string, so a caller can classify it
 *  ({@link isPadiWarmingUp}) instead of scanning prose. */
export class RpcCallFailed extends Error {
  constructor(
    readonly tag: string,
    /** The extracted failure: a DECLARED tagged error, a DEFECT value (an `Error` whose
     *  `name` survives the wire's defect codec), or the transport's `RpcClientError`. */
    readonly failure: unknown,
    /** True when the call was cut short by its own timeout rather than answered. */
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

/** Is this failure the padi binding still WARMING UP — i.e. "not yet", not "never"?
 *
 *  The successor of the old HTTP `503` split, restated on the wire's own vocabulary.
 *  Four shapes mean "ask again":
 *
 *   - a TRANSPORT failure (`RpcClientError`) or a per-call timeout — the server isn't
 *     listening yet, or the HARNESS'S OWN socket dropped mid-restart;
 *   - `MapKeyUnknown` — the host pool has not seeded this key yet, so the map has no
 *     entry to route to;
 *   - the ENTRY LINK's transport death — `SurfaceStdioTransportClosed` (the padi
 *     process behind the entry is respawning, so its stdio/unix leg is gone) or
 *     `SurfaceRelayTransportLost` (a re-serve's middle hop dropped). The map forwards
 *     the entry's failure verbatim, so these are what a call issued DURING a padi
 *     restart answers with;
 *   - `UpstreamUnavailableError` — the entry exists but its re-serve has no live
 *     upstream link (`@kolu/surface-remote`'s `reServeSurface`). This is EXACTLY what
 *     used to be answered as `503`. It crosses as a DEFECT, and Effect's defect codec
 *     preserves an `Error`'s `name`, so the class's own identity is what we match —
 *     never its prose.
 *
 *  Everything else — a declared procedure error, a schema rejection, a `MapEntryFailed`
 *  terminal fault — is PERMANENT and must surface immediately, exactly as a non-503
 *  HTTP status did. `SurfaceTransportRetired` stays permanent too: that is the server
 *  RETIRING a stale tab's socket (close code 4001), and re-dialling only re-presents
 *  the same corpse.
 *
 *  **Why "never retry a dead transport" does not apply here.** `@kolu/surface/client`'s
 *  `shouldRetryStreamError` refuses `SurfaceStdioTransportClosed` because IT would be
 *  retrying over that same dead link. The harness is not: it re-issues over its own
 *  live websocket, and the server re-dials the entry when padi comes back — so a fresh
 *  call reaches a fresh link. The predicates come from `@kolu/surface/errors` so this
 *  branches on the declared `_tag`, never on the failure's prose. */
export function isPadiWarmingUp(err: unknown): boolean {
  if (!(err instanceof RpcCallFailed)) return false;
  if (err.timedOut) return true;
  const failure = err.failure;
  if (isTransportError(failure)) return true;
  if (
    isSurfaceStdioTransportClosed(failure) ||
    isSurfaceRelayTransportLost(failure)
  )
    return true;
  const tag = (failure as { readonly _tag?: unknown } | null)?._tag;
  if (tag === "MapKeyUnknown") return true;
  return (
    failure instanceof Error && failure.name === "UpstreamUnavailableError"
  );
}

interface Wire {
  readonly url: string;
  readonly link: WebsocketLink;
}

let wire: Wire | undefined;
let baseUrl: string | undefined;

/** Point the shared wire at `url` (an http(s) base). Disposes a wire dialled at a
 *  DIFFERENT server — a worker that restarts its server lands on a fresh random port,
 *  and a socket left on the old one would retry against a corpse forever. Idempotent
 *  for the same URL. */
export async function setRpcBaseUrl(url: string): Promise<void> {
  if (baseUrl === url) return;
  await disposeRpcWire();
  baseUrl = url;
}

/** Dispose the shared wire, if one is open. Safe to call twice. */
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
    // A THUNK, as the browser passes: the link re-evaluates it on every re-dial. The
    // harness sends no `pid` echo, so it is never the stale tab the server retires.
    url: () => surfaceWsUrl(url),
    // The app's own close-code vocabulary — the same classifier `createSurfaceSocket`
    // hands the browser's link, so a retirement means here what it means there.
    isTerminalClose: isStaleProcessClose,
  });
  wire = { url, link };
  return link.dispatch;
}

/** Run an Effect-shaped wire call to a settled answer, bounded by `timeoutMs`, and
 *  translate its Cause into the ONE failure type callers classify.
 *
 *  The abort is turned into fiber INTERRUPTION by the runtime, which runs the
 *  request's finalizers — so a timed-out call tears its own in-flight request down
 *  rather than leaving it parked on the socket. */
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

/** Decode a call-site payload at the edge, exactly as the typed client face does.
 *
 *  A `SurfaceDispatch` takes the DECODED (`Type`) side; the payloads the harness
 *  writes are the ENCODED side — the same JSON bodies the retired HTTP arm posted,
 *  which is what makes every ported call site byte-identical. Decoding here applies
 *  each member's DECODING DEFAULTS (padi's `lastActivityAt` backfills to `null`;
 *  `activeTerminalId` to `null`), so a saved-session fixture may omit them exactly as
 *  it always could, instead of every step re-spelling defaults the schema owns.
 *
 *  It also makes a mistyped tag fail HERE, naming the tag, rather than as an opaque
 *  defect from inside Effect RPC's flat client (which resolves a tag's schemas by
 *  lookup and dies on a miss). */
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
  /** Bound this call (default {@link DEFAULT_CALL_TIMEOUT_MS}). A caller polling to a
   *  deadline passes the time it has LEFT, so the final attempt cannot outlive it. */
  readonly timeoutMs?: number;
}

/** Call a unary member by its WIRE TAG (`surface/<sibling>/<member>/<verb>`), with the
 *  member's own payload on the ENCODED side. */
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

/** The wire tag a padi MAP entry member is served at. */
const padiTag = (memberVerb: string): string =>
  `surface/${PADI_SURFACE_NAME}/${memberVerb}`;

/** Fold a padi entry-member input into the map's `{ mapKey, input }` wire envelope via
 *  the envelope's own `fold()` encoder — the ONE place the harness spells it. A
 *  VOID-input member passes no argument: `fold(mapKey, undefined)` omits the `input`
 *  field entirely, which is the representation the map's served schema declares for a
 *  void member. */
const padiPayload = (input: unknown): unknown => fold(PADI_HOST_KEY, input);

/** Call a padi entry-member procedure — `padiCall("lifecycle/killAll")`,
 *  `padiCall("chrome/setCanvasLayout", { id, layout })`. */
export function padiCall(
  memberVerb: string,
  input?: unknown,
  opts: RpcCallOptions = {},
): Promise<unknown> {
  return surfaceCall(padiTag(memberVerb), padiPayload(input), opts);
}

/** Read the FIRST frame of a padi entry CELL subscription and close it.
 *
 *  A cell's `get` is a SUBSCRIPTION, not a one-shot read: it opens with the current
 *  value and stays open for every later change. `Stream.runHead` takes that opening
 *  frame and INTERRUPTS the rest — interruption IS the unsubscribe — so this reads one
 *  snapshot without leaving a subscription behind. An EMPTY stream throws rather than
 *  answering `undefined` (`@kolu/surface/first-frame`'s `firstFrameOrThrow` stance): a
 *  re-served cell withholds its first frame until the authority's fold primes the
 *  mirror, so "the stream ended with no snapshot" is a broken link, never an empty
 *  value.
 *
 *  Spelled as an Effect rather than reached through `firstFrameOrThrow` because that
 *  reader owns its own `Effect.runPromise` edge — crossing it here would hand back a
 *  rejected Promise instead of the `Cause` {@link settle} classifies on, and the
 *  warming-up split ({@link isPadiWarmingUp}) is exactly that classification. */
export async function padiFirstFrame(
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
