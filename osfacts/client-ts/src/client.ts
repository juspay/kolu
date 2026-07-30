/** Spawn osfacts and parse its versioned TSV. Node builtins only. */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  assertBinPath,
  CHILD_OPTIONS,
  failureDocument,
  spawnFailure,
} from "./childFailure.ts";
import { OsfactsClientError } from "./clientError.ts";

// Two names this module does not define but is the public face of: the error
// every entry point raises, and the child deadline. They live one level down —
// in leaves both this module and `childFailure.ts` can stand on without either
// importing the other — and are re-exported here so the package keeps exactly
// one production root.
export { OsfactsClientError };
export { OSFACTS_COMMAND_TIMEOUT_MS } from "./childFailure.ts";

const execFileAsync = promisify(execFile);
export const OSFACTS_FORMAT_VERSION = 2;
const TCP_PORT_MIN = 1;
const TCP_PORT_MAX = 65_535;

/** The parser's own guard on an `L` row. Not a consumer-facing predicate: a
 * reading's listeners have already passed it, so a consumer re-checking is
 * checking something unreachable. */
function isTcpPort(port: number): boolean {
  return Number.isInteger(port) && port >= TCP_PORT_MIN && port <= TCP_PORT_MAX;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  name: string;
}
export interface MemoryRow {
  pid: number;
  rssBytes: number;
}
export interface StartTimeRow {
  pid: number;
  startUnixUs: number;
}
export interface ProcessCpuTimeRow {
  pid: number;
  cpuTimeUs: number;
}
export interface ProcessUidRow {
  pid: number;
  uid: number;
}
export interface ProcessCwdRow {
  pid: number;
  cwd: string;
}
export interface ProcessStatusRow {
  pid: number;
  state: string;
  nice: number;
  threads: number | null;
}
export interface ProcessArgvRow {
  pid: number;
  argv: string[];
}
interface ListenerFact {
  port: number;
  address: string;
  uid?: number;
}
export type ListenerRow =
  | (ListenerFact & { status: "claimed"; pid: number })
  | (ListenerFact & { status: "unclaimed" });

// ── The facet vocabulary ────────────────────────────────────────────────
//
// These three lists are the TypeScript face of the `Facet` enum in
// `osfacts/src/schema.rs`. They are not independently maintained: `facets.json`
// is checked in beside the binary, a Rust test pins it to the enum, and
// `facets.test.ts` pins these lists to the same file. Adding a facet on one
// side without the other fails the fast unit lane rather than surfacing as a
// consumer parse error at runtime.

/** Per-pid facets a `U` row can name — what one unreadable *pid* costs. */
export const UNREADABLE_FACETS = [
  "proc",
  "ports",
  "mem",
  "start_time",
  "cpu_time",
  "uid",
  "cwd",
  "status",
  "status_threads",
  "argv",
] as const;
export type UnreadableFacet = (typeof UNREADABLE_FACETS)[number];
export interface UnreadableRow {
  pid: number;
  facet: UnreadableFacet;
  errno: string;
}

/**
 * Facets an `E` row of the `snapshot` verb can name — what a blind *source*
 * costs, as opposed to what a blind *pid* costs.
 *
 * `ports`, `ports_unclaimed`, and `ports_uid` are the distinctions that
 * matter. `ports` means no listener survived. `ports_unclaimed` means only
 * listeners nobody claimed are missing — a consumer that folds listeners per
 * subtree is untouched by it and must not treat it as blindness.
 * `ports_uid` is darwin reporting that neither of its listener sources carries
 * a socket's owning uid, so the `uid` field is absent there for every row.
 */
export const SNAPSHOT_SOURCE_FACETS = [
  "proc",
  "ports",
  "ports_unclaimed",
  "ports_uid",
  "mem",
  "start_time",
  "cpu_time",
  "uid",
  "cwd",
  "status",
  "argv",
] as const;
export type SnapshotSourceFacet = (typeof SNAPSHOT_SOURCE_FACETS)[number];

/**
 * Facets an `E` row of the `socket-holders` verb can name.
 *
 * Exactly one: `socket_holders`, the holder set itself going blind — on
 * darwin, the descriptor walk that named nobody and could not tell that from
 * being denied another user's descriptors.
 *
 * The `--procs` facet is deliberately NOT here. It names an already-known pid
 * set, so a name the tool cannot read costs that one holder and arrives as
 * that pid's `U` row (`facet: "proc"` in `unreadable`), never as a blind
 * source. A reading can therefore carry holders and lose a name, but it never
 * carries an `E … proc …` row on this verb.
 */
export const SOCKET_HOLDERS_SOURCE_FACETS = ["socket_holders"] as const;
export type SocketHoldersSourceFacet =
  (typeof SOCKET_HOLDERS_SOURCE_FACETS)[number];
