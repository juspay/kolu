/**
 * padi's port scan — osfacts-client + kolu policy.
 *
 * The binary contract (spawn, V2 record parsing) lives in `osfacts-client`.
 * What lives HERE is kolu's opinion: classify bind addresses, map U rows to
 * blind-vs-empty (the sudo lesson), fold listeners per subtree, and read the
 * baked `KOLU_OSFACTS_BIN` path. The cadence is `./sampler.ts`.
 */

import {
  type ListenerRow,
  type OsfactsReading,
  type ProcessRow,
  type SourceErrorRow,
  type UnreadableRow,
  OsfactsClientError,
  snapshotSubtree,
} from "osfacts-client";
import {
  foldPorts,
  isTcpPort,
  type PortFamily,
  type PortInfo,
  type PortScope,
} from "@kolu/terminal-vocab/ports";

/** Same budget as the client default — exported so supervisor can match it. */
export { OSFACTS_COMMAND_TIMEOUT_MS as PORT_SCAN_COMMAND_TIMEOUT_MS } from "osfacts-client";

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

// ── Process table + subtree partition ───────────────────────────────────

export type { ProcessRow };

/** Render explicit source blindness for padi's fail-loud port policy. */
export function sourceErrorsMessage(
  errors: readonly SourceErrorRow[],
): string | null {
  return errors.length === 0
    ? null
    : errors.map(({ source, code }) => `${source}=${code}`).join(", ");
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
    `port scan: a bind address of ${bytes.length} bytes is neither v4 nor v6 — the decoders cannot produce this.`,
  );
}

// ── U-row policy (the sudo lesson) ──────────────────────────────────────

/**
 * Map osfacts `U` rows onto the scan's blindness policy.
 *
 *  - root + EACCES/EPERM → fatal (`blind`)
 *  - root + ENOENT/ESRCH → skip (dead root → empty ports)
 *  - non-root (any errno) → skip that pid (sudo child must not empty the host)
 */
export function unreadablePolicy(
  unreadable: readonly UnreadableRow[],
  rootPids: ReadonlySet<number>,
): { fatal: UnreadableRow | null; skipPids: Set<number> } {
  const skipPids = new Set<number>();
  let fatal: UnreadableRow | null = null;
  for (const u of unreadable) {
    if (u.facet !== "proc" && u.facet !== "ports") continue;
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

function classifyListeners(
  ports: readonly ListenerRow[],
): Array<{ pid: number; port: number; scope: PortScope; family: PortFamily }> {
  return ports.flatMap((l) => {
    if (l.status === "unclaimed") return [];
    if (!isTcpPort(l.port)) {
      throw new PortScanError(
        "blind",
        `port scan: listener carries no valid port: ${l.port}`,
      );
    }
    return [
      {
        pid: l.pid,
        port: l.port,
        ...addressBind(decodeNetworkAddress(l.address)),
      },
    ];
  });
}

function joinSubtreePorts(
  table: readonly ProcessRow[],
  listeners: ReturnType<typeof classifyListeners>,
  names: Map<number, string>,
  rootPids: readonly number[],
  skipPids: ReadonlySet<number>,
): Map<number, PortInfo[]> {
  const byPid = new Map<
    number,
    Array<{ port: number; scope: PortScope; family: PortFamily }>
  >();
  for (const l of listeners) {
    if (skipPids.has(l.pid)) continue;
    const held = byPid.get(l.pid);
    if (held === undefined) byPid.set(l.pid, [l]);
    else held.push(l);
  }

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
 * not see; `"unsupported-platform"` for a host that never can.
 */
export async function scanSubtreePorts(
  rootPids: readonly number[],
): Promise<Map<number, PortInfo[]>> {
  if (rootPids.length === 0) return new Map();
  if (!portScanSupported()) {
    throw new PortScanError(
      "unsupported-platform",
      `port scan: unsupported platform '${process.platform}' — this reader supports linux and darwin only`,
    );
  }

  const bin = osfactsBinPath();
  let reading: OsfactsReading;
  try {
    reading = await snapshotSubtree(bin, rootPids);
  } catch (err) {
    if (err instanceof OsfactsClientError) {
      throw new PortScanError("blind", `port scan: ${err.message}`, {
        cause: err,
      });
    }
    throw err;
  }

  const sourceFailure = sourceErrorsMessage(reading.errors);
  if (sourceFailure !== null) {
    throw new PortScanError(
      "blind",
      `port scan: osfacts source failure (${sourceFailure})`,
    );
  }

  const rootSet = new Set(rootPids);
  const { fatal, skipPids } = unreadablePolicy(reading.unreadable, rootSet);
  if (fatal !== null) {
    throw new PortScanError(
      "blind",
      `port scan: cannot inspect requested root pid ${fatal.pid} (${fatal.errno})`,
    );
  }

  const names = new Map(reading.procs.map((row) => [row.pid, row.name]));
  const listeners = classifyListeners(reading.ports);
  return joinSubtreePorts(reading.procs, listeners, names, rootPids, skipPids);
}
