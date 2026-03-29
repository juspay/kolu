/**
 * Foreground process metadata provider — detects the active process in a terminal.
 *
 * Linux: reads /proc/{shellPid}/stat to find the foreground process group
 * (tpgid), then reads /proc/{tpgid}/comm for the process name.
 *
 * macOS: finds direct children of the shell via `pgrep -P`, then checks
 * their stat flags via `ps` for the foreground indicator (+).
 *
 * When the foreground process is the shell itself, reports null (idle).
 */

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { TerminalEntry } from "../terminals.ts";
import { updateProcess } from "./index.ts";
import { log } from "../log.ts";

const POLL_INTERVAL_MS = 1_000;

/** Shells to filter out — when the foreground process is a shell, report null. */
const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "nu", "nushell"]);

// ── Linux: /proc-based detection ──

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

function getForegroundProcessLinux(shellPid: number): string | null {
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

// ── macOS: ps-based detection ──

/**
 * Find the foreground child process of a shell on macOS.
 *
 * 1. `pgrep -P <shellPid>` — find direct children of the shell
 * 2. `ps -o stat=,comm= -p <pids>` — get stat flags and command name
 * 3. Look for '+' in stat (indicates foreground process group member)
 */
function getForegroundProcessDarwin(shellPid: number): string | null {
  try {
    const children = execFileSync("pgrep", ["-P", String(shellPid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    if (!children) return null;

    const pids = children.split("\n").join(",");
    const result = execFileSync("ps", ["-o", "stat=,comm=", "-p", pids], {
      encoding: "utf8",
      timeout: 2000,
    });

    for (const line of result.trim().split("\n")) {
      if (!line.trim()) continue;
      // stat contains '+' for foreground process group members
      const match = line.trim().match(/^(\S+)\s+(.+)$/);
      if (match && match[1]!.includes("+")) {
        const name = path.basename(match[2]!.trim());
        if (!SHELLS.has(name)) return name;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Platform dispatch ──

function getForegroundProcess(shellPid: number): string | null {
  if (process.platform === "linux") return getForegroundProcessLinux(shellPid);
  if (process.platform === "darwin")
    return getForegroundProcessDarwin(shellPid);
  return null;
}

/**
 * Start the foreground process metadata provider for a terminal.
 * Polls to detect the active foreground process and updates metadata.
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