export interface SocketHoldersSourceErrorRow {
  source: string;
  /** Which facet this source's silence costs. */
  facet: SocketHoldersSourceFacet;
  code: string;
}

/**
 * Facets an `E` row of the `host` verb can name.
 *
 * A separate list from `SNAPSHOT_SOURCE_FACETS` because the two verbs are
 * separate contracts, and one wire token means different things across them:
 * `mem` here is host RAM, `mem` there is process RSS. Keeping them in one
 * union let a consumer match across verbs by accident.
 */
export const HOST_SOURCE_FACETS = [
  "uptime",
  "load",
  "mem",
  "cpu",
  "net",
  "disk",
] as const;
export type HostSourceFacet = (typeof HOST_SOURCE_FACETS)[number];

export interface SnapshotSourceErrorRow {
  source: string;
  /** Which facet this source's silence costs. */
  facet: SnapshotSourceFacet;
  code: string;
}
export interface HostSourceErrorRow {
  source: string;
  /** Which facet this source's silence costs. */
  facet: HostSourceFacet;
  code: string;
}

export interface LoadRow {
  one: number;
  five: number;
  fifteen: number;
}
export interface HostMemoryRow {
  totalBytes: number;
  availableBytes: number;
}
export interface SwapRow {
  totalBytes: number;
  usedBytes: number;
}
export interface CpuRow {
  core: number;
  userUs: number;
  systemUs: number;
  idleUs: number;
  otherUs: number;
  model: string;
  frequencyMhz: number | null;
}
export interface NetworkRow {
  name: string;
  rxBytes: number;
  txBytes: number;
}
export interface DiskRow {
  mount: string;
  totalBytes: number;
  availableBytes: number;
  freeBytes: number;
}

/**
 * What the `snapshot` verb returns. Mirrors Rust's `Snapshot`.
 *
 * Separate from `HostReading` because they are separate documents the binary
 * can never mix: one union type left every caller carrying the other verb's
 * permanently-empty fields, with no way to tell "empty because I did not ask"
 * from "empty because the source was blind".
 */
export interface SnapshotReading {
  procs: ProcessRow[];
  memory: MemoryRow[];
  startTimes: StartTimeRow[];
  cpuTimes: ProcessCpuTimeRow[];
  uids: ProcessUidRow[];
  cwds: ProcessCwdRow[];
  statuses: ProcessStatusRow[];
  argv: ProcessArgvRow[];
  ports: ListenerRow[];
  unreadable: UnreadableRow[];
  /** Requested sources that were blind. Partial output still exits successfully. */
  errors: SnapshotSourceErrorRow[];
}

/**
 * One process the OS says holds the socket path, or the bound socket itself
 * when no readable pid claims it.
 *
 * The discriminated shape is the contract's point. `claimed` names a pid;
 * `unclaimed` says *something holds this path and I could not name it* —
 * which is neither "nobody holds it" (no row at all) nor "the source went
 * blind" (an `E` row). A consumer that flattened this to `number[]` would
 * spell all three as an empty array.
 */
export type SocketHolderRow =
  | { status: "claimed"; pid: number }
  | { status: "unclaimed" };

/**
 * What the `socket-holders` verb returns. Mirrors Rust's `SocketHolders`.
 *
 * An empty `holders` with an empty `errors` is the affirmative answer *nobody
 * holds this path* — the one reading with no facts that a caller may act on.
 */
export interface SocketHoldersReading {
  holders: SocketHolderRow[];
  /** Holder identity, only when `procs` was asked for. */
  procs: ProcessRow[];
  unreadable: UnreadableRow[];
  /** Requested sources that were blind. Partial output still exits successfully. */
  errors: SocketHoldersSourceErrorRow[];
}

/** What the `host` verb returns. Mirrors Rust's `HostSnapshot`. */
export interface HostReading {
  load?: LoadRow;
  memory?: HostMemoryRow;
  swap?: SwapRow;
  uptimeUs?: number;
  cpus: CpuRow[];
  networks: NetworkRow[];
  disks: DiskRow[];
  /** Requested sources that were blind. Partial output still exits successfully. */
  errors: HostSourceErrorRow[];
}

export interface SnapshotFacets {
  procs?: boolean;
  ports?: boolean;
  mem?: boolean;
  startTime?: boolean;
  cpuTime?: boolean;
  uid?: boolean;
  cwd?: boolean;
  status?: boolean;
  argv?: boolean;
}
export interface HostFacets {
  load?: boolean;
  mem?: boolean;
  cpu?: boolean;
  net?: boolean;
  disk?: boolean;
}

/**
 * Which wire facets each `snapshot` flag can be reported against.
 *
 * The flag→facet map is NOT mechanical — `procs` names `proc` (singular) and
 * `ports` names three — so every consumer that hand-wrote it wrote tool
 * knowledge in a second vocabulary with nothing keeping the two in step. It
 * lives here, beside the flags it translates. This is a statement of fact
 * about the binary, not policy: whether a named facet's blindness *matters* is
 * still the consumer's call.
 */
