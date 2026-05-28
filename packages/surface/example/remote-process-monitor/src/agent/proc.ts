/**
 * Cross-platform process + system info readers.
 *
 *   - `linux`: parse `/proc/<pid>/{stat,status,cmdline}` + `/proc/meminfo`
 *     + `/proc/loadavg`. Pure file reads, universally readable by the
 *     running user.
 *   - `darwin`: shell out to `ps -axo pid=,user=,pcpu=,pmem=,comm=` and
 *     `sysctl -n vm.loadavg hw.memsize`. The `ps` command is in every
 *     base install; sysctl reads are unprivileged.
 *
 * Universality is the point. The plan considered tailing logs and cut it
 * — no plain-text log file is universally readable, universally present,
 * and actively updating across darwin/linux in 2025. Process metrics
 * are.
 */

import { exec as execCb } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import {
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  totalmem,
  uptime,
} from "node:os";
import { promisify } from "node:util";
import type {
  CoreId,
  CpuCore,
  Pid,
  Process,
  SystemInfo,
} from "../common/surface";

const exec = promisify(execCb);

export interface ProcReader {
  os: SystemInfo["os"];
  readSystem: () => Promise<SystemInfo>;
  readProcesses: () => Promise<Map<Pid, Process>>;
  /** Per-core busy% since the last call. The first call seeds the
   *  baseline and returns 0% across the board (no delta to measure
   *  yet). Universally available via `node:os.cpus()` — same shape on
   *  linux and darwin. */
  readCpuCores: () => Map<CoreId, CpuCore>;
}

/** Closure that retains the previous `cpus()` snapshot for delta-busy
 *  computation. Per-core CPU usage is a *rate*, not a level — needs
 *  the previous tick's timing to compute. */
function createCpuCoresReader(): () => Map<CoreId, CpuCore> {
  let prev = cpus();
  return () => {
    const cur = cpus();
    const result = new Map<CoreId, CpuCore>();
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      const p = prev[i];
      if (c === undefined || p === undefined) continue;
      const idleDelta = c.times.idle - p.times.idle;
      const totalDelta =
        c.times.user +
        c.times.nice +
        c.times.sys +
        c.times.idle +
        c.times.irq -
        (p.times.user +
          p.times.nice +
          p.times.sys +
          p.times.idle +
          p.times.irq);
      const usagePct = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
      result.set(i, {
        usagePct: Math.round(usagePct * 10) / 10,
        speedMHz: c.speed,
        model: c.model.trim(),
      });
    }
    prev = cur;
    return result;
  };
}

export function createProcReader(): ProcReader {
  const plat = platform();
  if (plat === "linux") return linuxReader();
  if (plat === "darwin") return darwinReader();
  return stubReader();
}

// ── Linux: /proc reader ─────────────────────────────────────────────────

function linuxReader(): ProcReader {
  const readCpuCores = createCpuCoresReader();
  // Per-PID previous tick reading so we can compute "% of one core
  // during the last poll window" — the metric `top`/`htop` show.
  // Without this delta, dividing lifetime ticks by lifetime uptime
  // returns the process's *average* CPU usage since fork — which is
  // ~0 for any long-running mostly-idle daemon. round2 then snaps it
  // to 0.0 and every row in the UI reads dead. (`startTime` is the
  // PID's fork-time-in-ticks-since-boot; we use it as a tombstone so
  // pid recycling doesn't compute a delta against a different process'
  // counters.)
  const prevPid = new Map<number, { ticks: number; startTime: number }>();
  let prevWallMs = 0;
  return {
    os: "linux",
    readCpuCores,
    readSystem: async () => {
      const [loadAvgs, mem, up] = await Promise.all([
        readFile("/proc/loadavg", "utf-8").then((s) =>
          s.split(/\s+/).slice(0, 3).map(Number),
        ),
        readFile("/proc/meminfo", "utf-8").then(parseMeminfo),
        readFile("/proc/uptime", "utf-8").then((s) => Number(s.split(" ")[0])),
      ]);
      return {
        loadAvg: [loadAvgs[0] ?? 0, loadAvgs[1] ?? 0, loadAvgs[2] ?? 0],
        memUsed: mem.total - mem.available,
        memTotal: mem.total,
        uptime: up,
        os: "linux",
        hostname: hostname(),
      };
    },
    readProcesses: async () => {
      const entries = await readdir("/proc");
      const pids = entries.filter((e) => /^\d+$/.test(e)).map((e) => Number(e));
      // Avoid /proc churn racing the read: ENOENT on a vanished pid is
      // expected — just skip it.
      const results = await Promise.allSettled(
        pids.map((pid) => readProcLinuxRaw(pid)),
      );
      const nowMs = Date.now();
      // `USER_HZ` — kernel jiffies-per-second. The kernel reports
      // utime/stime in jiffies; we divide by Δseconds × USER_HZ to get
      // "fraction of a core during this window". `getconf CLK_TCK` is
      // 100 on every standard linux kernel build (it's a Kconfig at
      // CONFIG_HZ_100/250/300/1000 with 100 as the universal default).
      // Hardcoding it avoids an extra subprocess on every poll.
      const USER_HZ = 100;
      const winSec = prevWallMs > 0 ? (nowMs - prevWallMs) / 1000 : 0;
      const out = new Map<Pid, Process>();
      const seen = new Set<number>();
      for (let i = 0; i < pids.length; i++) {
        const r = results[i];
        const pid = pids[i];
        if (r === undefined || pid === undefined) continue;
        if (r.status !== "fulfilled" || r.value === null) continue;
        const raw = r.value;
        seen.add(pid);
        const prev = prevPid.get(pid);
        let cpuPct = 0;
        if (prev && prev.startTime === raw.startTime && winSec > 0) {
          const deltaTicks = raw.ticks - prev.ticks;
          cpuPct = (deltaTicks / (winSec * USER_HZ)) * 100;
          if (cpuPct < 0) cpuPct = 0;
        }
        prevPid.set(pid, { ticks: raw.ticks, startTime: raw.startTime });
        out.set(pid, {
          user: raw.user,
          cpuPct: round2(cpuPct),
          memPct: raw.memPct,
          command: raw.command,
        });
      }
      // Evict dead pids so the map doesn't grow without bound.
      for (const pid of prevPid.keys()) {
        if (!seen.has(pid)) prevPid.delete(pid);
      }
      prevWallMs = nowMs;
      return out;
    },
  };
}

