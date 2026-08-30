/**
 * `kolu-rpc` — a one-shot, Node-side caller on kolu-server's REAL wire.
 *
 * The NixOS adoption VM tests (`nix/home/example/adoption/*.nix`) reach into a
 * running kolu the way a client does: create a terminal, send it input, drain the
 * bound padi, recycle kaval, restore a session. Until the Effect port they did that
 * with `curl -X POST /rpc/surface/<sibling>/<member>/<verb>` — oRPC's second,
 * request/response HTTP arm. That arm is GONE (see the note beside the ws upgrade in
 * `index.ts`): under Effect RPC every call rides the ONE ndjson socket at `/rpc/ws`,
 * carrying flat, tag-keyed messages. So every one of those POSTs answered 404, and
 * each site reported it as its own bounded-poll timeout — which is how a dead route
 * read as "no live upstream link after 30s" in CI.
 *
 * A shell cannot speak that socket, and hand-rolling its frames would be a second,
 * drifting copy of the wire contract. So the harness gets the SAME answer the
 * cucumber e2e got in W6 (`packages/tests/support/rpcWire.ts`): dial the product's
 * own transport — `websocketLink` from `@kolu/surface`, the exact link the browser
 * dials in `packages/client/src/wire.ts` — over the group the server actually serves.
 * Nothing about the server changes, and the harness cannot drift onto a route the
 * product does not have.
 *
 * ## Not a product face — the quarantine invariant
 *
 * HARNESS-ONLY. `kolu-rpc` must stay reachable ONLY as a flake package output the
 * VM tests name (`kolu.packages.<system>.kolu-rpc`). It must NOT enter the `kolu`
 * app closure, `koluAgentTools` / `agentToolPackages` (a terminal's PATH),
 * `padi-agent` (a remote host's closure), or `nix/home/module.nix`'s
 * `home.packages` — a debug caller that can place any wire call is not something a
 * user installs. Machine-checked by `wireCall.test.ts`'s "quarantine" block, which
 * reads the nix sources; the packaging site in `default.nix` carries the same rule.
 *
 * This is a LEAF: nothing in kolu-server imports it, so `bootKoluWeb`'s module graph
 * is untouched, and it is not a `kolu` subcommand (the argv faces live in
 * `packages/kolu-cli`, per that package's composition-root charter). It lives HERE
 * because the wire it dials is kolu-server's own and this package already carries
 * every dependency it needs. `wireCallMain.ts` is the argv entry Nix wraps as the
 * `kolu-rpc` binary (`default.nix`), which is what the VM tests put on PATH.
 *
 * ## Usage
 *
 * ```
 * kolu-rpc <http-base-url> <wire-tag> [payload-json] [--timeout-ms <n>]
 * ```
 *
 * The payload is the ENCODED side — byte-identical to the JSON body the retired HTTP
 * arm posted, minus oRPC's `{"json": …}` envelope. It is decoded through the
 * member's OWN payload schema before dispatch (the edge the typed client face owns),
 * so a padi map member still takes its `{ mapKey, input }` fold and a schema's
 * decoding defaults still apply. The success is printed to stdout as JSON, encoded
 * through the member's success schema; a failure prints the cause to stderr and
 * exits non-zero, so a caller's retry loop can quote WHY rather than guess.
 */

import { websocketLink } from "@kolu/surface/links/websocket";
import { mergeDisjointGroups } from "@kolu/surface/define";
import { surfaceWsUrl } from "@kolu/surface-app";
import { isStaleProcessClose } from "@kolu/surface-app/connect";
import { Cause, Effect, Exit, Schema } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { koluRootGroup, koluSurfaceGroup } from "kolu-common/contract";
import { padiHostMap } from "kolu-common/surfacesWithPadi";

/** The group this caller can spell — assembled from the SAME three sources
 *  `surface.ts` merges into `servedGroup` (the root procedures, kolu's own siblings,
 *  the padi host map), rather than importing `servedGroup` itself: that module
 *  constructs the `Conf` store at import, and a one-shot caller must not touch the
 *  server's on-disk state to place a call.
 *
 *  Because it is assembled rather than imported, it could DRIFT from what the server
 *  serves — a fourth source merged into `servedGroup` would leave this one short, and
 *  a caller would meet "no member is served at tag" for a tag that IS served.
 *  `wireCall.test.ts` pins the two tag sets EQUAL, which is why this is exported.
 *
 *  The cast mirrors the server's own: `RpcGroup` is INVARIANT in its element union,
 *  so a precisely-typed group is not assignable to the erased `RpcGroup<Rpc.Any>`
 *  every transport seam takes, even though every element IS an `Rpc.Any`. */
