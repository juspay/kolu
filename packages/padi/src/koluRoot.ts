import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();

let daemonProcessId: string | undefined;

function requireDaemonProcessId(): string {
  if (daemonProcessId === undefined) {
    throw new Error(
      "daemonProcessId read before setDaemonProcessId() — the daemon's boot (padi's daemonMain) must inject it before ensureKoluRoot",
    );
  }
  return daemonProcessId;
}

export function koluRoot(): string {
  return join(runtimeRoot, `kolu-${requireDaemonProcessId()}`);
}

export function koluShellDir(): string {
  return join(koluRoot(), "shell");
}

export function koluScratchDir(): string {
  return join(koluRoot(), "scratch");
}

export function setDaemonProcessId(id: string): void {
  if (!id) throw new Error("setDaemonProcessId: empty");
  daemonProcessId = id;
}

export function ensureKoluRoot(): void {
  mkdirSync(koluShellDir(), { recursive: true, mode: 0o700 });
  mkdirSync(koluScratchDir(), { recursive: true, mode: 0o700 });
}

export function shutdownCleanup(): void {
  rmSync(koluRoot(), { recursive: true, force: true });
}
