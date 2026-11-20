import { reExecAsDetachedDaemon } from "@kolu/surface-daemon";
import { padiStderrLogPath } from "../stateRoot.ts";

export function detachedPadiDaemonEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const { SSH_AUTH_SOCK: _linkOwnedSocket, ...rest } = env;
  return rest;
}

export function spawnDetachedPadi(stateRoot: string): void {
  reExecAsDetachedDaemon({
    stripArgs: ["--stdio"],
    env: detachedPadiDaemonEnv(),
    stderrLog: padiStderrLogPath(stateRoot),
  });
}
