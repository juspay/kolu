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
import { updateProcess } from "./index.ts";
import { log } from "../log.ts";

const POLL_INTERVAL_MS = 1_000;

/** Shells to filter out — when the foreground process is a shell, report null. */
const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "nu", "nushell"]);

/**
 * Parse the fields after the comm in /proc/{pid}/stat.
 *
 * The comm field (field 2) is wrapped in parens and can contain spaces/parens,
 * so we find the last ')' and split from there. After the closing paren,
 * fields are space-separated starting at field 3:
 *   [0]=state, [1]=ppid, [2]=pgrp, [3]=session, [4]=tty_nr, [5]=tpgid
 */
function parseProcStat(pid: number): string[] | null {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = raw.lastIndexOf(")");
    if (closeParen === -1) return null;
    return raw.slice(closeParen + 2).split(" ");
  } catch {
    return null;
  }
}

function parseField(fields: string[], index: number): number | null {
  const n = parseInt(fields[index]!, 10);
  return Number.isNaN(n) ? null : n;
}

/** Get the foreground process name for a shell PID, or null if idle (shell is foreground). */
function getForegroundProcess(shellPid: number): string | null {
  const fields = parseProcStat(shellPid);
  if (!fields) return null;

  const pgrp = parseField(fields, 2);
  const tpgid = parseField(fields, 5);
  if (tpgid === null) return null;

  // Shell itself is the foreground process group → idle
  if (tpgid === pgrp) return null;

  // Read the foreground process group leader's name
  try {
    const name = fs.readFileSync(`/proc/${tpgid}/comm`, "utf8").trim();
    return SHELLS.has(name) ? null : name;
  } catch {
    return null;
  }
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

  plog.info("started");

  function poll() {
    const name = getForegroundProcess(entry.handle.pid);
    if (name === entry.processName) return;

    entry.processName = name;
    plog.debug(name ? { name } : {}, name ? "detected" : "cleared");
    updateProcess(entry, terminalId);
  }

  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    plog.info("stopped");
  };
}
