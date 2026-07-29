/**
 * Type-level pin: the boot-method trio is NOT on the public Endpoint type.
 * A comment is not a lock — absence from the type is.
 */
import { createEndpoint } from "./endpoint.ts";
import type { Endpoint } from "./endpoint.ts";
import { daemonBuild } from "@kolu/surface-daemon";

declare const home: {
  dir: string;
  gatePath: string;
  socketPath: string;
};

const endpoint: Endpoint<string, { id: string }> = createEndpoint({
  hostId: "local",
  home,
  policy: {
    capability: "not-drainable",
    baked: { contractVersion: "1.0", build: daemonBuild("x") },
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  },
  probe: async () => null,
  driver: { spawn: async () => {} },
  connect: async () => ({
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
