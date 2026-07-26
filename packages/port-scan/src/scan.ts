/**
 * ONE pass that answers "what is each of these process subtrees serving?" by
 * asking the **osfacts** binary and joining its versioned TSV to the requested
 * root pids.
 *
 * The volatility this package hides is the OS itself — how a kernel will tell
 * you which processes hold listening sockets. That used to be two hand-rolled
 * readers (linux `/proc`, darwin a C libproc helper). Both are gone: osfacts
 * is the single OS touch, and this module is a TSV consumer.
 *
 * ## The discipline
 *
 *  - **No OS state between ticks.** Spawn, parse, join, emit, drop.
 *  - **Repartition from the CURRENT root pids every tick.**
 *  - **Attribution is the live ppid subtree** (osfacts `--roots` + the P table).
 *  - **A blind scan must never look like an empty one.** `PortScanError("blind")`
 *    when the pass could not answer; the sampler holds the last sample.
 *
 * ## Blindness policy (the sudo lesson)
 *
 * osfacts reports every unreadable pid as a `U` row with errno. Policy stays
 * here — the only layer that knows which pids were *asked about*:
 *
 *  - `U` for a **requested root** → throw `blind` (we cannot answer for that
 *    terminal; "no ports" would be a lie).
 *  - `U` for a **descendant** (e.g. `sudo` at its password prompt) → skip that
 *    pid; do not blind every terminal on the host.
 *  - `U` for a pid outside the ask → noise; ignore.
 *
 * ## Bake path
 *
 * `KOLU_OSFACTS_BIN` is the absolute path to the nix-built osfacts binary.
 * Required on both platforms. No `PATH` lookup, no env override — absent is a
 * crash (fail-fast). Baked by `koluEnv` onto the padi/kolu wrappers and the
 * dev shell.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@kolu/log";
import { foldPorts, isTcpPort } from "./ports.ts";
import type { PortFamily, PortInfo, PortScope } from "./ports.ts";

const execFileAsync = promisify(execFile);

/** How long osfacts may run before it is killed. Generous against the measured
 *  ~5–10 ms so a loaded box is not mistaken for a hang. */
export const PORT_SCAN_COMMAND_TIMEOUT_MS = 5_000;

/** Schema version this reader understands. Bump only with osfacts. */
export const OSFACTS_FORMAT_VERSION = 1;

export class PortScanError extends Error {
  constructor(
    readonly kind: "blind" | "unsupported-platform",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PortScanError";
  }
}

function errnoOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

// ── Process table + subtree partition ───────────────────────────────────

export interface ProcessRow {
  pid: number;
  ppid: number;
  name: string;
}

/** Partition the process table into one pid SET per requested ROOT pid. */
export function partitionSubtrees(
  table: readonly ProcessRow[],
  rootPids: readonly number[],
): Map<number, Set<number>> {
  const children = new Map<number, number[]>();
  for (const row of table) {
    const siblings = children.get(row.ppid);
    if (siblings === undefined) children.set(row.ppid, [row.pid]);
    else siblings.push(row.pid);
  }
  const alive = new Set(table.map((row) => row.pid));
  const subtrees = new Map<number, Set<number>>();
  for (const rootPid of rootPids) {
    const pids = new Set<number>();
    if (alive.has(rootPid)) {
      const queue = [rootPid];
      while (queue.length > 0) {
        const pid = queue.pop()!;
        if (pids.has(pid)) continue;
        pids.add(pid);
        for (const child of children.get(pid) ?? []) queue.push(child);
      }
    }
    subtrees.set(rootPid, pids);
  }
  return subtrees;
}

// ── Address classification (single judge) ───────────────────────────────