const SNAPSHOT_FACET_NAMES = {
  procs: { arg: "--procs", unreadable: ["proc"], source: ["proc"] },
  ports: {
    arg: "--ports",
    unreadable: ["ports"],
    source: ["ports", "ports_unclaimed", "ports_uid"],
  },
  mem: { arg: "--mem", unreadable: ["mem"], source: ["mem"] },
  startTime: {
    arg: "--start-time",
    unreadable: ["start_time"],
    source: ["start_time"],
  },
  cpuTime: {
    arg: "--cpu-time",
    unreadable: ["cpu_time"],
    source: ["cpu_time"],
  },
  uid: { arg: "--uid", unreadable: ["uid"], source: ["uid"] },
  cwd: { arg: "--cwd", unreadable: ["cwd"], source: ["cwd"] },
  status: {
    arg: "--status",
    unreadable: ["status", "status_threads"],
    source: ["status"],
  },
  argv: { arg: "--argv", unreadable: ["argv"], source: ["argv"] },
} as const satisfies Record<
  keyof SnapshotFacets,
  {
    arg: string;
    unreadable: readonly UnreadableFacet[];
    source: readonly SnapshotSourceFacet[];
  }
>;

/** The `U` and `E` facet names a given ask can be answered with. */
export function snapshotFacetNames(facets: SnapshotFacets): {
  unreadable: readonly UnreadableFacet[];
  source: readonly SnapshotSourceFacet[];
} {
  const unreadable: UnreadableFacet[] = [];
  const source: SnapshotSourceFacet[] = [];
  for (const [flag, names] of Object.entries(SNAPSHOT_FACET_NAMES)) {
    if (!facets[flag as keyof SnapshotFacets]) continue;
    unreadable.push(...names.unreadable);
    source.push(...names.source);
  }
  return { unreadable, source };
}

/**
 * Parse one numeric TSV field, or fail loudly.
 *
 * `shape` is checked BEFORE coercion because `Number("")` and `Number(" ")` are
 * `0`, not `NaN` — so an empty (as opposed to missing) field used to parse as a
 * perfectly plausible zero. `arity` counts fields and never looks at their
 * content, so nothing downstream caught it: an empty `nice` read as "default
 * priority", indistinguishable from a real reading. The three callers differ
 * only in that shape and predicate, which is why they share this body.
 */
function numeric(
  raw: string | undefined,
  what: string,
  shape: RegExp,
  valid: (value: number) => boolean,
  expected: string,
): number {
  if (raw === undefined || !shape.test(raw))
    throw new OsfactsClientError(
      "parse",
      `osfacts ${what} is not ${expected}: ${raw}`,
    );
  const value = Number(raw);
  if (!valid(value))
    throw new OsfactsClientError(
      "parse",
      `osfacts ${what} is not ${expected}: ${raw}`,
    );
  return value;
}
function integer(raw: string | undefined, what: string): number {
  return numeric(
    raw,
    what,
    /^\d+$/,
    (value) => Number.isSafeInteger(value),
    "a safe non-negative integer",
  );
}
function float(raw: string | undefined, what: string): number {
  return numeric(
    raw,
    what,
    /^\d+(\.\d+)?$/,
    (value) => Number.isFinite(value),
    "finite and non-negative",
  );
}
function signedInteger(raw: string | undefined, what: string): number {
  return numeric(
    raw,
    what,
    /^-?\d+$/,
    (value) => Number.isSafeInteger(value),
    "a safe integer",
  );
}
function positiveInteger(raw: string | undefined, what: string): number {
  const value = integer(raw, what);
  if (value === 0)
    throw new OsfactsClientError("parse", `osfacts ${what} must be positive`);
  return value;
}
function jsonString(raw: string | undefined, what: string): string {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "");
  } catch (cause) {
    throw new OsfactsClientError("parse", `osfacts ${what} is not JSON`, {
      cause,
    });
  }
  if (typeof value !== "string")
    throw new OsfactsClientError("parse", `osfacts ${what} is not a string`);
  return value;
}
function jsonStrings(raw: string | undefined, what: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "");
  } catch (cause) {
    throw new OsfactsClientError("parse", `osfacts ${what} is not JSON`, {
      cause,
    });
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new OsfactsClientError(
      "parse",
      `osfacts ${what} is not a string array`,
    );
  return value;
}
function arity(f: string[], n: number, row: string): void {
  if (f.length !== n)
    throw new OsfactsClientError("parse", `unreadable osfacts row: ${row}`);
}
function unknownTag(f: string[], line: string): never {
  throw new OsfactsClientError(
    "parse",
    `unknown osfacts row tag ${JSON.stringify(f[0] ?? "")}: ${line}`,
  );
}

