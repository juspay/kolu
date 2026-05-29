/** `@kolu/pty-host` — the multi-client PTY-owner primitive.
 *
 *  A `node-pty` child + an `@xterm/headless` screen mirror + the
 *  VT-derived event taps (cwd via OSC 7, title via OSC 0/2, command-run
 *  via OSC 633, exit, foregroundPid), each fanned out through a bounded
 *  {@link Channel}. Owns ONLY the PTY — no git, PRs, agents, file tree, or
 *  wire protocol. Env/shell-init prep is the caller's job (see `kolu-pty`).
 */

export {
  createPtyHost,
  getScreenText,
  type PtyAttachment,
  type PtyHandle,
  type PtyHost,
  type PtyHostOptions,
  type PtyId,
  type PtyListEntry,
  type PtySpawnOpts,
  type PtySpawnResult,
} from "./ptyHost.ts";
