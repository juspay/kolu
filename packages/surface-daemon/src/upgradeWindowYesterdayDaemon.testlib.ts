/** Process, socket, gate, and state fixture for a previous daemon generation. */

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { match } from "ts-pattern";
import { isHolderLive } from "./pidGate.ts";

/** Previous-generation gate bytes to plant beside the fixture socket. */
export type GateShape =
  | { kind: "current" }
  | { kind: "foreign"; content: string }
  | { kind: "absent" };

/** Consumer-owned persistence payload for a planted previous daemon. */
export type YesterdayStateInput =
  | { kind: "session"; session: unknown }
  | { kind: "conf"; conf: Record<string, unknown> };

/** Paths and typed payload handed to the consumer persistence writer. */
export interface YesterdayStatePlant {
  stateRoot: string;
  confPath: string;
  state: YesterdayStateInput;
}

type YesterdayDaemonBaseOptions = {
  label?: string;
  gate?: GateShape;
  withSocket?: boolean;
  /** Required consumer filenames — the framework has no daemon vocabulary. */
  gateFile: string;
  socketFile: string;
  /** Required consumer hook — keeps test-process policy out of this package. */
  assertSpawnAllowed: (label: string) => void;
  /** Required consumer hook — owns its real persistence format. */
  plantState: (plant: YesterdayStatePlant) => void | Promise<void>;
};

/** Fixture options with mutually exclusive session/conf persistence inputs. */
export type YesterdayDaemonOpts = YesterdayDaemonBaseOptions &
  (
    | { session?: unknown; conf?: never }
    | { session?: never; conf: Record<string, unknown> }
  );

/** Process arm planted by the previous-daemon fixture. */
export type YesterdayProcess =
  | { kind: "absent" }
  | { kind: "live"; child: ChildProcess; pid: number };

/** Listener arm planted by the previous-daemon fixture. */
export type YesterdayListener =
  | { kind: "absent" }
  | { kind: "listening"; server: Server };

/** Persistent-state arm planted by the previous-daemon fixture. */
export type YesterdayState =
  | { kind: "absent" }
  | { kind: "planted"; stateRoot: string; confPath: string };

/** Complete previous-daemon fixture with independently named resource arms. */
export interface YesterdayDaemon {
  dir: string;
  gatePath: string;
  socketPath: string;
  process: YesterdayProcess;
  listener: YesterdayListener;
  state: YesterdayState;
  dispose: () => Promise<void>;
}

function liveChild(assertSpawnAllowed: (label: string) => void): ChildProcess {
  assertSpawnAllowed("yesterday-daemon fixture child");
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 600_000)"], {
    stdio: "ignore",
  });
}

export async function plantYesterdayDaemon(
  opts: YesterdayDaemonOpts,
): Promise<YesterdayDaemon> {
  const dir = mkdtempSync(join(tmpdir(), opts.label ?? "yesterday-daemon-"));
  chmodSync(dir, 0o700);
  const gatePath = join(dir, opts.gateFile);
  const socketPath = join(dir, opts.socketFile);
  const gate = opts.gate ?? { kind: "current" };
  const withSocket = opts.withSocket ?? true;

  let child: ChildProcess | undefined;
  let pid: number | undefined;
  let server: Server | undefined;
  let stateRoot: string | undefined;
  let confPath: string | undefined;

  if (gate.kind !== "absent") {
    child = liveChild(opts.assertSpawnAllowed);
    if (child.pid === undefined) {
      throw new Error("yesterday-daemon fixture: child failed to start");
    }
    pid = child.pid;
  }
  match(gate)
    .with({ kind: "current" }, () =>
      writeFileSync(gatePath, `${pid}\n`, { mode: 0o600 }),
    )
    .with({ kind: "foreign" }, ({ content }) =>
      writeFileSync(gatePath, content, { mode: 0o600 }),
    )
    .with({ kind: "absent" }, () => {})
    .exhaustive();

  if (withSocket) {
    server = createServer((socket) =>
      socket.on("error", () => {
        // Accepted peers are deliberately unread fixture traffic; a peer reset
        // has no fixture state to repair and must not become an unhandled error.
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(socketPath, () => {
        server?.off("error", reject);
        resolve();
      });
    });
  }

  if (opts.conf !== undefined || opts.session !== undefined) {
    stateRoot = mkdtempSync(join(tmpdir(), "yesterday-state-"));
    chmodSync(stateRoot, 0o700);
    confPath = join(stateRoot, "config.json");
    await opts.plantState({
      stateRoot,
      confPath,
      state:
        opts.conf === undefined
          ? { kind: "session", session: opts.session }
          : { kind: "conf", conf: opts.conf },
    });
  }

  const daemonProcess: YesterdayProcess =
    child !== undefined && pid !== undefined
      ? { kind: "live", child, pid }
      : { kind: "absent" };
  const listener: YesterdayListener =
    server === undefined ? { kind: "absent" } : { kind: "listening", server };
  const state: YesterdayState =
    stateRoot !== undefined && confPath !== undefined
      ? { kind: "planted", stateRoot, confPath }
      : { kind: "absent" };

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    if (listener.kind === "listening") {
      await new Promise<void>((resolve) => {
        const owned = listener.server as Server & {
          closeAllConnections?: () => void;
        };
        owned.closeAllConnections?.();
        owned.close(() => resolve());
      });
    }
    if (daemonProcess.kind === "live" && isHolderLive(daemonProcess.pid)) {
      try {
        daemonProcess.child.kill("SIGKILL");
      } catch {
        // The process exited between the liveness probe and signal.
      }
      if (
        daemonProcess.child.exitCode === null &&
        daemonProcess.child.signalCode === null
      ) {
        await once(daemonProcess.child, "exit");
      }
    }
    rmSync(dir, { recursive: true, force: true });
    if (stateRoot !== undefined) {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  };
  return {
    dir,
    gatePath,
    socketPath,
    process: daemonProcess,
    listener,
    state,
    dispose,
  };
}
