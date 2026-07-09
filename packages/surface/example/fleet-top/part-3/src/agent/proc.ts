/**
 * The `top` data source — cross-platform, dependency-free.
 *
 *   - cells (`load`, `memory`): `node:os` gives the load averages, cpu count,
 *     and memory totals on every platform, so both cells read from there.
 *   - `processes`: on linux we parse `/proc/<pid>/{stat,status,cmdline}` (pure
 *     unprivileged file reads); elsewhere we surface just this process so the
 *     demo still shows a live row.
 *
 * The reader is deliberately simple — the tutorial is about the *surface*, not
 * about being a perfect htop. `cpuPct` is a real per-window rate on linux (it
 * keeps the previous tick's ticks to diff against) and 0 on the fallback.
 */

import { readdir, readFile } from "node:fs/promises";
import { cpus, freemem, loadavg, platform, totalmem } from "node:os";
import type { Load, Memory, Pid, Process } from "../common/surface";

export interface TopReader {
  readLoad(): Load;
  readMemory(): Promise<Memory>;
  readProcesses(): Promise<Map<Pid, Process>>;
}

export function createTopReader(): TopReader {
  return platform() === "linux" ? linuxReader() : fallbackReader();
}

// ── Shared cell readers (identical across platforms) ─────────────────────

function readLoad(): Load {
  const la = loadavg();
  return { avg: [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0], cores: cpus().length };
}

// ── linux: /proc reader ──────────────────────────────────────────────────

function linuxReader(): TopReader {
  // Previous per-pid cpu ticks, so cpuPct is "busy during the last window",
  // not the process's lifetime average. Keyed by pid; `startTime` tombstones
  // pid reuse.
  const prev = new Map<number, { ticks: number; startTime: number }>();
  let prevWallMs = 0;
  const USER_HZ = 100; // getconf CLK_TCK — 100 on standard kernels.

  return {
    readLoad,
    readMemory: async () => {
      const info = await readFile("/proc/meminfo", "utf-8");
      const kb = (key: string): number => {
        const m = info.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
        return m && m[1] !== undefined ? Number(m[1]) * 1024 : 0;
      };
      const total = kb("MemTotal");
      return { used: total - kb("MemAvailable"), total };
    },
    readProcesses: async () => {
      const entries = await readdir("/proc");
      const pids = entries.filter((e) => /^\d+$/.test(e)).map(Number);
      const raws = await Promise.allSettled(pids.map(readLinuxProc));
      const nowMs = Date.now();
      const winSec = prevWallMs > 0 ? (nowMs - prevWallMs) / 1000 : 0;
      const out = new Map<Pid, Process>();
      const seen = new Set<number>();
      for (let i = 0; i < pids.length; i++) {
        const r = raws[i];
        const pid = pids[i];
        if (r === undefined || pid === undefined) continue;
        if (r.status !== "fulfilled" || r.value === null) continue;
        const raw = r.value;
        seen.add(pid);
        const before = prev.get(pid);
        let cpuPct = 0;
        if (before && before.startTime === raw.startTime && winSec > 0) {
          const dTicks = raw.ticks - before.ticks;
          cpuPct = Math.max(0, (dTicks / (winSec * USER_HZ)) * 100);
        }
        prev.set(pid, { ticks: raw.ticks, startTime: raw.startTime });
        out.set(pid, {
          user: raw.user,
          cpuPct: round2(cpuPct),
          memPct: raw.memPct,
          command: raw.command,
        });
      }
      for (const pid of [...prev.keys()]) if (!seen.has(pid)) prev.delete(pid);
      prevWallMs = nowMs;
      return out;
    },
  };
}

interface LinuxProcRaw {
  user: string;
  ticks: number;
  startTime: number;
  memPct: number;
  command: string;
}

async function readLinuxProc(pid: number): Promise<LinuxProcRaw | null> {
  try {
    const [stat, status, cmdline] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf-8"),
      readFile(`/proc/${pid}/status`, "utf-8"),
      readFile(`/proc/${pid}/cmdline`, "utf-8"),
    ]);
    // proc(5): after `comm` (parenthesised, may contain spaces) the fields are
    // space-separated. utime/stime are fields 14/15, starttime is field 22.
    const commEnd = stat.lastIndexOf(")");
    const tail = stat.slice(commEnd + 2).split(" ");
    const utime = Number(tail[11] ?? 0);
    const stime = Number(tail[12] ?? 0);
    const startTime = Number(tail[19] ?? 0);
    const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    const rssKb =
      rssMatch && rssMatch[1] !== undefined ? Number(rssMatch[1]) : 0;
    const uidMatch = status.match(/^Uid:\s+(\d+)/m);
    const uid = uidMatch && uidMatch[1] !== undefined ? Number(uidMatch[1]) : 0;
    const total = totalmem();
    const command =
      cmdline.length > 0
        ? cmdline.replace(/\0/g, " ").trim()
        : stat.slice(stat.indexOf("(") + 1, commEnd);
    return {
      user: uid === 0 ? "root" : String(uid),
      ticks: utime + stime,
      startTime,
      memPct: round2(total > 0 ? (100 * rssKb * 1024) / total : 0),
      command: command.length <= 200 ? command : `${command.slice(0, 199)}…`,
    };
  } catch {
    return null;
  }
}

// ── Fallback (darwin / anything without /proc) ───────────────────────────

function fallbackReader(): TopReader {
  return {
    readLoad,
    readMemory: async () => ({
      used: totalmem() - freemem(),
      total: totalmem(),
    }),
    readProcesses: async () => {
      const out = new Map<Pid, Process>();
      out.set(process.pid, {
        user: process.env.USER ?? "unknown",
        cpuPct: 0,
        memPct: 0,
        command: `${process.execPath} ${process.argv.slice(1).join(" ")}`,
      });
      return out;
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
