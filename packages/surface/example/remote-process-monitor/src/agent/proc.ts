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
import { readFile, readdir } from "node:fs/promises";
import {
  hostname,
  platform,
  totalmem,
  freemem,
  loadavg,
  uptime,
} from "node:os";
import { promisify } from "node:util";
import type { Pid, Process, SystemInfo } from "../common/surface";

const exec = promisify(execCb);

export interface ProcReader {
  os: SystemInfo["os"];
  readSystem: () => Promise<SystemInfo>;
  readProcesses: () => Promise<Map<Pid, Process>>;
}

export function createProcReader(): ProcReader {
  const plat = platform();
  if (plat === "linux") return linuxReader();
  if (plat === "darwin") return darwinReader();
  return stubReader();
}

// ── Linux: /proc reader ─────────────────────────────────────────────────

function linuxReader(): ProcReader {
  return {
    os: "linux",
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
        state: "connected",
      };
    },
    readProcesses: async () => {
      const entries = await readdir("/proc");
      const pids = entries.filter((e) => /^\d+$/.test(e)).map((e) => Number(e));
      // Avoid /proc churn racing the read: ENOENT on a vanished pid is
      // expected — just skip it.
      const results = await Promise.allSettled(
        pids.map((pid) => readProcLinux(pid)),
      );
      const out = new Map<Pid, Process>();
      for (let i = 0; i < pids.length; i++) {
        const r = results[i];
        const pidValue = pids[i];
        if (r === undefined || pidValue === undefined) continue;
        if (r.status === "fulfilled" && r.value !== null)
          out.set(pidValue, r.value);
      }
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

const _bootMs = Date.now() - uptime() * 1000;

async function readProcLinux(pid: number): Promise<Process | null> {
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
    const procUptimeTicks = uptime() * 100 - startTime;
    const cpuPct =
      procUptimeTicks > 0 ? (100 * (utime + stime)) / procUptimeTicks : 0;
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
      cpuPct: round2(cpuPct),
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

function darwinReader(): ProcReader {
  return {
    os: "darwin",
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
        state: "connected",
      };
    },
    readProcesses: async () => {
      const { stdout } = await exec("ps -axo pid=,user=,pcpu=,pmem=,comm=");
      const out = new Map<Pid, Process>();
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const m = trimmed.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
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
  return {
    os: "unknown",
    readSystem: async () => {
      const la = loadavg();
      return {
        loadAvg: [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0],
        memUsed: totalmem() - freemem(),
        memTotal: totalmem(),
        uptime: uptime(),
        os: "unknown",
        hostname: hostname(),
        state: "connected",
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
