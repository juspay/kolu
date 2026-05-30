/** `@kolu/pty-host` — the multi-client PTY-owner primitive + its wire contract.
 *
 *  A `node-pty` child + an `@xterm/headless` screen mirror + the VT-derived
 *  event taps (cwd via OSC 7, title via OSC 0/2, command-run via OSC 633,
 *  foreground via `tcgetpgrp`, exit), each fanned out through a bounded
 *  per-PTY channel. Owns ONLY the PTY — no git, PRs, agents, file tree, or
 *  transport. Env/shell-init prep is the caller's job (see `kolu-pty`).
 *
 *  `ptyHostSurface` is the typed contract for consuming a pty-host (the
 *  `PtyHost` interface projected onto a wire). In-process kolu-server consumes
 *  it through the identity link; the same contract rides a socket / ssh later.
 */

export {
  createPtyHost,
  type ForegroundSample,
  type PtyAttachment,
  type PtyHandle,
  type PtyHost,
  type PtyHostOptions,
  type PtyId,
  type PtyListEntry,
  type PtySpawnOpts,
  type PtySpawnResult,
} from "./ptyHost.ts";

// The pty-host wire contract — the surface, its version, and the
// compatibility check. `ptyHostSurface` is a VALUE export (not type-only):
// consumers do `typeof ptyHostSurface.contract` to type their client, which
// collapses to `unknown` under a type-only re-export.
export {
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
  ptyHostSurface,
  type PtyHostDataMsg,
  type PtyHostForegroundMsg,
  type PtyHostListEntry,
  type PtyHostSurface,
  type PtyHostSystemVersion,
} from "./ptyHostSurface.ts";
