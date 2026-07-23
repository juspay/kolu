/**
 * Thin drop-by-default filter for nix `--log-format internal-json` stderr.
 *
 * Only transfer progress (and optional "building …" starts) reach the connect
 * overlay. Every other `@nix` event is dropped — so raw JSON can never leak
 * into the user's log box (#1962 / #1964). Non-`@nix` plain lines pass through.
 */

/** Nix activity / result types we care about (logging.hh). */
const ACT_COPY_PATH = 100;
const ACT_FILE_TRANSFER = 101;
const ACT_COPY_PATHS = 103;
const ACT_BUILD = 105;
const ACT_SUBSTITUTE = 108;
const RES_PROGRESS = 105;

const NIX_JSON_PREFIX = "@nix ";
const EMIT_MIN_MS = 500;
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

type NixJson = {
  action?: string;
  id?: number;
  type?: number;
  text?: string;
  fields?: unknown[];
};

/** ONE throttled status line for copy/transfer; drop-by-default for all other @nix. */
export function makeNixProgressReporter(
  onProgress: (line: string) => void,
  now: () => number = Date.now,
): (line: string) => void {
  /** In-flight copy/transfer activities: id → { done, expected } bytes. */
  const xfer = new Map<number, { done: number; expected: number }>();
  let pathsDone = 0;
  let pathsExpected = 0;
  let lastAt = 0;
  let lastLine = "";

  const emit = (line: string, force = false): void => {
    if (line === lastLine) return;
    const t = now();
    if (!force && t - lastAt < EMIT_MIN_MS) return;
    lastAt = t;
    lastLine = line;
    onProgress(line);
  };

  const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  };

  const statusLine = (): string => {
    let done = 0;
    let expected = 0;
    for (const x of xfer.values()) {
      done += x.done;
      expected += x.expected;
    }
    const parts: string[] = [];
    if (pathsExpected > 0)
      parts.push(
        `path ${Math.min(pathsDone + 1, pathsExpected)} of ${pathsExpected}`,
      );
    else if (pathsDone > 0)
      parts.push(`${pathsDone} path${pathsDone === 1 ? "" : "s"} done`);
    if (expected > 0) parts.push(`${fmtBytes(done)} of ${fmtBytes(expected)}`);
    else if (done > 0) parts.push(fmtBytes(done));
    return parts.length > 0 ? parts.join(" · ") : "copying…";
  };

  return (line: string): void => {
    if (!line.startsWith(NIX_JSON_PREFIX)) {
      onProgress(line);
      return;
    }
    let j: NixJson;
    try {
      j = JSON.parse(line.slice(NIX_JSON_PREFIX.length)) as NixJson;
    } catch {
      return; // drop malformed @nix
    }

    if (j.action === "start" && typeof j.id === "number") {
      const type = j.type;
      const text =
        typeof j.text === "string" ? j.text.replace(ANSI_RE, "") : "";
      if (type === ACT_COPY_PATHS) {
        const m = text.match(/copying\s+(\d+)\s+paths?/i);
        if (m) pathsExpected = Number(m[1]);
        if (pathsExpected > 0)
          emit(
            `copying ${pathsExpected} path${pathsExpected === 1 ? "" : "s"}…`,
            true,
          );
        return;
      }
      if (
        type === ACT_COPY_PATH ||
        type === ACT_FILE_TRANSFER ||
        type === ACT_SUBSTITUTE
      ) {
        xfer.set(j.id, { done: 0, expected: 0 });
        emit(statusLine(), true);
        return;
      }
      if (type === ACT_BUILD && text.trim()) {
        // Optional: "building '/nix/store/…-name.drv'" → short human line.
        const name =
          text.match(/\/nix\/store\/[a-z0-9]+-([^/\s']+)/)?.[1] ?? text.trim();
        emit(`building ${name}`, true);
        return;
      }
      return; // drop every other start
    }

    if (j.action === "result" && typeof j.id === "number") {
      if (j.type !== RES_PROGRESS) return; // drop build-log lines, etc.
      const x = xfer.get(j.id);
      if (x === undefined) return;
      const fields = Array.isArray(j.fields) ? j.fields : [];
      if (typeof fields[0] === "number") x.done = fields[0];
      if (typeof fields[1] === "number") x.expected = fields[1];
      emit(statusLine());
      return;
    }

    if (j.action === "stop" && typeof j.id === "number") {
      if (xfer.has(j.id)) {
        xfer.delete(j.id);
        pathsDone += 1;
        emit(statusLine(), true);
      }
      return;
    }
    // drop msg / unknown / anything else @nix
  };
}
