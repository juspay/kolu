/**
 * padi's port scan — osfacts-client + kolu policy.
 *
 * The binary contract (spawn, V2 record parsing) lives in `osfacts-client`.
 * What lives HERE is kolu's opinion: classify bind addresses, map U rows to
 * blind-vs-empty (the sudo lesson), fold listeners per subtree AND for the whole
 * host, and read the baked `KOLU_OSFACTS_BIN` path. The cadence is `./sampler.ts`.
 *
 * ## Why the pass is host-wide
 *
 * It used to ask only for the terminals' subtrees (`--roots`), which is the cheap
 * question and the wrong one the moment a server detaches. `odu web-daemon`,
 * anything started under `setsid`, a double-forked dev server: each reparents to
 * init, leaves every subtree, and keeps answering. The terminal that started it
 * then printed a URL kolu called "nothing is listening yet" — a claim about the
 * machine made from a look at one branch of its process tree.
 *
 * So ONE host-wide read serves both questions: the per-terminal partition is the
 * same walk over a larger table, and the host list is the fold of every row. Two
 * reads (a subtree pass plus a host pass) would cost more than the one and could
 * disagree with each other about a listener that bound between them.
 *
 * The price is measured, not assumed: on a linux box with ~900 processes a
 * host-wide `--procs --ports --argv` pass took ~35 ms against ~9 ms for the
 * subtree ask. The sampler's nudge floor is derived from the pass duration
 * (`nudgeFloorMs`), so the wider read pays for itself in its own cadence rather
 * than becoming a hot loop.
 */

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

/**
 * The ask. The folds need the process table (to walk subtrees and name owners),
 * the listeners, and each owner's argv (the command line a detached server is
 * recognised by) — nothing else. `argv` costs ~nothing on top of `--procs`: both
 * read the same per-pid directory.
 *
 * This is the SINGLE statement of what this scan reads: it is passed to
 * `snapshotHost` *and* run through `snapshotFacetNames` to get the wire
 * facet names the gates below use. Those two used to be one hand-written
 * literal each, in two vocabularies (camelCase flags vs snake_case wire
 * names), with nothing keeping them in step — so widening the ask silently
 * left the gate covering the old set.
 */
const SCAN_ASK = {
  procs: true,
  ports: true,
  argv: true,
} as const satisfies SnapshotFacets;
const SCANNED = snapshotFacetNames(SCAN_ASK);

/**
 * Facets the ask names that only LABEL a listener, never establish one.
 *
 * `argv` is the command line a row is shown by. A pid whose argv could not be
 * read still holds its socket, so neither its unreadability (a `U` row) nor a
 * blind argv source may drop the listener — that would trade a fact for a
 * label, and a terminal's dev server would vanish from its Ports section over a
 * string. Such a row is shown by its program name instead (see `joinPorts`).
 */
const LABEL_FACETS = ["argv"] as const satisfies readonly SnapshotSourceFacet[];

/**
 * Facets the ask names whose blindness costs this scan no fact.
 *
 * Both are darwin listener honesty rows, not lost listeners.
 * `ports_unclaimed` is what macOS 27 gates when it hides the host-wide socket
 * table: every claimed listener survives via the same-uid fd walk, so treating
 * it as blindness would black out port detection on that whole platform while
 * the facts sat in hand. It is not IGNORED, though: the host list's unclaimed
 * half reports `unknown` for that pass (see {@link foldScan}), because the
 * sockets it costs are exactly the ones that half is made of. `ports_uid` says
 * only that darwin cannot name a socket's owning uid — a field no fold reads.
 *
 * The osfacts contract is explicit: a source error is not an instruction to
 * discard facts that did arrive.
 */
const TOLERATED_SOURCE_FACETS: readonly SnapshotSourceFacet[] = [
  "ports_unclaimed",
  "ports_uid",
  ...LABEL_FACETS,
];