/** Check the version header both verbs share and return the body's rows. */
function bodyRows(body: string): string[] {
  const lines = body.split("\n");
  const first = lines[0] ?? "";
  const version = /^V\t(\d+)$/.exec(first);
  if (version === null)
    throw new OsfactsClientError(
      "version",
      `osfacts did not begin with a version line (got ${JSON.stringify(first.slice(0, 40))})`,
    );
  if (Number(version[1]) !== OSFACTS_FORMAT_VERSION)
    throw new OsfactsClientError(
      "version",
      `osfacts speaks format ${version[1]}, this reader speaks ${OSFACTS_FORMAT_VERSION} — binary and client are from different sources`,
    );
  return lines.slice(1);
}

/** The `E` row, shared by both verbs but validated against each one's own
 * closed facet vocabulary. */
function sourceErrorRow<F extends string>(
  f: string[],
  line: string,
  allowed: readonly F[],
): { source: string; facet: F; code: string } {
  arity(f, 4, line);
  if (!f[1] || !f[3])
    throw new OsfactsClientError("parse", `empty source error: ${line}`);
  const facet = f[2];
  if (!(allowed as readonly string[]).includes(facet!))
    throw new OsfactsClientError(
      "parse",
      `unknown source-error facet: ${line}`,
    );
  return { source: f[1], facet: facet as F, code: f[3] };
}

/** The `P` row — identical in the `snapshot` and `socket-holders` documents,
 *  because the Rust side writes both through one `write_procs`. */
function procRow(f: string[], line: string): ProcessRow {
  arity(f, 4, line);
  return {
    pid: integer(f[1], "pid"),
    ppid: integer(f[2], "ppid"),
    name: f[3]!,
  };
}

/** The `U` row — one unreadable pid facet, same shape in both documents
 *  (Rust's shared `write_unreadable`). */
function unreadableRow(f: string[], line: string): UnreadableRow {
  arity(f, 4, line);
  const facet = f[2];
  if (!(UNREADABLE_FACETS as readonly string[]).includes(facet!))
    throw new OsfactsClientError("parse", `unknown unreadable facet: ${line}`);
  if (!f[3])
    throw new OsfactsClientError("parse", `empty unreadable errno: ${line}`);
  return {
    pid: integer(f[1], "unreadable pid"),
    facet: facet as UnreadableFacet,
    errno: f[3],
  };
}

/**
 * The claimed/unclaimed discrimination the `L` and `H` rows both carry —
 * Rust's `Attribution`, read once.
 *
 * `claimed` implies a pid and `unclaimed` implies none: the ONE rule, stated
 * here only. A pid is `positiveInteger` on both rows — pid 0 is the kernel's
 * swapper, never a userspace listener or socket holder, so a row claiming it
 * is a corrupt document rather than a fact.
 */
function attribution(
  status: string | undefined,
  pidRaw: string | undefined,
  line: string,
  what: string,
): { status: "claimed"; pid: number } | { status: "unclaimed" } {
  if (status === "claimed") {
    if (pidRaw === "-")
      throw new OsfactsClientError(
        "parse",
        `claimed ${what} has no pid: ${line}`,
      );
    return { status, pid: positiveInteger(pidRaw, `${what} pid`) };
  }
  if (status === "unclaimed") {
    if (pidRaw !== "-")
      throw new OsfactsClientError(
        "parse",
        `unclaimed ${what} carries a pid: ${line}`,
      );
    return { status };
  }
  throw new OsfactsClientError("parse", `unknown ${what} status: ${line}`);
}

export function emptySnapshotReading(): SnapshotReading {
  return {
    procs: [],
    memory: [],
    startTimes: [],
    cpuTimes: [],
    uids: [],
    cwds: [],
    statuses: [],
    argv: [],
    ports: [],
    unreadable: [],
    errors: [],
  };
}

