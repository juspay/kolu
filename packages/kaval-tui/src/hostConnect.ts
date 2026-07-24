/**
 * `kaval-tui --host <ssh>` — the kaval-specific policy for the shared
 * Surface Remote one-shot dial. The framework owns probing, source-flake
 * resolution, provisioning, retry, and disposal; this leaf owns only the
 * consumer values that may change with kaval.
 */
import {
  type DialAgentOnceOptions,
  SURFACE_AGENT_FLAKE_REF_ENV,
} from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import type { ptyHostSurface } from "kaval";

/** Compose kaval's consumer-owned values for the shared one-shot dial. */
export function kavalHostDialOptions(
  host: string,
  env: NodeJS.ProcessEnv,
): DialAgentOnceOptions<typeof ptyHostSurface.contract> {
  return {
    host,
    localEnv: composeSpawnEnv(env),
    binary: "kaval",
    agentFlakeRef: env[SURFACE_AGENT_FLAKE_REF_ENV],
    fatalPrefix: "kaval --stdio:",
  };
}
