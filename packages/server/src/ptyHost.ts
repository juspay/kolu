/**
 * The single in-process pty-host for this kolu-server process — and the home of
 * kolu's **spawn policy** (B0, the kaval inversion).
 *
 * `servePtyHost`'s router is the transport-agnostic seam: this module builds
 * the host once and exposes both views of it —
 *   - `ptyHostClient` — the identity-link (`directLink`, no wire) client the
 *     `LocalTerminalBackend` (the web path) consumes;
 *   - `ptyHostServedRouter` — the same host's contract-wrapped router, which
 *     `index.ts` serves over a unix socket so `kolu-tui` (the raw CLI client)
 *     can reach the same PTYs.
 *
 * One PTY host, two transports, byte-identical handlers. Instantiating here
 * (rather than inside `local.ts`) keeps it a single shared instance — both
 * `local.ts` and the socket listener import from this one module, so the
 * pty-host can never be accidentally created twice.
 *
 * The pty-host is now **policy-free**: it spawns exactly the `{argv, env,
 * initFiles}` it is handed. Composing that — the Nix-devshell env filter,
 * kolu's identity vars, and the per-PTY OSC-hook rcfiles — is kolu's job and
 * lives here in `buildTerminalSpawnInput`, against the host's `system.info`.
 * Co-locating it with `configureNixShellEnv` (called once at startup in
 * `index.ts`) keeps `cleanEnv`'s whitelist and the composition in one process,
 * which is exactly what a later out-of-process daemon needs.
 */
import {
  createInProcessPtyHost,
  type PtyHostSpawnInput,
  type PtyHostSystemInfo,
} from "@kolu/pty-host";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import pkg from "../package.json" with { type: "json" };
import { koluShellDir } from "./koluRoot.ts";
import { log } from "./log.ts";

const ptyHost = createInProcessPtyHost({
  log,
  rcDir: koluShellDir,
});

/** The contract-wrapped router — served over the unix socket in `index.ts`
 *  for kolu-tui (and, later, a standalone daemon). */
export const ptyHostServedRouter = ptyHost.servedRouter;

/** The in-process (no-wire) client the LocalTerminalBackend consumes. */
export const ptyHostClient = ptyHost.client;

/** Host facts (shell, home, platform, rcDir) read once and cached — they're
 *  constant for the life of an in-process host. The promise is cached (not just
 *  its value) so concurrent first spawns share a single round-trip. */
let infoPromise: Promise<PtyHostSystemInfo> | undefined;
function hostInfo(): Promise<PtyHostSystemInfo> {
  infoPromise ??= ptyHostClient.surface.system.info({});
  return infoPromise;
}

/**
 * Compose the fully-specified spawn input the pty-host wire now expects, from
 * kolu's spawn policy applied against the host's facts. The env is layered
 * least → most authoritative, exactly as the host did before the inversion:
 *   1. `cleanEnv()`        — parent env passthrough (Nix devshell filter).
 *   2. `koluIdentityEnv()` — kolu's identity vars (stomp parent).
 *   3. `plan.env`          — per-PTY overrides (e.g. ZDOTDIR for zsh).
 *
 * **Local-host only, today.** The host this process talks to IS this process
 * (the in-process `directLink`), so `cleanEnv()`'s `env.SHELL`/`env.HOME` —
 * which describe *this* machine — are the right facts, and `system.info`'s
 * shell/home only matter as a fallback when the local env omits them (e.g.
 * systemd user services). `system.info.rcDir` (the host-side init-file dir) is
 * the one fact already consumed unconditionally, since the host owns that disk.
 *
 * The remaining facts (`shell`, `home`) are NOT yet remote-correct: a host this
 * process isn't running on would need its OWN shell/home/env to win over the
 * server's `cleanEnv()`, and that env basis isn't modeled here yet. Wiring a
 * remote host (R-2) must replace this `cleanEnv()`-wins layering with a
 * host-fact-first one (or an env basis carried on `system.info`); until then,
 * treat this composition as local-only.
 */
export async function buildTerminalSpawnInput(args: {
  id: string;
  cwd?: string;
}): Promise<PtyHostSpawnInput> {
  const info = await hostInfo();
  const env = cleanEnv();
  const shell = env.SHELL ?? info.shell;
  const home = env.HOME ?? info.home;
  const cwd = args.cwd || home || "/";
  Object.assign(env, koluIdentityEnv(pkg.version));
  const plan = prepareShellInit({
    shell,
    home,
    terminalId: args.id,
    rcDir: info.rcDir,
  });
  Object.assign(env, plan.env);
  return {
    id: args.id,
    argv: [shell, ...plan.args],
    cwd,
    env,
    initFiles: plan.initFiles,
    scrollback: DEFAULT_SCROLLBACK,
  };
}