export function parseSnapshotOutput(body: string): SnapshotReading {
  const out = emptySnapshotReading();
  for (const line of bodyRows(body)) {
    if (line === "") continue;
    const f = line.split("\t");
    switch (f[0]) {
      case "P":
        out.procs.push(procRow(f, line));
        break;
      case "M":
        arity(f, 3, line);
        out.memory.push({
          pid: integer(f[1], "memory pid"),
          rssBytes: integer(f[2], "rss"),
        });
        break;
      case "S":
        arity(f, 3, line);
        out.startTimes.push({
          pid: integer(f[1], "start-time pid"),
          startUnixUs: integer(f[2], "start time"),
        });
        break;
      case "C":
        arity(f, 3, line);
        out.cpuTimes.push({
          pid: integer(f[1], "cpu-time pid"),
          cpuTimeUs: integer(f[2], "cumulative cpu time"),
        });
        break;
      case "UID":
        arity(f, 3, line);
        out.uids.push({
          pid: integer(f[1], "uid pid"),
          uid: integer(f[2], "uid"),
        });
        break;
      case "CWD":
        arity(f, 3, line);
        out.cwds.push({
          pid: integer(f[1], "cwd pid"),
          cwd: jsonString(f[2], "cwd"),
        });
        break;
      case "STAT": {
        arity(f, 5, line);
        const state = f[2]!;
        if ([...state].length !== 1)
          throw new OsfactsClientError(
            "parse",
            `osfacts process state is not one character: ${line}`,
          );
        out.statuses.push({
          pid: integer(f[1], "status pid"),
          state,
          nice: signedInteger(f[3], "nice value"),
          threads: f[4] === "-" ? null : positiveInteger(f[4], "thread count"),
        });
        break;
      }
      case "ARGV":
        arity(f, 3, line);
        out.argv.push({
          pid: integer(f[1], "argv pid"),
          argv: jsonStrings(f[2], "argv"),
        });
        break;
      case "L": {
        arity(f, 6, line);
        const uid = f[3] === "-" ? undefined : integer(f[3], "listener uid");
        const port = integer(f[4], "listener port");
        if (!isTcpPort(port))
          throw new OsfactsClientError(
            "parse",
            `osfacts listener row carries no valid port: ${line}`,
          );
        const address = f[5]!;
        if (![8, 32].includes(address.length) || !/^[0-9a-f]+$/.test(address))
          throw new OsfactsClientError(
            "parse",
            `osfacts listener row has a bad bind address: ${line}`,
          );
        out.ports.push({
          ...attribution(f[1], f[2], line, "listener"),
          uid,
          port,
          address,
        });
        break;
      }
      case "U":
        out.unreadable.push(unreadableRow(f, line));
        break;
      case "E":
        out.errors.push(sourceErrorRow(f, line, SNAPSHOT_SOURCE_FACETS));
        break;
      // A `host` tag here means the caller matched the wrong verb to the wrong
      // parser. Loud, rather than a silently-empty field.
      default:
        unknownTag(f, line);
    }
  }
  return out;
}

export function parseSocketHoldersOutput(body: string): SocketHoldersReading {
  const out: SocketHoldersReading = {
    holders: [],
    procs: [],
    unreadable: [],
    errors: [],
  };
  for (const line of bodyRows(body)) {
    if (line === "") continue;
    const f = line.split("\t");
    switch (f[0]) {
      case "H":
        arity(f, 3, line);
        out.holders.push(attribution(f[1], f[2], line, "holder"));
        break;
      case "P":
        out.procs.push(procRow(f, line));
        break;
      case "U":
        out.unreadable.push(unreadableRow(f, line));
        break;
      case "E":
        out.errors.push(sourceErrorRow(f, line, SOCKET_HOLDERS_SOURCE_FACETS));
        break;
      // An `L` or `HMEM` tag here means the caller matched the wrong verb to
      // the wrong parser. Loud, rather than a silently-empty field.
      default:
        unknownTag(f, line);
    }
  }
  return out;
}

export function parseHostOutput(body: string): HostReading {
  const out: HostReading = {
    cpus: [],
    networks: [],
    disks: [],
    errors: [],
  };
  for (const line of bodyRows(body)) {
    if (line === "") continue;
    const f = line.split("\t");
    switch (f[0]) {
      case "HLOAD":
        arity(f, 4, line);
        out.load = {
          one: float(f[1], "load1"),
          five: float(f[2], "load5"),
          fifteen: float(f[3], "load15"),
        };
        break;
      case "HMEM":
        arity(f, 3, line);
        out.memory = {
          totalBytes: integer(f[1], "memory total"),
          availableBytes: integer(f[2], "memory available"),
        };
        break;
      case "HSWAP":
        arity(f, 3, line);
        out.swap = {
          totalBytes: integer(f[1], "swap total"),
          usedBytes: integer(f[2], "swap used"),
        };
        break;
      case "HUP":
        arity(f, 2, line);
        out.uptimeUs = integer(f[1], "uptime");
        break;
      case "HCPU": {
        arity(f, 8, line);
        const model = jsonString(f[6], "cpu model");
        if (model.length === 0)
          throw new OsfactsClientError("parse", "osfacts CPU model is empty");
        out.cpus.push({
          core: integer(f[1], "cpu core"),
          userUs: integer(f[2], "cpu user"),
          systemUs: integer(f[3], "cpu system"),
          idleUs: integer(f[4], "cpu idle"),
          otherUs: integer(f[5], "cpu other"),
          model,
          frequencyMhz:
            f[7] === "-" ? null : positiveInteger(f[7], "cpu frequency MHz"),
        });
        break;
      }
      case "HNET":
        arity(f, 4, line);
        out.networks.push({
          name: f[1]!,
          rxBytes: integer(f[2], "network rx"),
          txBytes: integer(f[3], "network tx"),
        });
        break;
      case "HDISK":
        arity(f, 5, line);
        out.disks.push({
          mount: f[1]!,
          totalBytes: integer(f[2], "disk total"),
          availableBytes: integer(f[3], "disk available"),
          freeBytes: integer(f[4], "disk free"),
        });
        break;
      case "E":
        out.errors.push(sourceErrorRow(f, line, HOST_SOURCE_FACETS));
        break;
      default:
        unknownTag(f, line);
    }
  }
  return out;
}

