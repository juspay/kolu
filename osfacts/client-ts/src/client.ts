/** Spawn osfacts and parse its versioned TSV. Node builtins only. */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const OSFACTS_FORMAT_VERSION = 2;
export const OSFACTS_COMMAND_TIMEOUT_MS = 5_000;
const TCP_PORT_MIN = 1;
const TCP_PORT_MAX = 65_535;

export function isTcpPort(port: number): boolean {
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
interface ListenerFact {
  port: number;
  address: string;
  uid?: number;
}
export type ListenerRow =
  | (ListenerFact & { status: "claimed"; pid: number })
  | (ListenerFact & { status: "unclaimed" });
export type UnreadableFacet = "proc" | "ports" | "mem" | "start_time";
export interface UnreadableRow {
  pid: number;
  facet: UnreadableFacet;
  errno: string;
}
export interface SourceErrorRow {
  source: string;
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
}

export interface OsfactsReading {
  procs: ProcessRow[];
  memory: MemoryRow[];
  startTimes: StartTimeRow[];
  ports: ListenerRow[];
  unreadable: UnreadableRow[];
  errors: SourceErrorRow[];
  load?: LoadRow;
  hostMemory?: HostMemoryRow;
  swap?: SwapRow;
  uptimeUs?: number;
  cpus: CpuRow[];
  networks: NetworkRow[];
  disks: DiskRow[];
}

export interface SnapshotFacets {
  procs?: boolean;
  ports?: boolean;
  mem?: boolean;
  startTime?: boolean;
}
export interface HostFacets {
  load?: boolean;
  mem?: boolean;
  cpu?: boolean;
  net?: boolean;
  disk?: boolean;
}

function errnoOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
function integer(raw: string | undefined, what: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new OsfactsClientError(
      "parse",
      `osfacts ${what} is not a safe non-negative integer: ${raw}`,
    );
  return value;
}
function float(raw: string | undefined, what: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new OsfactsClientError(
      "parse",
      `osfacts ${what} is not finite and non-negative: ${raw}`,
    );
  return value;
}
function arity(f: string[], n: number, row: string): void {
  if (f.length !== n)
    throw new OsfactsClientError("parse", `unreadable osfacts row: ${row}`);
}

export function parseOsfactsOutput(body: string): OsfactsReading {
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

  const out: OsfactsReading = {
    procs: [],
    memory: [],
    startTimes: [],
    ports: [],
    unreadable: [],
    errors: [],
    cpus: [],
    networks: [],
    disks: [],
  };
  for (const line of lines.slice(1)) {
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
        if (!["proc", "ports", "mem", "start_time"].includes(facet!))
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
        arity(f, 3, line);
        if (!f[1] || !f[2])
          throw new OsfactsClientError("parse", `empty source error: ${line}`);
        out.errors.push({ source: f[1], code: f[2] });
        break;
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
        out.hostMemory = {
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
      case "HCPU":
        arity(f, 6, line);
        out.cpus.push({
          core: integer(f[1], "cpu core"),
          userUs: integer(f[2], "cpu user"),
          systemUs: integer(f[3], "cpu system"),
          idleUs: integer(f[4], "cpu idle"),
          otherUs: integer(f[5], "cpu other"),
        });
        break;
      case "HNET":
        arity(f, 4, line);
        out.networks.push({
          name: f[1]!,
          rxBytes: integer(f[2], "network rx"),
          txBytes: integer(f[3], "network tx"),
        });
        break;
      case "HDISK":
        arity(f, 4, line);
        out.disks.push({
          mount: f[1]!,
          totalBytes: integer(f[2], "disk total"),
          availableBytes: integer(f[3], "disk available"),
        });
        break;
      default:
        throw new OsfactsClientError(
          "parse",
          `unknown osfacts row tag ${JSON.stringify(f[0] ?? "")}: ${line}`,
        );
    }
  }
  return out;
}

async function runOsfacts(
  bin: string,
  args: string[],
): Promise<OsfactsReading> {
  if (!bin)
    throw new OsfactsClientError(
      "spawn",
      "osfacts binary path is empty — the caller must supply an absolute path",
    );
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(bin, args, {
      timeout: OSFACTS_COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (err) {
    throw new OsfactsClientError(
      "spawn",
      `osfacts \`${bin}\` failed (${errnoOf(err) ?? "non-zero exit"})`,
      { cause: err },
    );
  }
  return parseOsfactsOutput(stdout);
}
function runOsfactsSync(bin: string, args: string[]): OsfactsReading {
  if (!bin)
    throw new OsfactsClientError(
      "spawn",
      "osfacts binary path is empty — the caller must supply an absolute path",
    );
  let stdout: string;
  try {
    stdout = execFileSync(bin, args, {
      timeout: OSFACTS_COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
  } catch (err) {
    throw new OsfactsClientError(
      "spawn",
      `osfacts \`${bin}\` failed (${errnoOf(err) ?? "non-zero exit"})`,
      { cause: err },
    );
  }
  return parseOsfactsOutput(stdout);
}
function snapshotArgs(
  scopeFlag: "--roots" | "--pids",
  pids: readonly number[],
  facets: SnapshotFacets,
): string[] {
  const args = ["snapshot", scopeFlag, pids.join(",")];
  if (facets.procs) args.push("--procs");
  if (facets.ports) args.push("--ports");
  if (facets.mem) args.push("--mem");
  if (facets.startTime) args.push("--start-time");
  return args;
}
const DEFAULT_SNAPSHOT: SnapshotFacets = { procs: true, ports: true };
function emptyReading(): OsfactsReading {
  return {
    procs: [],
    memory: [],
    startTimes: [],
    ports: [],
    unreadable: [],
    errors: [],
    cpus: [],
    networks: [],
    disks: [],
  };
}
export function snapshotSubtree(
  bin: string,
  rootPids: readonly number[],
  facets: SnapshotFacets = DEFAULT_SNAPSHOT,
): Promise<OsfactsReading> {
  return rootPids.length === 0
    ? Promise.resolve(emptyReading())
    : runOsfacts(bin, snapshotArgs("--roots", rootPids, facets));
}
export function snapshotPids(
  bin: string,
  pids: readonly number[],
  facets: SnapshotFacets = DEFAULT_SNAPSHOT,
): Promise<OsfactsReading> {
  return pids.length === 0
    ? Promise.resolve(emptyReading())
    : runOsfacts(bin, snapshotArgs("--pids", pids, facets));
}
export function snapshotPidsSync(
  bin: string,
  pids: readonly number[],
  facets: SnapshotFacets = DEFAULT_SNAPSHOT,
): OsfactsReading {
  return pids.length === 0
    ? emptyReading()
    : runOsfactsSync(bin, snapshotArgs("--pids", pids, facets));
}
export interface ProcessIdentity {
  pid: number;
  startUnixUs: number;
}
export function processIdentity(
  bin: string,
  pid: number,
): ProcessIdentity | undefined {
  const reading = snapshotPidsSync(bin, [pid], { startTime: true });
  const row = reading.startTimes.find((value) => value.pid === pid);
  if (row !== undefined) return { pid: row.pid, startUnixUs: row.startUnixUs };
  const unreadable = reading.unreadable.find(
    (value) => value.pid === pid && value.facet === "start_time",
  );
  if (
    unreadable !== undefined &&
    ["ESRCH", "ENOENT"].includes(unreadable.errno)
  )
    return undefined;
  throw new OsfactsClientError(
    "parse",
    unreadable !== undefined
      ? `osfacts could not read pid ${pid} start time (${unreadable.errno})`
      : `osfacts returned no start time for pid ${pid}`,
  );
}
export function host(bin: string, facets: HostFacets): Promise<OsfactsReading> {
  const args = ["host"];
  if (facets.load) args.push("--load");
  if (facets.mem) args.push("--mem");
  if (facets.cpu) args.push("--cpu");
  if (facets.net) args.push("--net");
  if (facets.disk) args.push("--disk");
  return runOsfacts(bin, args);
}
