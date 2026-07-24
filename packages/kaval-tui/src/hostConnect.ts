/**
 * `kaval-tui --host <ssh>` — the kaval-specific policy for the shared
 * Surface Remote one-shot dial. The framework owns probing, source-flake
 * resolution, provisioning, retry, and disposal; this leaf owns only the
 * consumer values that may change with kaval.
 */
import {
  dialAgentOnce,
  SURFACE_AGENT_FLAKE_REF_ENV,
} from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import type { ptyHostSurface } from "kaval";
import type { Connection } from "./connect.ts";

/** Dial and provision a remote kaval using the source baked into this CLI. */
export function connectPtyHostViaHost(host: string): Promise<Connection> {
  return dialAgentOnce<typeof ptyHostSurface.contract>({
    host,
    localEnv: composeSpawnEnv(process.env),
    binary: "kaval",
    agentFlakeRef: process.env[SURFACE_AGENT_FLAKE_REF_ENV],
    fatalPrefix: "kaval --stdio:",
  });
}
