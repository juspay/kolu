/**
 * Parse nix's `--log-format internal-json` stream into human progress lines.
 *
 * During a cold remote provision the UI used to freeze on a single
 * `copying path '…'` line while a multi-hundred-MiB NAR downloaded with no
 * further human-readable chatter. Nix already knows byte/path progress — it
 * just emits it as `@nix {…}` JSON under `internal-json`. This module is the
 * ONE place that turns those events into the progress lines the connection
 * cell's log tail shows.
 *
 * Activity / result type numbers are the stable enums from nix's
 * `src/libutil/include/nix/util/logging.hh` (actCopyPath=100, resProgress=105,
 * …). A non-`@nix` line (or a malformed JSON payload) is forwarded unchanged
 * so network-error heuristics and any residual human chatter still reach the
 * tail.
 */

/** Nix ActivityType — only the ones we render. */
const ACT_COPY_PATH = 100;
const ACT_FILE_TRANSFER = 101;
const ACT_COPY_PATHS = 103;
const ACT_SUBSTITUTE = 108;

/** Nix ResultType. */
const RES_PROGRESS = 105;
const RES_SET_EXPECTED = 106;

const NIX_JSON_PREFIX = "@nix ";

/** Minimum wall time between successive emitted progress lines — nix can fire
 *  resProgress many times per second; the connect tail only needs a live
 *  readout, not a firehose. Path-start lines and path-count updates always
 *  emit (they're rare + informative). */
const EMIT_MIN_INTERVAL_MS = 500;

interface NixJson {
  action?: string;
  id?: number;
  type?: number;
  text?: string;
  /** Present on `action: "msg"` lines (nix puts the string under `msg`, not `text`). */
  msg?: string;
  fields?: unknown[];
}

interface Activity {
  type: number;
  text: string;
  /** Path being copied / substituted, when known. */
  path?: string;
  done: number;
  expected: number;
}

export interface NixProgressReporter {
  /** Feed one stderr/stdout line (may be `@nix {…}` or raw text). */
  (line: string): void;
}