// The two spawn twins. Everything they share — the empty-`bin` guard, the child
// options, the failure-document short-circuit, and how a failure is composed —
// lives in `childFailure.ts` and is applied identically here, so the ONE line
// that may differ between them is `execFileAsync` versus `execFileSync`. That
// is the module's own stated failure mode (a rule applied to one twin and not
// the other) refused at the call site as well as in the classifier.
async function runOsfacts(bin: string, args: string[]): Promise<string> {
  assertBinPath(bin);
  try {
    const { stdout } = await execFileAsync(bin, args, CHILD_OPTIONS);
    return stdout;
  } catch (err) {
    // A non-zero exit is not the same as no answer. The binary's documented
    // total-failure path is "write the V line and its E rows, then exit 1" —
    // and that document is the ONLY place the answer to *which source went
    // blind* exists. Discarding it here because the status was non-zero threw
    // away exactly the honesty the wire format is for, leaving every consumer
    // an opaque "non-zero exit". Hand the document on and let the caller apply
    // its own reject-versus-render policy, the same way it does for a partial
    // snapshot that exited 0.
    const document = failureDocument(err);
    if (document !== undefined) return document;
    throw spawnFailure(bin, err);
  }
}

function runOsfactsSync(bin: string, args: string[]): string {
  assertBinPath(bin);
  try {
    return execFileSync(bin, args, { ...CHILD_OPTIONS, encoding: "utf8" });
  } catch (err) {
    const document = failureDocument(err);
    if (document !== undefined) return document;
    throw spawnFailure(bin, err);
  }
}

function appendSnapshotFacets(
  args: string[],
  facets: SnapshotFacets,
): string[] {
  for (const [flag, spec] of Object.entries(SNAPSHOT_FACET_NAMES))
    if (facets[flag as keyof SnapshotFacets]) args.push(spec.arg);
  return args;
}
function snapshotArgs(
  scopeFlag: "--roots" | "--pids",
  pids: readonly number[],
  facets: SnapshotFacets,
): string[] {
  return appendSnapshotFacets(["snapshot", scopeFlag, pids.join(",")], facets);
}
async function snapshot(bin: string, args: string[]): Promise<SnapshotReading> {
  return parseSnapshotOutput(await runOsfacts(bin, args));
}

export function snapshotSubtree(
  bin: string,
  rootPids: readonly number[],
  facets: SnapshotFacets,
): Promise<SnapshotReading> {
  return rootPids.length === 0
    ? Promise.resolve(emptySnapshotReading())
    : snapshot(bin, snapshotArgs("--roots", rootPids, facets));
}
export function snapshotHost(
  bin: string,
  facets: SnapshotFacets,
): Promise<SnapshotReading> {
  return snapshot(bin, appendSnapshotFacets(["snapshot"], facets));
}
export function snapshotPids(
  bin: string,
  pids: readonly number[],
  facets: SnapshotFacets,
): Promise<SnapshotReading> {
  return pids.length === 0
    ? Promise.resolve(emptySnapshotReading())
    : snapshot(bin, snapshotArgs("--pids", pids, facets));
}

/** Sync twin of {@link snapshotPids} — for gate acquisition and other sites
 * that must not introduce async into a sync claim path. */
export function snapshotPidsSync(
  bin: string,
  pids: readonly number[],
  facets: SnapshotFacets,
): SnapshotReading {
  return pids.length === 0
    ? emptySnapshotReading()
    : parseSnapshotOutput(
        runOsfactsSync(bin, snapshotArgs("--pids", pids, facets)),
      );
}

/**
 * Absolute path of the baked osfacts binary from an env var (cross-repo:
 * kolu uses `KOLU_OSFACTS_BIN`, drishti `DRISHTI_OSFACTS_BIN`). Loud if unset —
 * no PATH fallback. Composition roots pass the name their wrapper bakes.
 */
export function bakedOsFactsBin(envVar: string): string {
  if (!envVar) {
    throw new OsfactsClientError(
      "spawn",
      "bakedOsFactsBin: env var name is empty",
    );
  }
  const path = process.env[envVar];
  if (!path) {
    throw new OsfactsClientError(
      "spawn",
      `${envVar} is not set — the baked osfacts binary path is required (nix wrappers set it; no PATH fallback)`,
    );
  }
  return path;
}

