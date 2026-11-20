import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DAEMON_BIND_PID_ENV } from "@kolu/surface-daemon";
import {
  type DaemonDriver,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { assertDaemonSpawnAllowed, KAVAL_GATE_FILE, kavalLogPath } from "kaval";
import { composeSpawnEnv } from "kolu-pty";

export function kavalGatePath(socketPath: string): string {
  return join(dirname(socketPath), KAVAL_GATE_FILE);
}

export function resolveKavalLaunch(socketPath: string): {
  binPath: string;
  args: string[];
} {
  const socketArgs = ["--socket", socketPath];

  const wrapper = process.env.KOLU_KAVAL_BIN;
  if (wrapper) return { binPath: wrapper, args: socketArgs };

  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const binTs = fileURLToPath(
    new URL("../../../kaval/src/bin.ts", import.meta.url),
  );
  return {
    binPath: process.execPath,
    args: ["--import", tsxLoader, binTs, ...socketArgs],
  };
}

function daemonOperationalExtras(): Record<string, string> {
  const extras: Record<string, string> = {};
  const nodeOptions = scrubDaemonNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) extras.NODE_OPTIONS = nodeOptions;
  const bindPid = process.env[DAEMON_BIND_PID_ENV];
  if (bindPid !== undefined) extras[DAEMON_BIND_PID_ENV] = bindPid;
  const diagDir = process.env.KOLU_DIAG_DIR;
  if (diagDir) extras.KOLU_DIAG_DIR = diagDir;
  return extras;
}

export function daemonEnv(): Record<string, string> {
  const allowlistBase = composeSpawnEnv(process.env);
  return { ...allowlistBase, ...daemonOperationalExtras() };
}

type KavalLaunchMode =
  | { readonly kind: "wrapper" }
  | { readonly kind: "wrapper-detached" }
  | { readonly kind: "from-source" };

function kavalLaunchMode(): KavalLaunchMode {
  if (!process.env.KOLU_KAVAL_BIN) return { kind: "from-source" };
  return process.env.KOLU_KAVAL_SPAWN === "detached"
    ? { kind: "wrapper-detached" }
    : { kind: "wrapper" };
}

function spineFromSource(
  mode: KavalLaunchMode,
): false | { inheritParentEnv: boolean } {
  switch (mode.kind) {
    case "wrapper":
      return false;
    case "wrapper-detached":
      return { inheritParentEnv: false };
    case "from-source":
      return { inheritParentEnv: true };
  }
}

export function localKavalDriver(socketPath: string): DaemonDriver {
  const { binPath, args } = resolveKavalLaunch(socketPath);
  const driver = survivableSpawnDriver({
    binPath,
    args,
    env: daemonEnv(),
    unitPrefix: "kaval",
    fromSource: spineFromSource(kavalLaunchMode()),
    stderrLog: kavalLogPath(socketPath),
  });
  return {
    spawn: Effect.suspend(() => {
      assertDaemonSpawnAllowed("a real kaval daemon");
      return driver.spawn;
    }),
  };
}
