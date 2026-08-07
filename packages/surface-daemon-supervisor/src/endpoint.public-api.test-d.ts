/**
 * Type-level pins on the supervisor's public face:
 *
 *  1. The boot-method trio is NOT on the public `Endpoint` type. A comment is
 *     not a lock — absence from the type is.
 *  2. **No member of `EndpointSpec` is Promise-shaped.** The two that were —
 *     `readProcessIdentity` and `readSocketHolders` — were the last, and they
 *     were Promise-shaped only because `osfacts-client` declared no `effect`
 *     dependency. It does now, so the spec is Effect-throughout and a
 *     Promise-returning inject is a compile error rather than a lift somebody
 *     has to remember to write. Prose could claim that; the two
 *     `@ts-expect-error`s below prove it, and they go green — which is a
 *     failure — the moment either seam widens back to tolerate a Promise.
 */
import { Effect } from "effect";
import { createEndpoint } from "./endpoint.ts";
import type { Endpoint, EndpointSpec } from "./endpoint.ts";
import { daemonBuild } from "@kolu/surface-daemon";

declare const home: {
  dir: string;
  gatePath: string;
  socketPath: string;
};

const endpoint: Endpoint<string, { id: string }> = createEndpoint({
  hostId: "local",
  home,
  readProcessIdentity: () => Effect.succeed(undefined),
  readSocketHolders: () => Effect.succeed({ kind: "none" as const }),
  policy: {
    capability: "not-drainable",
    baked: { contractVersion: "1.0", build: daemonBuild("x") },
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  },
  probe: () => Effect.succeed(null),
  driver: { spawn: Effect.void },
  connect: () =>
    Effect.succeed({
      client: "c",
      identity: { id: "i" },
      startedAt: 0,
      dispose: () => {},
      onClose: () => {},
    }),
  log: { debug() {}, info() {}, warn() {}, error() {} },
  onStatus: () => {},
});

// @ts-expect-error public Endpoint must not expose ensure()
endpoint.ensure();
// @ts-expect-error public Endpoint must not expose adoptOrEnsure()
endpoint.adoptOrEnsure();
// @ts-expect-error public Endpoint must not expose adoptOrSpawnOrRefuse()
endpoint.adoptOrSpawnOrRefuse();

// Public surface is callable
void endpoint.current();
void endpoint.policy;
void endpoint.probe;
void endpoint.log;

// The two OS-fact seams take Effects and ONLY Effects. A Promise-returning
// inject was legal until the client went Effect-native; each line below fails
// to fail if either seam widens back.
declare const promisedIdentity: () => Promise<{
  pid: number;
  startUnixUs: number;
}>;
declare const promisedHolders: () => Promise<{ kind: "none" }>;
// @ts-expect-error readProcessIdentity must not tolerate a Promise
const _identityInject: EndpointSpec<
  string,
  { id: string }
>["readProcessIdentity"] = promisedIdentity;
// @ts-expect-error readSocketHolders must not tolerate a Promise
const _holdersInject: EndpointSpec<
  string,
  { id: string }
>["readSocketHolders"] = promisedHolders;
void _identityInject;
void _holdersInject;
