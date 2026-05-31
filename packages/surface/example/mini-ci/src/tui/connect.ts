/**
 * Connect the TUI to a runner over stdio — local child or remote ssh.
 *
 * Both paths end in the same `stdioLink<typeof surface.contract>` call;
 * only the subprocess differs. The returned client is the raw
 * `ContractRouterClient` (no Solid hooks — this is a Node CLI), consumed by
 * iterating `client.surface.nodes.get({})` etc.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { stdioLink } from "@kolu/surface/links/stdio";
import { isLocalHost } from "@kolu/surface-nix-host";
import type { surface } from "../common/surface";
import {
  buildLocalRunnerCommand,
  buildRemoteRunnerCommand,
  buildShipCommand,
  type LocalOptions,
  type RemoteOptions,
} from "./transport";

export type RunnerClient = ReturnType<
  typeof stdioLink<typeof surface.contract>
>;

export interface Connection {
  client: RunnerClient;
  /** Terminate the runner subprocess. */
  dispose(): void;
}

/** Local mode: spawn the runner as a child and link to its stdio. */
export function connectLocal(opts: LocalOptions = {}): Connection {
  const { command, args } = buildLocalRunnerCommand(opts);
  // stderr inherited so the runner's diagnostics surface in the terminal.
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  return linkChild(child);
}

/** Remote mode: ship the flake source with `git archive | ssh tar -x`, then
 *  `nix run` the runner on the host over ssh and link to it. A `localhost`
 *  target short-circuits to the local path — no point shipping source to
 *  ourselves (mirrors `buildAgentCommand`'s own `isLocalHost` branch). */
export async function connectRemote(opts: RemoteOptions): Promise<Connection> {
  if (isLocalHost(opts.host)) {
    return connectLocal({ pipeline: opts.pipeline });
  }
  await shipSource(opts);
  const { command, args } = buildRemoteRunnerCommand(opts);
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  return linkChild(child);
}

function linkChild(child: ChildProcess): Connection {
  if (child.stdin === null || child.stdout === null) {
    throw new Error("mini-ci: runner subprocess has no stdin/stdout");
  }
  const client = stdioLink<typeof surface.contract>({
    read: child.stdout,
    write: child.stdin,
  });
  return {
    client,
    dispose: () => {
      child.kill("SIGTERM");
    },
  };
}

/** Pipe `git archive HEAD` into `ssh host 'tar -x -C dir'`. */
function shipSource(opts: RemoteOptions): Promise<void> {
  const { archive, extract } = buildShipCommand(opts);
  return new Promise<void>((resolve, reject) => {
    const git = spawn(archive.command, archive.args, {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const ssh = spawn(extract.command, extract.args, {
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (git.stdout === null || ssh.stdin === null) {
      reject(new Error("mini-ci: ship pipe has no stdio"));
      return;
    }
    git.stdout.pipe(ssh.stdin);
    git.on("error", reject);
    ssh.on("error", reject);
    ssh.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`mini-ci: source ship failed (ssh tar exit ${code})`));
    });
  });
}
