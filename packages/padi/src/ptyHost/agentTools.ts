/**
 * Where padi's own client CLIs live — the toolchain every terminal padi spawns
 * must be able to run (`kaval-tui`, `padi-tui`, and the `kolu` whose `mcp` face
 * an agent's `.mcp.json` invokes).
 *
 * **Why this is a fact padi is TOLD, never one it derives.** The dirs must be
 * the ones from the SAME build as the running daemon — an agent inside a
 * terminal that drives its siblings speaks padi's wire, so a tool from a
 * different build is exactly the contract skew the daemon's staleKey machinery
 * exists to prevent. Only the build system knows that path, so it bakes it:
 *
 *   - **remote** — the provisioned agent closure's own wrapper sets it to its
 *     `$out/bin` (a self-reference, resolved at build time), so a padi reached
 *     over ssh reports the closure that was actually copied to that host. There
 *     is no env channel across `ssh`, and nothing to thread through argv: the
 *     binary that boots already carries the answer.
 *   - **local** — `koluBin` bakes it and `kolu-server` forwards it onto padi's
 *     spawn env, so a locally-supervised padi is stamped the same way.
 *
 * Absent (a from-source `just dev` / e2e padi, which has no wrapper to bake it)
 * the value is simply empty and terminals carry no injected tools — explicit
 * absence, not a guessed default. Deriving a path here instead — from
 * `process.execPath`, `argv[1]`, or a search of `PATH` — would be precisely the
 * silent-degradation fallback the repo forbids: it would resolve to the tsx
 * loader or to whatever build happens to be installed on the host, which is the
 * skew this indirection exists to make unspellable.
 */

import { AGENT_TOOLS_PATH_ENV } from "kolu-pty";

/** The tool dirs to put on every spawned terminal's `PATH`, highest priority
 *  first. Reads the colon-joined `KOLU_AGENT_TOOLS_PATH` (the same var stamped
 *  into the terminal, so the fact travels under one name); `[]` when unset or
 *  empty. `env` is injectable so the resolution is testable without touching
 *  the process env. */
export function resolveAgentToolsPath(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const raw = env[AGENT_TOOLS_PATH_ENV];
  if (raw == null || raw === "") return [];
  return raw.split(":").filter((dir) => dir !== "");
}
