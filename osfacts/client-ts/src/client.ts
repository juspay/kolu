/** Spawn osfacts and parse its versioned TSV. Node builtins only. */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const OSFACTS_FORMAT_VERSION = 2;
export const OSFACTS_COMMAND_TIMEOUT_MS = 5_000;
const TCP_PORT_MIN = 1;
const TCP_PORT_MAX = 65_535;

/** The parser's own guard on an `L` row. Not a consumer-facing predicate: a
 * reading's listeners have already passed it, so a consumer re-checking is
 * checking something unreachable. */
function isTcpPort(port: number): boolean {
  return Number.isInteger(port) && port >= TCP_PORT_MIN && port <= TCP_PORT_MAX;
}

export class OsfactsClientError extends Error {
  constructor(
    readonly kind: "spawn" | "version" | "parse",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "OsfactsClientError";
  }
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

function errnoOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
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
        arity(f, 4, line);
        out.procs.push({
          pid: integer(f[1], "pid"),
          ppid: integer(f[2], "ppid"),
          name: f[3]!,
        });
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
        const status = f[1];
        const pidRaw = f[2];
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
        if (status === "claimed") {
          if (pidRaw === "-")
            throw new OsfactsClientError(
              "parse",
              `claimed listener has no pid: ${line}`,
            );
          out.ports.push({
            status,
            pid: integer(pidRaw, "listener pid"),
            uid,
            port,
            address,
          });
        } else if (status === "unclaimed") {
          if (pidRaw !== "-")
            throw new OsfactsClientError(
              "parse",
              `unclaimed listener carries a pid: ${line}`,
            );
          out.ports.push({ status, uid, port, address });
        } else
          throw new OsfactsClientError(
            "parse",
            `unknown listener status: ${line}`,
          );
        break;
      }
      case "U": {
        arity(f, 4, line);
        const facet = f[2];
        if (!(UNREADABLE_FACETS as readonly string[]).includes(facet!))
          throw new OsfactsClientError(
            "parse",
            `unknown unreadable facet: ${line}`,
          );
        if (!f[3])
          throw new OsfactsClientError(
            "parse",
            `empty unreadable errno: ${line}`,
          );
        out.unreadable.push({
          pid: integer(f[1], "unreadable pid"),
          facet: facet as UnreadableFacet,
          errno: f[3],
        });
        break;
      }
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

async function runOsfacts(bin: string, args: string[]): Promise<string> {
  if (!bin)
    throw new OsfactsClientError(
      "spawn",
      "osfacts binary path is empty — the caller must supply an absolute path",
    );
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: OSFACTS_COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
    });
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
    throw new OsfactsClientError(
      "spawn",
      `osfacts \`${bin}\` failed (${errnoOf(err) ?? "non-zero exit"})`,
      { cause: err },
    );
  }
}

function runOsfactsSync(bin: string, args: string[]): string {
  if (!bin)
    throw new OsfactsClientError(
      "spawn",
      "osfacts binary path is empty — the caller must supply an absolute path",
    );
  try {
    return execFileSync(bin, args, {
      timeout: OSFACTS_COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
  } catch (err) {
    const document = failureDocument(err);
    if (document !== undefined) return document;
    throw new OsfactsClientError(
      "spawn",
      `osfacts \`${bin}\` failed (${errnoOf(err) ?? "non-zero exit"})`,
      { cause: err },
    );
  }
}

/**
 * The child's stdout when a non-zero exit still produced a V2 document.
 *
 * A killed child is excluded: on timeout or SIGKILL the output is whatever had
 * been flushed, so a `V` prefix there means a truncated document, not a
 * complete one — and a truncated document must surface as the spawn failure it
 * is rather than as a parse error about some arbitrary row.
 */
function failureDocument(err: unknown): string | undefined {
  const failure = err as { stdout?: unknown; killed?: boolean };
  if (failure?.killed) return undefined;
  const stdout = failure?.stdout;
  if (typeof stdout !== "string" || !stdout.startsWith("V\t")) return undefined;
  return stdout;
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
export function processIdentity(
  bin: string,
  pid: number,
): { pid: number; startUnixUs: number } | undefined {
  const reading = snapshotPidsSync(bin, [pid], { startTime: true });
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