/** Render explicit source blindness for padi's fail-loud port policy. */
export function sourceErrorsMessage(
  errors: readonly SnapshotSourceErrorRow[],
): string | null {
  const blinding = errors.filter(
    ({ facet }) =>
      SCANNED.source.includes(facet) &&
      !TOLERATED_SOURCE_FACETS.includes(facet),
  );
  return blinding.length === 0
    ? null
    : blinding
        .map(({ source, facet, code }) => `${source}[${facet}]=${code}`)
        .join(", ");
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

/**
 * Decode a bind address printed in NETWORK order — what osfacts `L` rows emit.
 *
 * No format re-validation here, for the same reason `classifyListeners` does
 * not re-check the port: `parseSnapshotOutput` already refuses any `L` row
 * whose address is not exactly 8 or 32 lowercase hex digits, so a second copy
 * of that rule would be unreachable and would have to be found twice to relax.
 * It had already drifted — the client narrowed its rule to lowercase and this
 * copy still accepted uppercase.
 */
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
 *  - root + EACCES/EPERM → that ROOT is blind (its terminal cannot be answered)
 *  - root + ENOENT/ESRCH → skip (dead root → empty ports)
 *  - non-root (any errno) → skip that pid (sudo child must not empty the host)
 *
 * A blind root costs its own terminal and nothing else. The pass is host-wide, so
 * one terminal rooted in another user's process (a `sudo -i` as the PTY's first
 * command) must not freeze every other terminal's ports and the host's listener
 * list — the fold of every OTHER pid never needed that root.
 */
export function unreadablePolicy(
  unreadable: readonly UnreadableRow[],
  rootPids: ReadonlySet<number>,
): { blindRoots: Set<number>; skipPids: Set<number> } {
  const skipPids = new Set<number>();
  const blindRoots = new Set<number>();
  for (const u of unreadable) {
    if (!SCANNED.unreadable.includes(u.facet)) continue;
    // A label facet's unreadability costs a label, not the pid — see LABEL_FACETS.
    if ((LABEL_FACETS as readonly string[]).includes(u.facet)) continue;
    const exitRace = u.errno === "ENOENT" || u.errno === "ESRCH";
    skipPids.add(u.pid);
    if (rootPids.has(u.pid) && !exitRace) blindRoots.add(u.pid);
  }
  return { blindRoots, skipPids };
}

// ── Bake path ───────────────────────────────────────────────────────────

/** Absolute path to the nix-built osfacts binary. Required; no PATH fallback.
 *  Resolution is shared ({@link bakedOsFactsBin}); this wrapper keeps the
 *  port-scan-domain error type callers of the sampler already depend on. */
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

// ── Join ────────────────────────────────────────────────────────────────

type ClassifiedBind = { port: number; scope: PortScope; family: PortFamily };

