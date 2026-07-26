/**
 * Spawn osfacts and parse its versioned TSV. Pure protocol + process edge.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Schema version this reader understands. Bump only with osfacts. */
export const OSFACTS_FORMAT_VERSION = 1;

/** How long osfacts may run before it is killed. Generous against the measured
 *  ~5–10 ms so a loaded box is not mistaken for a hang. */
export const OSFACTS_COMMAND_TIMEOUT_MS = 5_000;

const TCP_PORT_MIN = 1;
const TCP_PORT_MAX = 65535;

/** Port 0 is the kernel's "any", never a server you can point at. */
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

/** One listening socket as the binary printed it — raw network-order hex. */
export interface ListenerRow {
  pid: number;
  port: number;
  /** Network-order bind address as hex (8 or 32 digits). */
  address: string;
}

export interface UnreadableRow {
  pid: number;
  errno: string;
}

export interface OsfactsReading {
  procs: ProcessRow[];
  ports: ListenerRow[];
  unreadable: UnreadableRow[];
}

function errnoOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
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
    throw new OsfactsClientError(
      "version",
      `osfacts did not begin with a version line (got ${JSON.stringify(first.slice(0, 40))})`,
    );
  }
  if (Number(version[1]) !== OSFACTS_FORMAT_VERSION) {
    throw new OsfactsClientError(
      "version",
      `osfacts speaks format ${version[1]}, this reader speaks ${OSFACTS_FORMAT_VERSION} — binary and client are from different sources`,
    );
  }

  const procs: ProcessRow[] = [];
  const ports: ListenerRow[] = [];
  const unreadable: UnreadableRow[] = [];

  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const f = line.split("\t");
    if (f[0] === "P") {
      if (f.length !== 4) {
        throw new OsfactsClientError(
          "parse",
          `unreadable osfacts process row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      const ppid = Number(f[2]);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
        throw new OsfactsClientError(
          "parse",
          `osfacts process row has a non-numeric pid: ${line}`,
        );
      }
      procs.push({ pid, ppid, name: f[3]! });
      continue;
    }
    if (f[0] === "L") {
      if (f.length !== 4) {
        throw new OsfactsClientError(
          "parse",
          `unreadable osfacts listener row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      const port = Number(f[2]);
      if (!Number.isInteger(pid)) {
        throw new OsfactsClientError(
          "parse",
          `osfacts listener row has a non-numeric pid: ${line}`,
        );
      }
      if (!isTcpPort(port)) {
        throw new OsfactsClientError(
          "parse",
          `osfacts listener row carries no valid port: ${line}`,
        );
      }
      const address = f[3]!;
      if (
        (address.length !== 8 && address.length !== 32) ||
        !/^[0-9A-Fa-f]+$/.test(address)
      ) {
        throw new OsfactsClientError(
          "parse",
          `osfacts listener row has a bad bind address: ${line}`,
        );
      }
      ports.push({ pid, port, address });
      continue;
    }
    if (f[0] === "U") {
      if (f.length !== 3) {
        throw new OsfactsClientError(
          "parse",
          `unreadable osfacts U row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      if (!Number.isInteger(pid)) {
        throw new OsfactsClientError(
          "parse",
          `osfacts U row has a non-numeric pid: ${line}`,
        );
      }
      const errno = f[2]!;
      if (errno === "") {
        throw new OsfactsClientError(
          "parse",
          `osfacts U row has empty errno: ${line}`,
        );
      }
      unreadable.push({ pid, errno });
      continue;
    }
    throw new OsfactsClientError(
      "parse",
      `unknown osfacts row tag ${JSON.stringify(f[0] ?? "")}: ${line}`,
    );
  }
  return { procs, ports, unreadable };
}

async function runOsfacts(
  bin: string,
  args: string[],
): Promise<OsfactsReading> {
  if (!bin) {
    throw new OsfactsClientError(
      "spawn",
      "osfacts binary path is empty — the caller must supply an absolute path",
    );
  }
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

/** Snapshot process subtrees under the given roots (`--roots`). */
export function snapshotSubtree(
  bin: string,
  rootPids: readonly number[],
): Promise<OsfactsReading> {
  if (rootPids.length === 0) {
    return Promise.resolve({ procs: [], ports: [], unreadable: [] });
  }
  return runOsfacts(bin, [
    "snapshot",
    "--roots",
    rootPids.join(","),
    "--procs",
    "--ports",
  ]);
}

/** Snapshot an exact pid set (`--pids`). */
export function snapshotPids(
  bin: string,
  pids: readonly number[],
): Promise<OsfactsReading> {
  if (pids.length === 0) {
    return Promise.resolve({ procs: [], ports: [], unreadable: [] });
  }
  return runOsfacts(bin, [
    "snapshot",
    "--pids",
    pids.join(","),
    "--procs",
    "--ports",
  ]);
}