/** Decode a bind address printed in NETWORK order — what osfacts L rows emit. */
export function decodeNetworkAddress(hex: string): number[] {
  if ((hex.length !== 8 && hex.length !== 32) || !/^[0-9A-Fa-f]+$/.test(hex)) {
    throw new PortScanError(
      "blind",
      `port scan: "${hex}" is not a bind address (expected exactly 8 or 32 hex digits)`,
    );
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function mappedV4(bytes: readonly number[]): readonly number[] | undefined {
  if (bytes.length !== 16) return undefined;
  if (!bytes.slice(0, 10).every((b) => b === 0)) return undefined;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return undefined;
  return bytes.slice(12);
}

/** WHERE a socket is bound — the ONE judge for both platforms' raw bytes. */
export function addressBind(bytes: readonly number[]): {
  scope: PortScope;
  family: PortFamily;
} {
  const mapped = mappedV4(bytes);
  const v4 = bytes.length === 4 ? bytes : mapped;
  if (v4 !== undefined) {
    const scope = v4.every((b) => b === 0)
      ? "any"
      : v4[0] === 127
        ? "loopback"
        : "interface";
    return { scope, family: "v4" };
  }
  if (bytes.length === 16) {
    if (bytes.every((b) => b === 0)) return { scope: "any", family: "v6" };
    const isV6Loopback =
      bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
    return {
      scope: isV6Loopback ? "loopback" : "interface",
      family: "v6",
    };
  }
  throw new Error(
    `port-scan: a bind address of ${bytes.length} bytes is neither v4 nor v6 — the decoders cannot produce this.`,
  );
}

// ── osfacts TSV ─────────────────────────────────────────────────────────

interface OsfactsListener {
  pid: number;
  port: number;
  scope: PortScope;
  family: PortFamily;
}

export interface UnreadableRow {
  pid: number;
  errno: string;
}

/** Both tables + the mandatory unreadable section osfacts prints. */
export interface OsfactsReading {
  table: ProcessRow[];
  listeners: OsfactsListener[];
  unreadable: UnreadableRow[];
}

/**
 * Parse osfacts versioned TSV:
 *
 *     V→1
 *     P→<pid>→<ppid>→<name>
 *     L→<pid>→<port>→<hex address>   network-order raw bytes
 *     U→<pid>→<errno>
 *
 * Version mismatch refuses loudly. Every unreadable line throws.
 */
export function parseOsfactsOutput(body: string): OsfactsReading {
  const lines = body.split("\n");
  const first = lines[0] ?? "";
  const version = /^V\t(\d+)$/.exec(first);
  if (version === null) {
    throw new PortScanError(
      "blind",
      `port scan: osfacts did not begin with a version line (got ${JSON.stringify(first.slice(0, 40))})`,
    );
  }
  if (Number(version[1]) !== OSFACTS_FORMAT_VERSION) {
    throw new PortScanError(
      "blind",
      `port scan: osfacts speaks format ${version[1]}, this reader speaks ${OSFACTS_FORMAT_VERSION} — the baked binary and this build are from different sources`,
    );
  }

  const table: ProcessRow[] = [];
  const listeners: OsfactsListener[] = [];
  const unreadable: UnreadableRow[] = [];

  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const f = line.split("\t");
    if (f[0] === "P") {
      if (f.length !== 4) {
        throw new PortScanError(
          "blind",
          `port scan: unreadable osfacts process row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      const ppid = Number(f[2]);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
        throw new PortScanError(
          "blind",
          `port scan: osfacts process row has a non-numeric pid: ${line}`,
        );
      }
      table.push({ pid, ppid, name: f[3]! });
      continue;
    }
    if (f[0] === "L") {
      if (f.length !== 4) {
        throw new PortScanError(
          "blind",
          `port scan: unreadable osfacts listener row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      const port = Number(f[2]);
      if (!Number.isInteger(pid)) {
        throw new PortScanError(
          "blind",
          `port scan: osfacts listener row has a non-numeric pid: ${line}`,
        );
      }
      if (!isTcpPort(port)) {
        throw new PortScanError(
          "blind",
          `port scan: osfacts listener row carries no valid port: ${line}`,
        );
      }
      listeners.push({
        pid,
        port,
        ...addressBind(decodeNetworkAddress(f[3]!)),
      });
      continue;
    }
    if (f[0] === "U") {
      if (f.length !== 3) {
        throw new PortScanError(
          "blind",
          `port scan: unreadable osfacts U row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      if (!Number.isInteger(pid)) {
        throw new PortScanError(
          "blind",
          `port scan: osfacts U row has a non-numeric pid: ${line}`,
        );
      }
      const errno = f[2]!;
      if (errno === "") {
        throw new PortScanError(
          "blind",
          `port scan: osfacts U row has empty errno: ${line}`,
        );
      }
      unreadable.push({ pid, errno });
      continue;
    }
    throw new PortScanError(
      "blind",
      `port scan: unknown osfacts row tag ${JSON.stringify(f[0] ?? "")}: ${line}`,
    );
  }
  return { table, listeners, unreadable };
}

/**
 * Map osfacts `U` rows onto the scan's blindness policy (the sudo lesson +
 * the exit race).
 *
 * Pure so the suite pins it without an OS:
 *
 *  - root + EACCES/EPERM → fatal (`blind`) — we cannot answer for a root we
 *    were asked about and should own;
 *  - root + ENOENT/ESRCH → skip (dead root → empty ports, not an error);
 *  - non-root (any errno) → skip that pid (a `sudo` child must not empty
 *    every terminal's Ports section).
 */
export function unreadablePolicy(
  unreadable: readonly UnreadableRow[],
  rootPids: ReadonlySet<number>,
): { fatal: UnreadableRow | null; skipPids: Set<number> } {
  const skipPids = new Set<number>();
  let fatal: UnreadableRow | null = null;
  for (const u of unreadable) {
    const exitRace = u.errno === "ENOENT" || u.errno === "ESRCH";
    if (rootPids.has(u.pid)) {
      if (exitRace) {
        skipPids.add(u.pid);
      } else if (fatal === null) {
        fatal = u;
      }
    } else {
      skipPids.add(u.pid);
    }
  }
  return { fatal, skipPids };
}

// ── Bake path ───────────────────────────────────────────────────────────

/** Absolute path to the nix-built osfacts binary. Required; no PATH fallback. */
export function osfactsBinPath(): string {
  const v = process.env.KOLU_OSFACTS_BIN;
  if (!v) {
    throw new PortScanError(
      "blind",
      "KOLU_OSFACTS_BIN is not set — it must be baked to the nix-built osfacts store path (run under the Nix wrapper that sets it, or `nix develop`). The port scan has no PATH fallback by design.",
    );
  }
  return v;
}

// ── Join ────────────────────────────────────────────────────────────────

interface Listener {
  port: number;
  scope: PortScope;
  family: PortFamily;
}

async function joinSubtreePorts(
  table: readonly ProcessRow[],
  byPid: Map<number, Listener[]>,
  names: Map<number, string>,
  rootPids: readonly number[],
  skipPids: ReadonlySet<number>,
): Promise<Map<number, PortInfo[]>> {
  const out = new Map<number, PortInfo[]>();
  for (const [rootPid, pids] of partitionSubtrees(table, rootPids)) {
    const rows: PortInfo[] = [];
    for (const pid of pids) {
      if (skipPids.has(pid)) continue;
      const held = byPid.get(pid) ?? [];
      if (held.length === 0) continue;
      const name = names.get(pid) ?? String(pid);
      for (const l of held) {
        rows.push({
          port: l.port,
          scope: l.scope,
          family: l.family,
          name,
        });
      }
    }
    out.set(rootPid, foldPorts(rows));
  }
  return out;
}

// ── Entry point ─────────────────────────────────────────────────────────

export function portScanSupported(): boolean {
  return process.platform === "linux" || process.platform === "darwin";
}

/**
 * Scan once via osfacts and return listening ports per requested ROOT PID.
 *
 * Every requested pid is present in the result (empty array when its subtree
 * serves nothing). Throws `PortScanError` — `"blind"` for a pass that could
 * not see, `"unsupported-platform"` for a host that never can.
 */
export async function scanSubtreePorts(
  rootPids: readonly number[],
  opts: { log?: Logger } = {},
): Promise<Map<number, PortInfo[]>> {
  const _log = opts.log;
  if (rootPids.length === 0) return new Map();
  if (!portScanSupported()) {
    throw new PortScanError(
      "unsupported-platform",
      `port scan: unsupported platform '${process.platform}' — this reader supports linux and darwin only`,
    );
  }

  const bin = osfactsBinPath();
  const rootsArg = rootPids.join(",");
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      bin,
      ["snapshot", "--roots", rootsArg, "--procs", "--ports"],
      {
        timeout: PORT_SCAN_COMMAND_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
      },
    ));
  } catch (err) {
    throw new PortScanError(
      "blind",
      `port scan: \`${bin}\` failed (${errnoOf(err) ?? "non-zero exit"})`,
      { cause: err },
    );
  }

  const { table, listeners, unreadable } = parseOsfactsOutput(stdout);
  const rootSet = new Set(rootPids);
  const { fatal, skipPids } = unreadablePolicy(unreadable, rootSet);
  if (fatal !== null) {
    throw new PortScanError(
      "blind",
      `port scan: cannot inspect requested root pid ${fatal.pid} (${fatal.errno})`,
    );
  }

  const names = new Map(table.map((row) => [row.pid, row.name]));
  const byPid = new Map<number, Listener[]>();
  for (const l of listeners) {
    if (skipPids.has(l.pid)) continue;
    const held = byPid.get(l.pid);
    if (held === undefined) byPid.set(l.pid, [l]);
    else held.push(l);
  }

  return joinSubtreePorts(table, byPid, names, rootPids, skipPids);
}
