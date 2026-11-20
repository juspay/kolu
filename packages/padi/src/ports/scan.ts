import { Effect } from "effect";
import {
  type ListenerRow,
  type ProcessRow,
  type SnapshotFacets,
  type SnapshotReading,
  type SnapshotSourceErrorRow,
  type SnapshotSourceFacet,
  type UnreadableRow,
  bakedOsFactsBin,
  snapshotFacetNames,
  snapshotHost,
} from "osfacts-client";
import {
  foldPorts,
  foldBinds,
  type PortFamily,
  type PortInfo,
  type PortScope,
  portCommand,
} from "@kolu/terminal-vocab/ports";
import type { HostListeners } from "@kolu/terminal-vocab/schema";

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

export type { ProcessRow };

const SCAN_ASK = {
  procs: true,
  ports: true,
  argv: true,
} as const satisfies SnapshotFacets;
const SCANNED = snapshotFacetNames(SCAN_ASK);

/** What a blind facet COSTS this scan: a `listener` we can no longer establish
 *  (the scan is blind), a `label` on one we still establish, or `nothing`. */
type BlindFacetCost = "listener" | "label" | "nothing";

const FACET_COST = {
  argv: "label",
  ports_unclaimed: "nothing",
  ports_uid: "nothing",
} as const satisfies Partial<Record<SnapshotSourceFacet, BlindFacetCost>>;

function blindFacetCost(facet: string): BlindFacetCost {
  return FACET_COST[facet as keyof typeof FACET_COST] ?? "listener";
}

export function sourceErrorsMessage(
  errors: readonly SnapshotSourceErrorRow[],
): string | null {
  const blinding = errors.filter(
    ({ facet }) =>
      SCANNED.source.includes(facet) && blindFacetCost(facet) === "listener",
  );
  return blinding.length === 0
    ? null
    : blinding
        .map(({ source, facet, code }) => `${source}[${facet}]=${code}`)
        .join(", ");
}

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