/** Split the listener rows by who holds them, each bind classified once. */
function classifyListeners(ports: readonly ListenerRow[]): {
  claimed: Array<ClassifiedBind & { pid: number }>;
  unclaimed: ClassifiedBind[];
} {
  // No port re-validation here: `parseSnapshotOutput` already refuses any `L`
  // row whose port is not a TCP port, so a second copy of that rule in the
  // consumer is unreachable and would have to be found twice to relax.
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

/** One scan's answer: every requested ROOT pid's subtree ports — or `blind` for
 *  a root the scan could not read — and the host's listeners, both folded from
 *  the same reading, so they cannot disagree about a listener.
 *
 *  `dropped` and `exited` are facts about the JOIN itself, not about any one
 *  terminal or the host — surfaced so a caller with a logger (the sampler) can
 *  say so, rather than the scan silently producing a `known` answer that is
 *  quietly missing a listener or mislabeling one. */
export interface PortScan {
  byRoot: Map<number, PortInfo[] | "blind">;
  host: Extract<HostListeners, { status: "known" }>;
  /** A claimed listener whose pid's `/proc` rows were unreadable for a reason
   *  OTHER than the ordinary exit race (another user's process, an LSM denial)
   *  — dropped from every fold rather than attributed to the wrong owner, so
   *  it is simply absent from `byRoot` and `host.claimed` with nothing on the
   *  wire explaining why. */
  dropped: readonly { pid: number; port: number }[];
  /** A claimed listener whose pid never appeared in the process table this
   *  pass — the ordinary exit race between the ports read and the `/proc`
   *  walk — shown by {@link EXITED_LISTENER_NAME} rather than its bare pid
   *  number, which would look like a real, if oddly-named, program. */
  exited: readonly { pid: number; port: number }[];
}

/** Stands in for a claimed listener's name/command when its pid exited between
 *  the ports read and the process-table walk — honest about the race rather
 *  than showing the pid number, which reads as a real (if odd) program name. */
export const EXITED_LISTENER_NAME = "(exited)";

function joinPorts(
  reading: SnapshotReading,
  rootPids: readonly number[],
  skipPids: ReadonlySet<number>,
  blindRoots: ReadonlySet<number>,
): PortScan {
  // `ports_unclaimed` is TOLERATED (see TOLERATED_SOURCE_FACETS), not ignored:
  // the sockets it costs are exactly the unclaimed half, which says so.
  const unclaimedBlind = reading.errors.some(
    ({ facet }) => facet === "ports_unclaimed",
  );
  const { claimed, unclaimed } = classifyListeners(reading.ports);
  const names = new Map(reading.procs.map((row) => [row.pid, row.name]));
  const argvs = new Map(reading.argv.map((row) => [row.pid, row.argv]));

  /** Every claimed listener as a `PortInfo`, grouped by the pid holding it. A
   *  skipped pid (unreadable, exit race) contributes nothing to EITHER fold —
   *  the host list is not a place to smuggle in a row the subtree fold refused. */
  const byPid = new Map<number, PortInfo[]>();
  const dropped: { pid: number; port: number }[] = [];
  const exited: { pid: number; port: number }[] = [];
  for (const l of claimed) {
    if (skipPids.has(l.pid)) {
      dropped.push({ pid: l.pid, port: l.port });
      continue;
    }
    // A claimed pid absent from BOTH `names` and `skipPids` never hit a `U`
    // row at all — the ordinary race of a pid exiting between the ports read
    // and the `/proc` walk, not the unreadable-owner case `skipPids` names.
    if (!names.has(l.pid)) exited.push({ pid: l.pid, port: l.port });
    const name = names.get(l.pid) ?? EXITED_LISTENER_NAME;
    const row: PortInfo = {
      port: l.port,
      name,
      // No argv row: either the process has none, its argv was unreadable (a
      // LABEL facet — see LABEL_FACETS), or the pid raced past `/proc`
      // entirely. All three are shown by the name.
      command: portCommand(argvs.get(l.pid) ?? [], name),
      scope: l.scope,
      family: l.family,
    };
    const held = byPid.get(l.pid);
    if (held === undefined) byPid.set(l.pid, [row]);
    else held.push(row);
  }

  const byRoot = new Map<number, PortInfo[] | "blind">();
  /** Every port some terminal subtree holds — blind roots included: the
   *  process TABLE is readable even where a root's sockets are not, so
   *  membership is exact either way. */
  const terminalPorts = new Set<number>();
  for (const [rootPid, pids] of partitionSubtrees(reading.procs, rootPids)) {
    for (const pid of pids) {
      for (const row of byPid.get(pid) ?? []) terminalPorts.add(row.port);
    }
    // `[]` here would render byte-identically to "this terminal serves nothing"
    // (`caught-error-must-not-collapse-to-empty`).
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
    dropped,
    exited,
  };
}

// ── Entry point ─────────────────────────────────────────────────────────

export function portScanSupported(): boolean {
  return process.platform === "linux" || process.platform === "darwin";
}

/**
 * Scan the host once via osfacts: listening ports per requested ROOT PID, and
 * every listener on the host.
 *
 * Every requested pid is present in `byRoot` (empty array when its subtree
 * serves nothing, `"blind"` when its root could not be read). An empty root list
 * is a real ask: the host fold still runs. **Fails** with `PortScanError` —
 * `"blind"` for a pass whose SOURCE could not see; `"unsupported-platform"` for a
 * host that never can. Both are
 * on the DECLARED error channel, so the sampler's two-way permanent/transient
 * fold below is reading a type rather than guessing at a rejection.
 *
 * The osfacts arm is a `mapError`, not a `catch`: the client declares exactly
 * three failures, every one of them means this pass could not see, and the
 * scan's own vocabulary for that is `blind` — so the translation is total and
 * the original rides along as `cause`. There is no `instanceof` left to write,
 * and nothing this scan is not the judge of can reach the arm: a defect stays
 * a defect, which is what the old `throw err` re-raise bought by hand.
 */
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

    // `osfactsBinPath` is a sync throw (it wraps the client's sync-island
    // `bakedOsFactsBin`), and it throws the scan's OWN error type — so it is
    // lifted onto the declared channel rather than left to become a defect the
    // sampler's permanent/transient fold could not read.
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

/** One osfacts reading → this scan's answer, or the `blind` refusals the
 *  reading itself justifies. Separated from the spawn so the policy reads as
 *  policy, and Effect-returning rather than throwing so BOTH refusals sit on
 *  the same declared channel the spawn arm does — a `blind` the sampler must
 *  hold its last sample through is not a defect. */
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

  const { blindRoots, skipPids } = unreadablePolicy(
    reading.unreadable,
    new Set(rootPids),
  );
  // A root pid that is not in the process table at all is not a blindness: a
  // host-wide read lists every live pid, so its absence IS the exit race the
  // subtree ask used to report as an ENOENT `U` row — an empty subtree, which
  // `partitionSubtrees` already answers for a pid it does not find.
  return Effect.succeed(joinPorts(reading, rootPids, skipPids, blindRoots));
}
