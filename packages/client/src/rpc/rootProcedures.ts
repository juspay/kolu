/**
 * kolu's ROOT procedures, as a typed callable face over the combined wire
 * dispatch.
 *
 * The sibling SURFACES get their typed faces from the framework
 * (`surfaceClients` walks each spec), but `server/info`, `daemon/restart` and
 * the five `hosts/*` verbs are not surface members — they are plain `Rpc`s in
 * `kolu-common/contract`'s {@link koluRootGroup}, multiplexed at the ROOT of the
 * same wire. Under oRPC they arrived for free on the nested `ContractRouterClient`
 * the link exposed; Effect RPC's namespace is FLAT (one tag per member, PLAN D1)
 * and its generated client types payloads on the make-in side (#13), so the
 * nesting a call site reads — `client.hosts.add({ host })` — is re-minted here
 * instead, from the contract's own schemas.
 *
 * This is the SAME shape `@kolu/surface`'s `buildSurfaceFace` mints for a
 * surface, one layer smaller: a tag-addressed unary ref per member, an `Effect`
 * at the leaf, typed by hand because a dynamically-assembled `RpcGroup` carries
 * no trustworthy type information (D2/#16).
 *
 * EFFECT-NATIVE, like the surface face's `client.effect.<ns>.<verb>` twin. It
 * used to hand back a `Promise` — the framework's one run edge, restated here
 * for the root tags — and every consumer therefore `await`ed a call it could not
 * bound, race or supersede. Now the ref IS the description: `useServerIdentity`
 * folds `server.info` into a boot program, `addHost` composes `hosts.add` with
 * the join-activation it must sequence after, and this module runs nothing at
 * all. The one run edge it held is gone from the allowlist.
 *
 * Wrong tags are unspellable: every tag is typed as a member of the contract's
 * own {@link ROOT_RPC_TAGS} tuple, so a typo — or a tag kolu-common stopped
 * declaring — is a compile error here rather than a 404 at the first call.
 */

import type { SurfaceCallFailure } from "@kolu/surface/client";
import type { SurfaceDispatch } from "@kolu/surface/link";
import type { Effect } from "effect";
import type {
  HostRef,
  ROOT_RPC_TAGS,
  ServerInfo,
  ViewerHost,
} from "kolu-common/contract";

/** One of the root wire tags `kolu-common/contract` declares. */
type RootRpcTag = (typeof ROOT_RPC_TAGS)[number];

/** A root call's effect. No root `Rpc` declares an error schema
 *  (`kolu-common/contract` — every one is `Rpc.make(tag, { payload?, success? })`),
 *  so the whole error channel is the framework's own {@link SurfaceCallFailure}:
 *  a transport death or a surface-vocabulary rejection, and nothing else. */
export type RootEffect<O> = Effect.Effect<O, SurfaceCallFailure>;

/** kolu's root (non-surface) procedures, nested for reading. */
export interface RootProcedures {
  readonly server: {
    /** Per-host branding the shell needs synchronously at boot. */
    readonly info: () => RootEffect<ServerInfo>;
  };
  readonly daemon: {
    /** Restart the local kaval daemon, preserving the session (B3.2). */
    readonly restart: () => RootEffect<void>;
  };
  readonly hosts: {
    /** WHICH of kolu's hosts the calling browser is sitting at, or `null`. */
    readonly viewer: () => RootEffect<ViewerHost>;
    readonly add: (input: HostRef) => RootEffect<void>;
    readonly remove: (input: HostRef) => RootEffect<void>;
    readonly reconnect: (input: HostRef) => RootEffect<void>;
    readonly renewDaemon: (input: HostRef) => RootEffect<void>;
  };
}

/** A unary ref at one root tag — lazy, so nothing dispatches until the caller
 *  runs it.
 *
 *  The payload crosses the {@link SurfaceDispatch} seam on its DECODED side (D2),
 *  which for every root member is the same shape the caller already holds (a
 *  `HostRef` carries a `HostKey`, whose encoded and decoded forms coincide), so
 *  nothing is decoded at this edge. `dispatch.unary` is typed `unknown → unknown`
 *  because the seam is deliberately erased (#16): the ONE cast below is where
 *  this file's hand-written types meet it, exactly as `buildSurfaceClient` casts
 *  its assembled record to `BoundProceduresFor<S>`.
 */
function unary<I, O>(
  dispatch: SurfaceDispatch,
  tag: RootRpcTag,
): (input: I) => RootEffect<O> {
  return (input) => dispatch.unary(tag, input) as RootEffect<O>;
}

/** Build the root procedure face over the combined wire dispatch
 *  (`conn.transport.dispatch`). */
export function rootProcedures(dispatch: SurfaceDispatch): RootProcedures {
  const voidPayload = <O>(tag: RootRpcTag): (() => RootEffect<O>) => {
    // `Rpc.make(tag)` with no `payload` declares `Schema.Void`, so the payload
    // this member carries is `undefined` — spelled once here rather than at each
    // of the three no-argument call sites.
    const call = unary<undefined, O>(dispatch, tag);
    return () => call(undefined);
  };
  return {
    server: { info: voidPayload<ServerInfo>("server/info") },
    daemon: { restart: voidPayload<void>("daemon/restart") },
    hosts: {
      viewer: voidPayload<ViewerHost>("hosts/viewer"),
      add: unary<HostRef, void>(dispatch, "hosts/add"),
      remove: unary<HostRef, void>(dispatch, "hosts/remove"),
      reconnect: unary<HostRef, void>(dispatch, "hosts/reconnect"),
      renewDaemon: unary<HostRef, void>(dispatch, "hosts/renewDaemon"),
    },
  };
}