/**
 * Resolve a pid's start-qualified identity via osfacts `--start-time`.
 *
 * Returns the structural `{ pid, startUnixUs }` (no named `ProcessIdentity` —
 * that name lives in `@kolu/surface-daemon`, and this package must not import
 * it). `undefined` for a dead/absent pid (ESRCH/ENOENT) is an honest domain
 * answer; any other unreadable or missing row throws.
 */
function foldStartTimeReading(
  reading: SnapshotReading,
  pid: number,
): { pid: number; startUnixUs: number } | undefined {
  const row = reading.startTimes.find((value) => value.pid === pid);
  if (row !== undefined) return { pid: row.pid, startUnixUs: row.startUnixUs };
  const unreadable = reading.unreadable.find(
    (value) => value.pid === pid && value.facet === "start_time",
  );
  if (
    unreadable !== undefined &&
    (unreadable.errno === "ESRCH" || unreadable.errno === "ENOENT")
  ) {
    return undefined;
  }
  throw new OsfactsClientError(
    "parse",
    unreadable !== undefined
      ? `osfacts could not read pid ${pid} start time (${unreadable.errno})`
      : `osfacts returned no start time for pid ${pid}`,
  );
}

/**
 * Resolve a pid's start-qualified identity via osfacts `--start-time` (sync).
 * Prefer {@link processIdentityAsync} on any serving-loop / supervisor path so
 * the osfacts spawn does not block the Node event loop.
 */
export function processIdentity(
  bin: string,
  pid: number,
): { pid: number; startUnixUs: number } | undefined {
  return foldStartTimeReading(
    snapshotPidsSync(bin, [pid], { startTime: true }),
    pid,
  );
}

/** Async twin of {@link processIdentity} for serving-loop / endpoint paths. */
export async function processIdentityAsync(
  bin: string,
  pid: number,
): Promise<{ pid: number; startUnixUs: number } | undefined> {
  return foldStartTimeReading(
    await snapshotPids(bin, [pid], { startTime: true }),
    pid,
  );
}

/** Sync: `processIdentity(bakedOsFactsBin(envVar), pid)`. The convenience is
 *  worth it only on a genuinely SYNC gate path, where the caller has no place
 *  to hold a resolved bake. There is deliberately no async twin: an async
 *  caller is a composition root, and a composition root resolves
 *  `bakedOsFactsBin` ONCE and passes the path to
 *  {@link processIdentityAsync} — re-reading the env on every call is the
 *  per-call resolution this client stopped doing. */
export function processIdentityFromEnv(
  envVar: string,
  pid: number,
): { pid: number; startUnixUs: number } | undefined {
  return processIdentity(bakedOsFactsBin(envVar), pid);
}

/**
 * Ask which processes hold the unix socket at `socketPath`.
 *
 * The one verb whose scope is a path rather than a pid set. `procs` names the
 * holders as well as counting them — a facet, so a caller that only needs to
 * know *whether* the socket is held does not pay for the identity read.
 *
 * The three answers a caller must keep apart, and never collapse:
 * `holders: []` with `errors: []` is *nobody holds it*; a `{status:
 * "unclaimed"}` row is *something holds it that I could not name*; a
 * `socket_holders` error row is *I could not look*.
 */
export async function socketHolders(
  bin: string,
  socketPath: string,
  facets: { procs?: boolean } = {},
): Promise<SocketHoldersReading> {
  // `async`, so the empty-path guard REJECTS rather than throwing
  // synchronously. Every other spawn entry point in this module rejects
  // (`runOsfacts`'s own empty-`bin` guard included), and a caller writing
  // `socketHolders(bin, path).catch(handle)` — the shape the module teaches —
  // would otherwise get an uncaught exception from one function out of all of
  // them.
  if (!socketPath)
    throw new OsfactsClientError(
      "spawn",
      "osfacts socket-holders needs a socket path",
    );
  const args = ["socket-holders", socketPath];
  if (facets.procs) args.push("--procs");
  return parseSocketHoldersOutput(await runOsfacts(bin, args));
}

/** A process the OS reports as holding a socket path — its pid and a human
 *  command label (for a caller's operator-facing message). */
export interface SocketHolder {
  pid: number;
  /** A readable command for the pid — osfacts' short display name (the
   *  executable's basename), the same fact on both platforms.
   *
   *  ABSENT, not `"?"`, when the holder could not be named (it may have exited
   *  between the holder lookup and the identity read). An in-band `"?"` is
   *  indistinguishable from a process genuinely reporting `?` as its name,
   *  which is the same one-value-several-facts collapse the three-way reading
   *  above exists to refuse — one level down, inside a holder. Diagnostic only,
   *  never a decision input. */
  command?: string;
}