export const wireGroup = mergeDisjointGroups({
  root: koluRootGroup as unknown as RpcGroup.RpcGroup<Rpc.Any>,
  koluSurfaces: koluSurfaceGroup,
  padiMap: padiHostMap.group,
});

/** Default per-call bound. The link retries its dial forever in its own fiber, so a
 *  call against a server that is not up yet would park; every invocation is bounded,
 *  and a caller with its own budget passes `--timeout-ms`. */
const DEFAULT_TIMEOUT_MS = 30_000;

interface Args {
  readonly baseUrl: string;
  readonly tag: string;
  readonly payload: unknown;
  readonly timeoutMs: number;
}

const USAGE =
  "usage: kolu-rpc <http-base-url> <wire-tag> [payload-json] [--timeout-ms <n>]";

function die(message: string): never {
  process.stderr.write(`kolu-rpc: ${message}\n`);
  process.exit(1);
}

/** Parse argv by hand — this runs from a nix wrapper with no argv library on its
 *  runtime path, and the shape is three positionals plus one flag. */
export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--timeout-ms") {
      const raw = argv[i + 1];
      const parsed = Number(raw);
      if (raw === undefined || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--timeout-ms needs a positive number, got ${raw}`);
      }
      timeoutMs = parsed;
      i += 1;
      continue;
    }
    positional.push(arg);
  }
  const [baseUrl, tag, payloadJson] = positional;
  if (baseUrl === undefined || tag === undefined) throw new Error(USAGE);
  if (positional.length > 3) {
    throw new Error(`too many arguments — ${USAGE}`);
  }
  let payload: unknown;
  if (payloadJson !== undefined) {
    try {
      payload = JSON.parse(payloadJson);
    } catch (err) {
      throw new Error(
        `payload is not JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { baseUrl, tag, payload, timeoutMs };
}

/** Look a tag up in the served group, failing with the tag's own name — so a
 *  mistyped tag says so here instead of dying as an opaque defect inside Effect
 *  RPC's flat client, which resolves a call's schemas by lookup. */
export function rpcFor(tag: string): Rpc.AnyWithProps {
  const rpc = wireGroup.requests.get(tag);
  if (rpc === undefined) {
    const known = [...wireGroup.requests.keys()].sort().join("\n  ");
    throw new Error(
      `no member is served at tag "${tag}". Served tags:\n  ${known}`,
    );
  }
  // `Rpc.Any` hides the schemas the erased group's values carry; `AnyWithProps` is
  // the framework's own name for that same value WITH them — the widening every
  // by-tag caller needs to reach `payloadSchema` / `successSchema`.
  return rpc as Rpc.AnyWithProps;
}

/** Place the call `argv` names and print its answer. Exits non-zero (through
 *  {@link die}) on every failure — a bad argv, an unknown tag, a rejected payload, a
 *  timeout, or the call's own error — so a shell retry loop can quote WHY. */
export async function runWireCall(argv: readonly string[]): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
  let rpc: Rpc.AnyWithProps;
  let decoded: unknown;
  try {
    rpc = rpcFor(args.tag);
    decoded = Schema.decodeUnknownSync(
      rpc.payloadSchema as unknown as Schema.Codec<unknown, unknown>,
    )(args.payload);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }

  const link = await websocketLink({
    group: wireGroup,
    // A THUNK, as the browser passes: the link re-evaluates it on every re-dial.
    url: () => surfaceWsUrl(args.baseUrl),
    // The app's own close-code vocabulary — the same classifier the browser's link
    // gets, so a retirement means here what it means there.
    isTerminalClose: isStaleProcessClose,
  });
  try {
    // The abort becomes fiber INTERRUPTION, which runs the request's finalizers — so
    // a timed-out call tears its own in-flight request down rather than leaking it.
    const exit = await Effect.runPromiseExit(
      link.dispatch.unary(args.tag, decoded),
      {
        signal: AbortSignal.timeout(args.timeoutMs),
      },
    );
    if (Exit.isFailure(exit)) {
      const cause: Cause.Cause<unknown> = exit.cause;
      die(
        Cause.hasInterrupts(cause)
          ? `${args.tag}: timed out after ${args.timeoutMs}ms`
          : `${args.tag}: ${Cause.pretty(cause)}`,
      );
    }
    const encoded = Schema.encodeUnknownSync(
      rpc.successSchema as unknown as Schema.Codec<unknown, unknown>,
    )(exit.value);
    process.stdout.write(`${JSON.stringify(encoded ?? null)}\n`);
  } finally {
    await link.dispose();
  }
}