interface MemInfo {
  total: number;
  available: number;
}

function parseMeminfo(s: string): MemInfo {
  const get = (key: string): number => {
    const m = s.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
    return m && m[1] !== undefined ? Number(m[1]) * 1024 : 0;
  };
  return { total: get("MemTotal"), available: get("MemAvailable") };
}

interface LinuxProcRaw {
  user: string;
  /** utime + stime, in clock ticks. */
  ticks: number;
  /** /proc/<pid>/stat field 22 — ticks-since-boot at fork; the
   *  tombstone we use to detect PID recycling between polls. */
  startTime: number;
  memPct: number;
  command: string;
}

async function readProcLinuxRaw(pid: number): Promise<LinuxProcRaw | null> {
  try {
    const [statRaw, statusRaw, cmdlineRaw] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf-8"),
      readFile(`/proc/${pid}/status`, "utf-8"),
      readFile(`/proc/${pid}/cmdline`, "utf-8"),
    ]);
    // /proc/<pid>/stat: see proc(5). After comm (in parens — may contain
    // spaces), fields are space-separated. utime + stime are fields 14-15
    // (0-indexed 13-14) AFTER the comm field.
    const commEnd = statRaw.lastIndexOf(")");
    const tail = statRaw.slice(commEnd + 2).split(" ");
    const utime = Number(tail[11] ?? 0);
    const stime = Number(tail[12] ?? 0);
    const startTime = Number(tail[19] ?? 0);
    const vmRssMatch = statusRaw.match(/^VmRSS:\s+(\d+)\s+kB/m);
    const rssKb =
      vmRssMatch && vmRssMatch[1] !== undefined ? Number(vmRssMatch[1]) : 0;
    const userMatch = statusRaw.match(/^Uid:\s+(\d+)/m);
    const uid =
      userMatch && userMatch[1] !== undefined ? Number(userMatch[1]) : 0;
    const total = totalmem();
    const memPct = total > 0 ? (100 * rssKb * 1024) / total : 0;
    const command =
      cmdlineRaw.length > 0
        ? cmdlineRaw.replace(/\0/g, " ").trim()
        : statRaw.slice(statRaw.indexOf("(") + 1, commEnd);
    return {
      user: userFromUid(uid),
      ticks: utime + stime,
      startTime,
      memPct: round2(memPct),
      command: truncate(command, 200),
    };
  } catch {
    return null;
  }
}

const uidNameCache = new Map<number, string>();
function userFromUid(uid: number): string {
  const cached = uidNameCache.get(uid);
  if (cached !== undefined) return cached;
  // Best-effort name resolution — /etc/passwd lookup synchronous would
  // block; just use uid as the display.
  const name = uid === 0 ? "root" : String(uid);
  uidNameCache.set(uid, name);
  return name;
}

// ── darwin: ps + sysctl reader ──────────────────────────────────────────

// Compiled once — matches `ps -axo pid=,user=,pcpu=,pmem=,comm=` output lines.
const PS_LINE_RE = /^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/;

function darwinReader(): ProcReader {
  const readCpuCores = createCpuCoresReader();
  return {
    os: "darwin",
    readCpuCores,
    readSystem: async () => {
      // os.loadavg() works on darwin; sysctl fallback only needed for
      // very old node versions.
      const la = loadavg();
      const total = totalmem();
      const free = freemem();
      return {
        loadAvg: [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0],
        memUsed: total - free,
        memTotal: total,
        uptime: uptime(),
        os: "darwin",
        hostname: hostname(),
      };
    },
    readProcesses: async () => {
      const { stdout } = await exec("ps -axo pid=,user=,pcpu=,pmem=,comm=");
      const out = new Map<Pid, Process>();
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const m = trimmed.match(PS_LINE_RE);
        if (!m) continue;
        const [, pidStr, user, cpu, mem, command] = m;
        if (!pidStr || !user || !cpu || !mem || !command) continue;
        out.set(Number(pidStr), {
          user,
          cpuPct: Number(cpu),
          memPct: Number(mem),
          command: truncate(command, 200),
        });
      }
      return out;
    },
  };
}

// ── Stub fallback (unknown OS / unsupported environment) ────────────────

function stubReader(): ProcReader {
  const readCpuCores = createCpuCoresReader();
  return {
    os: "unknown",
    readCpuCores,
    readSystem: async () => {
      const la = loadavg();
      return {
        loadAvg: [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0],
        memUsed: totalmem() - freemem(),
        memTotal: totalmem(),
        uptime: uptime(),
        os: "unknown",
        hostname: hostname(),
      };
    },
    readProcesses: async () => {
      // Surface the agent's own process so the demo still shows
      // something even on platforms without /proc or BSD ps.
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

// ── Tiny helpers ─────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