/** Build a progress reporter that calls `onProgress` with human lines. */
export function makeNixProgressReporter(
  onProgress: (line: string) => void,
  now: () => number = Date.now,
): NixProgressReporter {
  const activities = new Map<number, Activity>();
  /** Paths finished (actCopyPath / actSubstitute stops). */
  let pathsDone = 0;
  /** From actCopyPaths + resSetExpected, when known. */
  let pathsExpected = 0;
  let lastEmitAt = 0;
  /** Last emitted summary, so we skip identical re-emits. */
  let lastEmitted = "";

  const emit = (line: string, force = false): void => {
    if (line === lastEmitted) return;
    const t = now();
    if (!force && t - lastEmitAt < EMIT_MIN_INTERVAL_MS) return;
    lastEmitAt = t;
    lastEmitted = line;
    onProgress(line);
  };

  const shortPath = (p: string): string => {
    // `/nix/store/hash-name` → `…-name` so the tail stays scannable.
    const m = p.match(/\/nix\/store\/[a-z0-9]+-(.+)$/);
    return m?.[1] ?? p;
  };

  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  };

  /** Aggregate byte progress across every in-flight copy/transfer/substitute. */
  const byteTotals = (): { done: number; expected: number } => {
    let done = 0;
    let expected = 0;
    for (const a of activities.values()) {
      if (
        a.type === ACT_COPY_PATH ||
        a.type === ACT_FILE_TRANSFER ||
        a.type === ACT_SUBSTITUTE
      ) {
        done += a.done;
        expected += a.expected;
      }
    }
    return { done, expected };
  };

  const summaryLine = (current?: string): string => {
    const { done, expected } = byteTotals();
    const parts: string[] = [];
    if (pathsExpected > 0) {
      parts.push(
        `path ${Math.min(pathsDone + 1, pathsExpected)} of ${pathsExpected}`,
      );
    } else if (pathsDone > 0) {
      parts.push(`${pathsDone} path${pathsDone === 1 ? "" : "s"} done`);
    }
    if (expected > 0) {
      parts.push(`${formatBytes(done)} of ${formatBytes(expected)}`);
    } else if (done > 0) {
      parts.push(formatBytes(done));
    }
    if (current) parts.push(shortPath(current));
    return parts.length > 0 ? parts.join(" · ") : "copying…";
  };

  const handleStart = (j: NixJson): void => {
    if (typeof j.id !== "number" || typeof j.type !== "number") return;
    const text = typeof j.text === "string" ? j.text : "";
    const fields = Array.isArray(j.fields) ? j.fields : [];
    let path: string | undefined;
    // actCopyPath fields: [storePath, srcUri, dstUri]
    // actSubstitute / actFileTransfer: path often in text or fields[0]
    if (typeof fields[0] === "string" && fields[0].startsWith("/nix/store/")) {
      path = fields[0];
    } else {
      const m = text.match(/\/nix\/store\/[a-z0-9]+-[^\s'"]+/);
      if (m) path = m[0];
    }
    activities.set(j.id, {
      type: j.type,
      text,
      path,
      done: 0,
      expected: 0,
    });
    if (j.type === ACT_COPY_PATHS) {
      // text like "copying 42 paths" — also fields may carry the count
      const m = text.match(/copying\s+(\d+)\s+paths?/i);
      if (m) pathsExpected = Number(m[1]);
      else if (typeof fields[0] === "number") pathsExpected = fields[0];
      if (pathsExpected > 0) {
        emit(
          `copying ${pathsExpected} path${pathsExpected === 1 ? "" : "s"}…`,
          true,
        );
      }
    } else if (
      j.type === ACT_COPY_PATH ||
      j.type === ACT_SUBSTITUTE ||
      j.type === ACT_FILE_TRANSFER
    ) {
      emit(summaryLine(path), true);
    }
  };

  const handleResult = (j: NixJson): void => {
    if (typeof j.id !== "number" || typeof j.type !== "number") return;
    const a = activities.get(j.id);
    if (a === undefined) return;
    const fields = Array.isArray(j.fields) ? j.fields : [];
    if (j.type === RES_PROGRESS) {
      // fields: [done, expected, running, failed]
      if (typeof fields[0] === "number") a.done = fields[0];
      if (typeof fields[1] === "number") a.expected = fields[1];
      emit(summaryLine(a.path));
    } else if (j.type === RES_SET_EXPECTED) {
      // fields: [activityType, expected]
      const actType = fields[0];
      const expected = fields[1];
      if (actType === ACT_COPY_PATH && typeof expected === "number") {
        // Per-activity expected is also carried on resProgress; the aggregate
        // path-count expected can arrive here on actCopyPaths.
        if (a.type === ACT_COPY_PATHS) pathsExpected = expected;
      }
    }
  };

  const handleStop = (j: NixJson): void => {
    if (typeof j.id !== "number") return;
    const a = activities.get(j.id);
    if (a === undefined) return;
    if (
      a.type === ACT_COPY_PATH ||
      a.type === ACT_SUBSTITUTE ||
      a.type === ACT_FILE_TRANSFER
    ) {
      pathsDone += 1;
      emit(summaryLine(), true);
    }
    activities.delete(j.id);
  };

  return (line: string): void => {
    if (!line.startsWith(NIX_JSON_PREFIX)) {
      // Raw human line (or a non-nix tool) — pass through.
      onProgress(line);
      return;
    }
    let j: NixJson;
    try {
      j = JSON.parse(line.slice(NIX_JSON_PREFIX.length)) as NixJson;
    } catch {
      // Malformed @nix payload — surface the raw line rather than drop it.
      onProgress(line);
      return;
    }
    switch (j.action) {
      case "start":
        handleStart(j);
        break;
      case "result":
        handleResult(j);
        break;
      case "stop":
        handleStop(j);
        break;
      case "msg": {
        // Verbosity chatter — forward non-empty human messages (nix puts the
        // string under `msg`, not `text`).
        const m =
          typeof j.msg === "string" && j.msg.trim()
            ? j.msg
            : typeof j.text === "string" && j.text.trim()
              ? j.text
              : null;
        if (m !== null) onProgress(m);
        break;
      }
      default:
        break;
    }
  };
}