export function decodeNetworkAddress(hex: string): number[] {
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

export function unreadablePolicy(
  unreadable: readonly UnreadableRow[],
  rootPids: ReadonlySet<number>,
): {
  blindRoots: Set<number>;
  skipPids: Set<number>;
  exitedPids: Set<number>;
} {
  const skipPids = new Set<number>();
  const blindRoots = new Set<number>();
  const exitedPids = new Set<number>();
  for (const u of unreadable) {
    if (!SCANNED.unreadable.includes(u.facet)) continue;
    if (blindFacetCost(u.facet) === "label") continue;
    const exitRace = u.errno === "ENOENT" || u.errno === "ESRCH";
    skipPids.add(u.pid);
    if (exitRace) exitedPids.add(u.pid);
    else if (rootPids.has(u.pid)) blindRoots.add(u.pid);
  }
  return { blindRoots, skipPids, exitedPids };
}

export function osfactsBinPath(): string {
  try {
    return bakedOsFactsBin("KOLU_OSFACTS_BIN");
  } catch (err) {
    throw new PortScanError(
      "blind",
      err instanceof Error
        ? `${err.message} The port scan has no PATH fallback by design.`
        : "KOLU_OSFACTS_BIN is not set — the port scan has no PATH fallback by design.",
      { cause: err },
    );
  }
}

type ClassifiedBind = { port: number; scope: PortScope; family: PortFamily };

function classifyListeners(ports: readonly ListenerRow[]): {
  claimed: Array<ClassifiedBind & { pid: number }>;
  unclaimed: ClassifiedBind[];
} {
  const claimed: Array<ClassifiedBind & { pid: number }> = [];
  const unclaimed: ClassifiedBind[] = [];
  for (const l of ports) {
    const bind = {
      port: l.port,
      ...addressBind(decodeNetworkAddress(l.address)),
    };
    if (l.status === "claimed") claimed.push({ pid: l.pid, ...bind });
    else unclaimed.push(bind);
  }
  return { claimed, unclaimed };
}

export interface PortScan {
  byRoot: Map<number, PortInfo[] | "blind">;
  host: Extract<HostListeners, { status: "known" }>;
  unattributable: readonly { pid: number; port: number }[];
  ownerExited: readonly { pid: number; port: number }[];
}

export const EXITED_LISTENER_NAME = "(exited)";

function joinPorts(
  reading: SnapshotReading,
  rootPids: readonly number[],
  skipPids: ReadonlySet<number>,
  exitedPids: ReadonlySet<number>,
  blindRoots: ReadonlySet<number>,
): PortScan {
  const unclaimedBlind = reading.errors.some(
    ({ facet }) => facet === "ports_unclaimed",
  );
  const { claimed, unclaimed } = classifyListeners(reading.ports);
  const names = new Map(reading.procs.map((row) => [row.pid, row.name]));
  const argvs = new Map(reading.argv.map((row) => [row.pid, row.argv]));

  const byPid = new Map<number, PortInfo[]>();
  const unattributable: { pid: number; port: number }[] = [];
  const ownerExited: { pid: number; port: number }[] = [];
  for (const l of claimed) {
    if (skipPids.has(l.pid)) {
      if (exitedPids.has(l.pid)) ownerExited.push({ pid: l.pid, port: l.port });
      else unattributable.push({ pid: l.pid, port: l.port });
      continue;
    }
    if (!names.has(l.pid)) ownerExited.push({ pid: l.pid, port: l.port });
    const name = names.get(l.pid) ?? EXITED_LISTENER_NAME;
    const row: PortInfo = {
      port: l.port,
      name,
      command: portCommand(argvs.get(l.pid) ?? [], name),
      scope: l.scope,
      family: l.family,
    };
    const held = byPid.get(l.pid);
    if (held === undefined) byPid.set(l.pid, [row]);
    else held.push(row);
  }

  const byRoot = new Map<number, PortInfo[] | "blind">();
  const terminalPorts = new Set<number>();
  for (const [rootPid, pids] of partitionSubtrees(reading.procs, rootPids)) {
    for (const pid of pids) {
      for (const row of byPid.get(pid) ?? []) terminalPorts.add(row.port);
    }
    if (blindRoots.has(rootPid)) {
      byRoot.set(rootPid, "blind");
      continue;
    }
    const rows: PortInfo[] = [];
    for (const pid of pids) {
      const held = byPid.get(pid);
      if (held !== undefined) rows.push(...held);
    }
    byRoot.set(rootPid, foldPorts(rows));
  }

  return {
    byRoot,
    host: {
      status: "known",
      claimed: foldPorts([...byPid.values()].flat()).map((info) => ({
        ...info,
        heldByTerminal: terminalPorts.has(info.port),
      })),
      unclaimed: unclaimedBlind
        ? { status: "unknown" }
        : { status: "known", list: foldBinds(unclaimed) },
    },
    unattributable,
    ownerExited,
  };
}

export function portScanSupported(): boolean {
  return process.platform === "linux" || process.platform === "darwin";
}

export function scanPorts(
  rootPids: readonly number[],
): Effect.Effect<PortScan, PortScanError> {
  return Effect.suspend(() => {
    if (!portScanSupported()) {
      return Effect.fail(
        new PortScanError(
          "unsupported-platform",
          `port scan: unsupported platform '${process.platform}' — this reader supports linux and darwin only`,
        ),
      );
    }

    const resolveBin = Effect.try({
      try: osfactsBinPath,
      catch: (err) => {
        if (err instanceof PortScanError) return err;
        throw err;
      },
    });

    return Effect.flatMap(resolveBin, (bin) =>
      Effect.flatMap(
        Effect.mapError(
          snapshotHost(bin, SCAN_ASK),
          (err) =>
            new PortScanError("blind", `port scan: ${err.message}`, {
              cause: err,
            }),
        ),
        (reading) => foldScan(reading, rootPids),
      ),
    );
  });
}

export function foldScan(
  reading: SnapshotReading,
  rootPids: readonly number[],
): Effect.Effect<PortScan, PortScanError> {
  const sourceFailure = sourceErrorsMessage(reading.errors);
  if (sourceFailure !== null) {
    return Effect.fail(
      new PortScanError(
        "blind",
        `port scan: osfacts source failure (${sourceFailure})`,
      ),
    );
  }

  const { blindRoots, skipPids, exitedPids } = unreadablePolicy(
    reading.unreadable,
    new Set(rootPids),
  );
  return Effect.succeed(
    joinPorts(reading, rootPids, skipPids, exitedPids, blindRoots),
  );
}