/**
 * What the OS said about who holds a socket path — the honest domain answer,
 * as opposed to the wire-faithful {@link SocketHoldersReading}.
 *
 * The three arms are the whole point. Folding them into one possibly-empty
 * list is the defect this fold exists to refuse, because `[]` then means
 * "free", "occupied by someone I may not name", and "the read failed" at once
 * — and a supervisor that reads the first meaning while the third is true
 * spawns a second daemon onto a live rendezvous socket.
 */
export type SocketOccupancy =
  /** At least one process the OS named. Non-empty BY TYPE, not by comment: a
   *  consumer that re-checks `holders.length === 0` is checking something
   *  unreachable, and a dead safety branch reads exactly like a live one. */
  | {
      readonly kind: "held";
      readonly holders: readonly [SocketHolder, ...SocketHolder[]];
    }
  /** Proven: nothing holds this path. Only linux can prove this — its
   *  `/proc/net/unix` table lists every bound unix socket, so absence from it
   *  is evidence rather than silence. */
  | { readonly kind: "none" }
  /** Something may hold the path and the OS would not say what. `detail` names
   *  which of the two shapes it was, for the operator-facing message only —
   *  both decide identically, because neither is proof of freedom. */
  | { readonly kind: "unattributed"; readonly detail: string };

/**
 * The `socket-holders` document → the honest domain answer.
 *
 * The twin of {@link foldStartTimeReading}, and it lives here for the same
 * reason: folding a wire-faithful reading into the answer a consumer acts on
 * is this package's kind of work, and a fold written once here is a fold kolu
 * and drishti cannot write differently. Exported for its own unit pins — this
 * is where the three answers are kept apart, so it is where a regression would
 * collapse them.
 */
export function foldSocketOccupancy(
  reading: SocketHoldersReading,
): SocketOccupancy {
  const named = reading.holders.flatMap((holder) =>
    holder.status === "claimed"
      ? [
          {
            pid: holder.pid,
            command: reading.procs.find((row) => row.pid === holder.pid)?.name,
          },
        ]
      : [],
  );
  // Destructured rather than length-checked, so the non-empty tuple is BUILT
  // rather than asserted — no cast, and no way to return an empty `holders`.
  const [first, ...rest] = named;
  if (first !== undefined) return { kind: "held", holders: [first, ...rest] };
  // A bound socket the tool could not attribute to any readable pid. Linux
  // emits this when the path IS in its table but no pid it may inspect holds
  // the inode — a foreign-uid holder, and emphatically not a free socket.
  if (reading.holders.length > 0)
    return {
      kind: "unattributed",
      detail: "the socket is bound, but its holder is not ours to inspect",
    };
  // The tool could not complete the search. Darwin has no readable table of
  // bound unix sockets, so a descriptor walk denied another user's processes
  // reports this rather than pretending to linux's proof of absence.
  const blind = reading.errors.find((row) => row.facet === "socket_holders");
  if (blind !== undefined)
    return {
      kind: "unattributed",
      detail: `the holder search could not complete (${blind.source}: ${blind.code})`,
    };
  // Only ONE shape is left, and `none` is the most dangerous answer this fold
  // can give — so it is given only for a document that says nothing at all. A
  // document carrying holder FACTS (a name, an unreadable name) while carrying
  // neither an `H` row nor a blind source is a shape the binary cannot emit:
  // both of those rows exist only for a pid an `H` row already claimed. Read
  // as `none` it would be absence asserted out of a contradiction, so it is a
  // parse error, exactly as an unknown tag or a bad arity is.
  if (reading.procs.length > 0 || reading.unreadable.length > 0)
    throw new OsfactsClientError(
      "parse",
      "osfacts socket-holders named a holder's identity without naming the holder — refusing to read a contradictory document as an unheld socket",
    );
  return { kind: "none" };
}

/**
 * `socketHolders` + {@link foldSocketOccupancy}, bound to an
 * already-resolved binary path — the shape a supervisor injects.
 *
 * `bin` is resolved ONCE at the composition root rather than per call, so a
 * missing bake fails at boot — the loud moment — instead of during a recovery
 * that is already handling a wedged endpoint. Pair it with
 * {@link processIdentityAsync} bound to the SAME resolved path, so one root
 * spells its env var once for both OS facts.
 */
export function osfactsSocketHolders(
  bin: string,
): (socketPath: string) => Promise<SocketOccupancy> {
  return async (socketPath) =>
    foldSocketOccupancy(await socketHolders(bin, socketPath, { procs: true }));
}

export async function host(
  bin: string,
  facets: HostFacets,
): Promise<HostReading> {
  const args = ["host"];
  if (facets.load) args.push("--load");
  if (facets.mem) args.push("--mem");
  if (facets.cpu) args.push("--cpu");
  if (facets.net) args.push("--net");
  if (facets.disk) args.push("--disk");
  return parseHostOutput(await runOsfacts(bin, args));
}
