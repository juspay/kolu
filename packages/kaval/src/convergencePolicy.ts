import {
  type ConvergencePolicy,
  daemonBuild,
} from "@kolu/surface-daemon-supervisor";
import { currentPtyHostIdentity } from "./buildId.ts";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";

export function kavalConvergencePolicy(): ConvergencePolicy<"not-drainable"> {
  return {
    capability: "not-drainable",
    baked: {
      contractVersion: PTY_HOST_CONTRACT_VERSION,
      build: daemonBuild(currentPtyHostIdentity().staleKey),
    },
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  };
}
