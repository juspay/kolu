#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function usage() {
  console.error(
    "usage: measure-chrome-procs.mjs --root-pid <pid> [--focus-pid <pid>] [--seconds <n>] [--out <path>]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let rootPid = null;
let focusPid = null;
let seconds = 10;
let out = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--root-pid") rootPid = Number(args[++i]);
  else if (arg === "--focus-pid") focusPid = Number(args[++i]);
  else if (arg === "--seconds") seconds = Number(args[++i]);
  else if (arg === "--out") out = args[++i];
  else usage();
}

if (!Number.isInteger(rootPid) || rootPid <= 0) usage();
if (focusPid !== null && (!Number.isInteger(focusPid) || focusPid <= 0)) usage();
if (!Number.isFinite(seconds) || seconds <= 0) usage();

const procRoot = "/proc";
const clockTicks = Number(
  spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout.trim(),
) || 100;

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function listPids() {
  return fs
    .readdirSync(procRoot)
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number);
}

function cmdline(pid) {
  const raw = readText(path.join(procRoot, String(pid), "cmdline"));
  return raw ? raw.replaceAll("\0", " ").trim() : "";
}

function comm(pid) {
  return readText(path.join(procRoot, String(pid), "comm"))?.trim() ?? "";
}

function stat(pid) {
  const text = readText(path.join(procRoot, String(pid), "stat"));
  if (!text) return null;
  const end = text.lastIndexOf(")");
  const rest = text.slice(end + 2).split(" ");
  return {
    ppid: Number(rest[1]),
    utime: Number(rest[11]),
    stime: Number(rest[12]),
  };
}

function childrenByParent() {
  const children = new Map();
  for (const pid of listPids()) {
    const s = stat(pid);
    if (!s) continue;
    if (!children.has(s.ppid)) children.set(s.ppid, []);
    children.get(s.ppid).push(pid);
  }
  return children;
}

function processTree(root) {
  const byParent = childrenByParent();
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of byParent.get(pid) ?? []) stack.push(child);
  }
  return [...seen].sort((a, b) => a - b);
}

function readCpu(pid) {
  const s = stat(pid);
  return s ? s.utime + s.stime : null;
}

function readMem(pid) {
  const rollup = readText(path.join(procRoot, String(pid), "smaps_rollup"));
  if (rollup) {
    const values = Object.fromEntries(
      [...rollup.matchAll(/^([A-Za-z_]+):\s+(\d+) kB$/gm)].map((match) => [
        match[1],
        Number(match[2]),
      ]),
    );
    return {
      rssKb: values.Rss ?? 0,
      pssKb: values.Pss ?? 0,
      privateKb: (values.Private_Clean ?? 0) + (values.Private_Dirty ?? 0),
      sharedKb: (values.Shared_Clean ?? 0) + (values.Shared_Dirty ?? 0),
      swapKb: values.Swap ?? 0,
    };
  }

  const status = readText(path.join(procRoot, String(pid), "status"));
  const rssKb = Number(status?.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0);
  return { rssKb, pssKb: 0, privateKb: 0, sharedKb: 0, swapKb: 0 };
}

function roleOf(pid) {
  const command = cmdline(pid);
  if (pid === rootPid) return "browser";
  const type = command.match(/--type=([^ ]+)/)?.[1];
  if (type === "renderer") return "renderer";
  if (type === "gpu-process") return "gpu";
  if (type === "zygote") return "zygote";
  if (type === "utility") {
    const utility = command.match(/--utility-sub-type=([^ ]+)/)?.[1];
    return utility ? `utility:${utility}` : "utility";
  }
  if (command.includes("chrome_crashpad_handler")) return "crashpad";
  return "other";
}

function aggregate(processes) {
  const zero = {
    rssKb: 0,
    pssKb: 0,
    privateKb: 0,
    sharedKb: 0,
    swapKb: 0,
    cpuJiffies: 0,
    cpuPercentOneCore: 0,
    count: 0,
  };
  return processes.reduce((acc, proc) => {
    acc.rssKb += proc.memory.rssKb;
    acc.pssKb += proc.memory.pssKb;
    acc.privateKb += proc.memory.privateKb;
    acc.sharedKb += proc.memory.sharedKb;
    acc.swapKb += proc.memory.swapKb;
    acc.cpuJiffies += proc.cpuDeltaJiffies;
    acc.cpuPercentOneCore += proc.cpuPercentOneCore;
    acc.count += 1;
    return acc;
  }, { ...zero });
}

function groupByRole(processes) {
  const groups = {};
  for (const proc of processes) {
    groups[proc.role] ??= [];
    groups[proc.role].push(proc);
  }
  return Object.fromEntries(
    Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, members]) => [role, aggregate(members)]),
  );
}

const pids = processTree(rootPid);
if (!pids.includes(rootPid)) {
  throw new Error(`root pid ${rootPid} is not readable`);
}

const start = new Map(pids.map((pid) => [pid, readCpu(pid)]));
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const elapsedSeconds = seconds;

const processes = pids
  .map((pid) => {
    const startTicks = start.get(pid);
    const endTicks = readCpu(pid);
    const cpuDeltaJiffies =
      startTicks === null || endTicks === null ? 0 : Math.max(0, endTicks - startTicks);
    return {
      pid,
      role: roleOf(pid),
      comm: comm(pid),
      cpuDeltaJiffies,
      cpuPercentOneCore: (cpuDeltaJiffies / clockTicks / elapsedSeconds) * 100,
      memory: readMem(pid),
      cmdline: cmdline(pid),
    };
  })
  .sort((a, b) => b.memory.pssKb - a.memory.pssKb);

const focus = focusPid
  ? processes.find((proc) => proc.pid === focusPid) ?? {
      pid: focusPid,
      missing: true,
    }
  : null;

const report = {
  measuredAt: new Date().toISOString(),
  host: os.hostname(),
  rootPid,
  focusPid,
  elapsedSeconds,
  clockTicks,
  cpuBasis: "percent of one CPU core",
  totals: aggregate(processes),
  byRole: groupByRole(processes),
  focus,
  processes,
};

const json = JSON.stringify(report, null, 2);
if (out) {
  fs.writeFileSync(out, `${json}\n`);
} else {
  console.log(json);
}
