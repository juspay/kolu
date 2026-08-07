/**
 * `kaval-tui --host <ssh>` — the kaval-specific policy for the shared
 * Surface Remote one-shot dial. The framework owns probing, source-flake
 * resolution, provisioning, retry, and disposal; this leaf owns only the
 * consumer values that may change with kaval.
 */
import type { DialAgentOnceOptions } from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import { ptyHostSurface } from "kaval";

/** Compose kaval's consumer-owned values for the shared one-shot dial. */
export function kavalHostDialOptions(
  host: string,
  env: NodeJS.ProcessEnv,
): DialAgentOnceOptions<typeof ptyHostSurface.spec> {
  return {
    // The surface is a VALUE the dial needs now, not a type it can infer:
    // `stdioLink` builds its wire from `surface.group` and the face from
    // `surface.spec`/`tagPrefix`, so the dialled face and the daemon's served
    // group are provably the same tag set instead of two derivations.
    surface: ptyHostSurface,
    host,
    localEnv: composeSpawnEnv(env),
    // Closure and binary are the same attr here: `kaval-tui --host` deliberately
    // provisions the bare daemon, and spawns terminals with its own minimal env
    // rather than padi's spawn policy. Stated, not defaulted — a host kolu has
    // already provisioned with `padi-agent` therefore realises a SECOND closure
    // when reached this way, and that asymmetry should be visible to whoever
    // next reads this file.
    package: "kaval",
    binary: "kaval",
    fatalPrefix: "kaval --stdio:",
  };
}
