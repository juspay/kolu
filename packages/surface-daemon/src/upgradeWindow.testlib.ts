/**
 * Dependency-free test kit for mixed-version daemon windows.
 *
 * This subpath intentionally imports only Node builtins and relative types.
 * Consumer-specific filenames, registries, state writers, and spawn guards
 * are injected so a second daemon can use the kit without pulling kolu's test
 * packages or on-disk conventions into its source hydration closure.
 */

import { throws } from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isHolderLive } from "./pidGate.ts";
import type { SharedArtifact } from "./sharedArtifact.ts";

// ── Shared-artifact registry matchers + watchdog ────────────────────────────

export function knownDiskBasenames(
  registry: readonly SharedArtifact[],
): Set<string> {
  const names = new Set<string>();
  for (const artifact of registry) {
    for (const name of artifact.diskBasenames) names.add(name);
  }
  return names;
}

export function matchesSharedArtifact(
  registry: readonly SharedArtifact[],
  name: string,
): boolean {
  const base = basename(name);
  const exact = knownDiskBasenames(registry);
  if (exact.has(base) || exact.has(name)) return true;
  for (const artifact of registry) {
    for (const pattern of artifact.diskBasenamePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(base)) return true;
      pattern.lastIndex = 0;
      if (pattern.test(name)) return true;
    }
  }
  return false;
}

export function isSharedArtifactLog(
  registry: readonly SharedArtifact[],
  name: string,
): boolean {
  const base = basename(name);
  for (const artifact of registry) {
    if (artifact.role !== "log") continue;
    if (artifact.diskBasenames.includes(base)) return true;
    for (const pattern of artifact.diskBasenamePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(base)) return true;
      pattern.lastIndex = 0;
      if (pattern.test(name)) return true;
    }
  }
  return (
    base.endsWith(".log") ||
    base.endsWith(".log.old") ||
    /^[\w.-]+\.log\.\d+$/.test(base)
  );
}

export function listRelativeFilesUnder(root: string): string[] {
  const names = readdirSync(root, {
    recursive: true,
    encoding: "utf8",
  }) as string[];
  return names.filter((name) => {
    const stat = statSync(join(root, name));
    return stat.isFile() || stat.isSocket();
  });
}

export function unknownProtocolFilesOnDisk(
  registry: readonly SharedArtifact[],
  ...roots: readonly string[]
): string[] {
  const unknown: string[] = [];
  for (const name of roots.flatMap(listRelativeFilesUnder)) {
    if (isSharedArtifactLog(registry, name)) continue;
    if (matchesSharedArtifact(registry, name)) continue;
    unknown.push(name);
  }
  return unknown.sort();
}

export function unknownSharedFileMessage(
  registry: readonly SharedArtifact[],
  unknown: readonly string[],
): string {
  const registered = new Set(registry.map((artifact) => artifact.id));
  return (
    `Unknown shared on-disk artifact(s) under the daemon roots:\n` +
    unknown.map((name) => `  - ${name}`).join("\n") +
    `\n\nAdd an entry to the consumer's shared-artifact registry ` +
    `(currently ${registered.size} entries) with diskBasenames: [` +
    `"${unknown[0] ?? "…"}"] and a disposition test that plants version+1 ` +
    `and observes a typed state. A versionField alone is not coverage.`
  );
}

export type SharedArtifactWatchdog = {
  coverageGaps(testFiles: ReadonlySet<string>): string[];
  assertInventory(ids: readonly string[]): void;
};

/** Factory over any consumer registry. A version field never excuses a missing
 * disposition test: `coveredByTest` must name a real suite for every protocol
 * artifact, including versioned ones. */
export function createSharedArtifactWatchdog(
  registry: readonly SharedArtifact[],
): SharedArtifactWatchdog {
  return {
    coverageGaps(testFiles) {
      const gaps: string[] = [];
      for (const artifact of registry) {
        if (artifact.role === "log") continue;
        if (artifact.coveredByTest === null) {
          gaps.push(
            `${artifact.id} (${artifact.pathShape}): register a disposition test; ` +
              `versionField=${artifact.versionField ?? "none"} does not prove the version+1 reader outcome`,
          );
          continue;
        }
        if (!testFiles.has(artifact.coveredByTest)) {
          gaps.push(
            `${artifact.id}: coveredByTest="${artifact.coveredByTest}" does not exist`,
          );
        }
      }
      return gaps;
    },
    assertInventory(ids) {
      const registered = new Set(registry.map((artifact) => artifact.id));
      const missing = ids.filter((id) => !registered.has(id));
      if (missing.length > 0) {
        throw new Error(
          `shared-artifact registry is missing required ids: ${missing.join(", ")}`,
        );
      }
    },
  };
}

// ── Yesterday-daemon fixture ────────────────────────────────────────────────

export type GateShape =
  | { kind: "current" }
  | { kind: "foreign"; content: string }
  | { kind: "absent" };

export interface YesterdayStatePlant {
  stateRoot: string;
  confPath: string;
  session: unknown;
  conf: Record<string, unknown> | undefined;
}

