/** kolu-pty — shell-environment preparation for PTY spawning.
 *
 *  The PTY-owner primitive itself lives in `@kolu/pty-host`; this package
 *  is the layer that decides *what shell* to spawn and *with what env* —
 *  the Nix-devshell env filtering, kolu's identity vars, and the per-PTY
 *  wrapper rc-file that replays user dotfiles and injects kolu's OSC hooks
 *  (OSC 7 cwd, OSC 2 title, OSC 633 command marks). Callers compose these
 *  and hand the result — a fully-specified spawn — over the pty-host wire.
 *  `prepareShellInit` is pure: it *plans* the wrapper rcfiles (name + content)
 *  but the pty-host writes them on the disk it owns.
 *
 *  Only depends on Node's stdlib — no node-pty, no xterm. */

export {
  cleanEnv,
  configureNixShellEnv,
  type InitFile,
  koluIdentityEnv,
  NIX_ENV_WHITELIST,
  prepareShellInit,
  type ShellInitPlan,
} from "./shell.ts";
