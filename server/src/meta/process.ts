/**
 * Foreground process metadata provider — detects the active process in a terminal.
 *
 * On Linux, reads /proc/{shellPid}/stat to find the foreground process group
 * (tpgid), then reads /proc/{tpgid}/comm for the process name. When the
 * foreground process is the shell itself, reports null (idle).
 *
 * Limitations (Linux-only):
 * - Relies on /proc — not available on macOS
 * - Only reports the process group leader's name, not the full command line
 */

import fs from "node:fs";
import type { TerminalEntry } from "../terminals.ts";
import { emitMetadata } from "./index.ts";
import { log } from "../log.ts";

const POLL_INTERVAL_MS = 1_000;

/** Shells to filter out — when the foreground process is a shell, report null. */
const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "nu", "nushell"]);

/**
 * Parse /proc/{pid}/stat to extract tpgid (foreground process group ID).
 *
 * The comm field (field 2) is wrapped in parens and can contain spaces/parens,
 * so we find the last ')' and split from there. After the closing paren,
 * fields are space-separated starting at field 3. tpgid is field 8,
 * i.e. index 5 in the post-paren array.
 */
function getTpgid(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen === -1) return null;
    const fields = stat.slice(closeParen + 2).split(" ");
    // fields[0]=state, [1]=ppid, [2]=pgrp, [3]=session, [4]=tty_nr, [5]=tpgid
    const tpgid = parseInt(fields[5]!, 10);
    return Number.isNaN(tpgid) ? null : tpgid;
  } catch {
    return null;
  }
}

/** Read the process name from /proc/{pid}/comm. */
function getProcessName(pid: number): string | null {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return null;
  }
}

/** Get the foreground process name for a shell PID, or null if idle (shell is foreground). */
function getForegroundProcess(shellPid: number): string | null {
  const tpgid = getTpgid(shellPid);
  if (tpgid === null) return null;

  // Get the shell's own process group ID to compare
  // If tpgid matches the shell's pgid, the shell itself is in the foreground
  try {
    const stat = fs.readFileSync(`/proc/${shellPid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen === -1) return null;
    const fields = stat.slice(closeParen + 2).split(" ");
    // fields[2] = pgrp
    const shellPgrp = parseInt(fields[2]!, 10);
    if (tpgid === shellPgrp) return null; // Shell is foreground → idle
  } catch {
    return null;
  }

  const name = getProcessName(tpgid);
  if (!name) return null;

  // Filter out known shells (e.g. subshells)
  if (SHELLS.has(name)) return null;

  return name;
}

/**
 * Start the foreground process metadata provider for a terminal.
 * Polls /proc to detect the active foreground process and updates metadata.
 */
export function startProcessProvider(
  entry: TerminalEntry,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  let lastName: string | null = null;

  plog.info("started");

  function poll() {
    const name = getForegroundProcess(entry.handle.pid);

    if (name === lastName) return;
    lastName = name;

    // Don't overwrite a claude process — the Claude provider manages that
    if (name !== null && entry.metadata.process?.kind === "claude") {
      return;
    }

    if (name === null) {
      // Only clear if current process is generic (not claude)
      if (
        entry.metadata.process !== null &&
        entry.metadata.process.kind !== "claude"
      ) {
        entry.metadata.process = null;
        plog.debug("foreground process cleared");
        emitMetadata(entry, terminalId);
      }
    } else {
      entry.metadata.process = { kind: "generic", name };
      plog.debug({ name }, "foreground process detected");
      emitMetadata(entry, terminalId);
    }
  }

  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    plog.info("stopped");
  };
}
