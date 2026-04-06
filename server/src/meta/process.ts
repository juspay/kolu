/**
 * Process provider — detects and publishes the foreground process name.
 *
 * Polls node-pty's .process property (cross-platform: Linux via /proc,
 * macOS via sysctl) and publishes the basename to meta.process.
 */

import path from "node:path";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { log } from "../log.ts";

const POLL_INTERVAL_MS = 3_000;

/** node-pty may return a full path (e.g. `/nix/store/.../bin/opencode` on NixOS).
 *  Always normalize to the basename. */
function processBasename(proc: string): string {
  return path.basename(proc);
}

export function startProcessProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  let lastProcess: string | null = null;

  plog.info("started");

  function poll() {
    const processName = processBasename(entry.handle.process);
    if (processName !== lastProcess) {
      plog.info(
        { from: lastProcess, to: processName },
        "foreground process changed",
      );
      lastProcess = processName;
      updateMetadata(entry, terminalId, (m) => {
        m.process = processName;
      });
    }
  }

  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    plog.info("stopped");
  };
}