export interface YesterdayDaemonOpts {
  label?: string;
  gate?: GateShape;
  withSocket?: boolean;
  session?: unknown;
  conf?: Record<string, unknown>;
  /** Required consumer filenames — the framework has no daemon vocabulary. */
  gateFile: string;
  socketFile: string;
  /** Required consumer hook — keeps test-process policy out of this package. */
  assertSpawnAllowed: (label: string) => void;
  /** Required consumer hook — owns its real persistence format. */
  plantState: (plant: YesterdayStatePlant) => void | Promise<void>;
}

export type YesterdayProcess =
  | { kind: "absent" }
  | { kind: "live"; child: ChildProcess; pid: number };

export type YesterdayListener =
  | { kind: "absent" }
  | { kind: "listening"; server: Server };

export type YesterdayState =
  | { kind: "absent" }
  | { kind: "planted"; stateRoot: string; confPath: string };

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
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 600_000)"],
    { stdio: "ignore" },
  );
  if (child.pid === undefined) {
    throw new Error("yesterday-daemon fixture: child failed to start");
  }
  return child;
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
    pid = child.pid as number;
  }
  switch (gate.kind) {
    case "current":
      writeFileSync(gatePath, `${pid}\n`, { mode: 0o600 });
      break;
    case "foreign":
      writeFileSync(gatePath, gate.content, { mode: 0o600 });
      break;
    case "absent":
      break;
    default: {
      const _exhaustive: never = gate;
      throw new Error(`unreachable gate shape: ${JSON.stringify(_exhaustive)}`);
    }
  }

  if (withSocket) {
    server = createServer((socket) => socket.on("error", () => {}));
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
      session: opts.session,
      conf: opts.conf,
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

// ── Previous-release harness ────────────────────────────────────────────────

const VERSION_TAG = /^v\d+\.\d+\.\d+$/;

export interface PreviousReleaseWindow {
  ref: string;
  previousStore: string;
  currentStore: string;
}

export function assertPreviousReleaseWindow(
  window: PreviousReleaseWindow,
): void {
  if (!VERSION_TAG.test(window.ref)) {
    throw new Error(
      `previous ref must be a version tag (vX.Y.Z), got ${window.ref}`,
    );
  }
  if (window.previousStore.length === 0 || window.currentStore.length === 0) {
    throw new Error("previous and current store paths must both be set");
  }
  if (window.previousStore === window.currentStore) {
    throw new Error(
      `mixed-version window collapsed: previous store equals current (${window.previousStore})`,
    );
  }
}

export async function waitForSocket(
  socketPath: string,
  probe: (path: string) => Promise<void>,
  ms = 60_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await probe(socketPath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(
    `socket never ready at ${socketPath}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export interface ProcessReaper {
  track(child: ChildProcess): ChildProcess;
  dispose(): Promise<void>;
}

export function createProcessReaper(graceMs = 2000): ProcessReaper {
  const children = new Set<ChildProcess>();
  return {
    track(child) {
      children.add(child);
      child.once("exit", () => children.delete(child));
      return child;
    },
    async dispose() {
      for (const child of [...children]) {
        if (child.exitCode === null && child.signalCode === null) {
          const gracefulExit = once(child, "exit", {
            signal: AbortSignal.timeout(graceMs),
          });
          try {
            child.kill("SIGTERM");
          } catch {
            // Already gone.
          }
          try {
            await gracefulExit;
          } catch (error) {
            if (!(error instanceof Error) || error.name !== "AbortError") {
              throw error;
            }
          }
        }
        if (child.exitCode === null && child.signalCode === null) {
          const forcedExit = once(child, "exit");
          try {
            child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
          await forcedExit;
        }
      }
      children.clear();
    },
  };
}

export async function runPreviousReleaseWindow<
  W extends PreviousReleaseWindow,
>(opts: {
  window: W;
  newReadsOld: (window: W) => void | Promise<void>;
  oldReadsNew: (window: W) => void | Promise<void>;
}): Promise<void> {
  assertPreviousReleaseWindow(opts.window);
  await opts.newReadsOld(opts.window);
  await opts.oldReadsNew(opts.window);
}

// ── Pure test patterns ──────────────────────────────────────────────────────

export function pinPreviousShapeRecovery<T>(opts: {
  previous: unknown;
  irrecoverable: unknown;
  recover: (value: unknown) => unknown;
  parse: (value: unknown) => T;
  assertRecovered: (value: T) => void;
}): void {
  throws(
    () => opts.parse(opts.previous),
    "previous shape must require recovery",
  );
  opts.assertRecovered(opts.parse(opts.recover(opts.previous)));
  throws(
    () => opts.parse(opts.recover(opts.irrecoverable)),
    "irrecoverable shape must refuse",
  );
}

export function assertRecipeWired(
  justfile: string,
  recipe: string,
  tokens: readonly (string | RegExp)[],
): void {
  const lines = justfile.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^${recipe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`).test(line),
  );
  if (start < 0) throw new Error(`recipe ${recipe} is missing`);
  const tail = lines.slice(start).join("\n");
  const next = tail.search(/\n[a-zA-Z][a-zA-Z0-9_-]*:/);
  const body = next === -1 ? tail : tail.slice(0, next);
  const missing = tokens.filter((token) =>
    typeof token === "string" ? !body.includes(token) : !token.test(body),
  );
  if (missing.length > 0) {
    throw new Error(
      `recipe ${recipe} is missing required token(s): ${missing.join(", ")}`,
    );
  }
}
