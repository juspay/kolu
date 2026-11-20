import type { DialAgentOnceOptions } from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import { ptyHostSurface } from "kaval";

export function kavalHostDialOptions(
  host: string,
  env: NodeJS.ProcessEnv,
): DialAgentOnceOptions<typeof ptyHostSurface.spec> {
  return {
    surface: ptyHostSurface,
    host,
    localEnv: composeSpawnEnv(env),
    package: "kaval",
    binary: "kaval",
    fatalPrefix: "kaval --stdio:",
  };
}
