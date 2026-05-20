/** kolu-pty — generic PTY primitives extracted from kolu-server.
 *
 *  Wraps node-pty + @xterm/headless to provide a transport-agnostic
 *  `PtyHandle` with OSC-driven cwd/title/preexec callbacks. The caller
 *  supplies an rc-file directory (so kolu-pty has no opinion on where
 *  its per-terminal scratch files live) and a TERM_PROGRAM_VERSION
 *  string (so the package has zero kolu-* deps). */

export {
  getScreenText,
  type Logger,
  type PtyHandle,
  spawnPty,
} from "./pty.ts";
export { configureNixShellEnv, NIX_ENV_WHITELIST } from "./shell.ts";
