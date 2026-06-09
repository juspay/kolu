/**
 * `odu run`'s face — three renderings of the same fan-in state, picked by
 * where stdout points:
 *
 *   - `json`  (`--progress json`): one NDJSON line per node transition — the
 *     machine contract `/do` consumes; byte-stable, never styled.
 *   - `plain` (stdout is a pipe/file): one line per transition with glyph +
 *     duration, plus a 60-second heartbeat naming the still-running nodes so
 *     a captured log never *looks* hung between transitions.
 *   - `live`  (stdout is a TTY): an in-place recipes × lanes matrix with
 *     spinners, ticking elapsed times, and a one-line tail of whatever the
 *     busiest node just printed. Terminal failures also print a persistent
 *     line above the matrix so they survive in scrollback.
 *
 * The live renderer owns the terminal: it hides the cursor, repaints a
 * bounded region, and interposes `process.stderr.write` so library chatter
 * (surface-nix-host's `[host:…]` provisioning lines — already duplicated
 * into `_ci-setup`'s log) can't shred the region; anything else written to
 * stderr is re-printed intact above the matrix.
 */

import { formatGoDuration } from "../common/duration";
import { splitFanId } from "../common/nodeId";
import {
  type NodeState,
  type PipelineState,
  type ProgressStatus,
  STATUS_META,
} from "../common/surface";
import {
  bold,
  dim,
  green,
  link,
  magenta,
  red,
  spinnerAt,
  stripAnsi,
  yellow,
} from "../cli/ansi";
import { STATUS_COLOR, summarize } from "../cli/render";

export type DisplayMode = "json" | "plain" | "live";

export interface ProgressEvent {
  node: string;
  recipe: string;
  platform: string;
  status: ProgressStatus;
  exit_code?: number;
  log: string;
}

export interface RunHeader {
  pipeline: string;
  sha7: string;
  /** Uncommitted changes in the tree this run reads (live-tree mode only —
   *  strict refuses a dirty tree). Shown loudly: a dirty run's verdict is
   *  about your working tree, not the commit. */
  dirty: boolean;
  /** Forge page for the commit (GitHub origins) — the sha label becomes an
   *  OSC 8 hyperlink on terminals that render them. Null elsewhere. */
  commitUrl: string | null;
  lanes: ReadonlyArray<{ platform: string; host: string }>;
  hostsSource: string;
}

/** `3cbac86` for a clean run, `3cbac86+dirty` when the working tree has
 *  uncommitted changes — every face shows which code the verdict is about. */
export function commitLabel(header: Pick<RunHeader, "sha7" | "dirty">): string {
  return header.dirty ? `${header.sha7}+dirty` : header.sha7;
}

export interface Display {
  start(header: RunHeader): void;
  /** Latest fan-in state — live repaints from it, plain heartbeats off it. */
  update(state: PipelineState): void;
  /** A node crossed a status boundary (the diff-driven event feed). */
  transition(event: ProgressEvent, node: NodeState): void;
  /** A chunk of some node's log arrived (live's footer feed). */
  logLine(id: string, text: string): void;
  /** Operator-facing message (post failures, signals, …). */
  info(msg: string): void;
  /** Stop timers, restore the terminal, paint the final frame. */
  stop(state?: PipelineState): void;
}

export function createDisplay(mode: DisplayMode): Display {
  if (mode === "json") return new JsonDisplay();
  if (mode === "plain") return new PlainDisplay();
  return new LiveDisplay();
}

/** Short display name for a fan-in node id: `ci::e2e@x86_64-linux` → `e2e`
 *  (the matrix's columns carry the platform; `ci::` is the one module prefix
 *  every kolu pipeline shares, so it's noise in a narrow cell). */
function recipeLabel(namepath: string): string {
  return namepath.startsWith("ci::") ? namepath.slice(4) : namepath;
}

function glyphFor(status: NodeState["status"], tick: number): string {
  const raw =
    status === "running" ? spinnerAt(tick) : STATUS_META[status].glyph;
  return STATUS_COLOR[status](raw);
}

// ── json ────────────────────────────────────────────────────────────────────

class JsonDisplay implements Display {
  start(): void {}
  update(): void {}
  transition(event: ProgressEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
  logLine(): void {}
  info(msg: string): void {
    process.stderr.write(`${msg}\n`);
  }
  stop(): void {}
}

// ── plain ───────────────────────────────────────────────────────────────────

const HEARTBEAT_MS = 60_000;

class PlainDisplay implements Display {
  private state: PipelineState | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastWrite = Date.now();

  start(header: RunHeader): void {
    const lanes = header.lanes
      .map((l) => `${l.platform}=${l.host}`)
      .join(" · ");
    this.say(
      `odu · ${header.pipeline} @ ${commitLabel(header)} · ${lanes} (hosts: ${header.hostsSource})`,
    );
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref?.();
  }

  update(state: PipelineState): void {
    this.state = state;
  }

  transition(event: ProgressEvent, node: NodeState): void {
    const glyph = STATUS_META[node.status].glyph;
    const dur =
      node.durationMs !== null ? ` ${formatGoDuration(node.durationMs)}` : "";
    const logRef =
      node.status === "failed" || node.status === "errored"
        ? `  → ${event.log}`
        : "";
    this.say(`${glyph} ${event.status.padEnd(7)} ${event.node}${dur}${logRef}`);
  }

  logLine(): void {}

  info(msg: string): void {
    process.stderr.write(`${msg}\n`);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /** Between transitions a captured log goes silent for however long the
   *  slowest node takes (darwin e2e: ~30 min) — name the laggards once a
   *  minute so the log reads as alive. */
  private heartbeat(): void {
    if (this.state === undefined) return;
    if (Date.now() - this.lastWrite < HEARTBEAT_MS) return;
    const now = Date.now();
    const running = this.state.order
      .map((id) => this.state?.nodes[id])
      .filter((n): n is NodeState => n !== undefined && n.status === "running")
      .map((n) => `${n.id} (${formatGoDuration(now - (n.startedAt ?? now))})`);
    if (running.length > 0) this.say(`… still running: ${running.join(", ")}`);
  }

  private say(line: string): void {
    this.lastWrite = Date.now();
    process.stdout.write(`${line}\n`);
  }
}

// ── live ────────────────────────────────────────────────────────────────────

const TICK_MS = 120;

/** Pure frame renderer — exported for tests (ANSI auto-disables off-TTY). */
export function renderRunFrame(opts: {
  state: PipelineState;
  header: RunHeader;
  tick: number;
  startedAt: number;
  now: number;
  lastLog?: { id: string; text: string };
  columns: number;
}): string {
  const { state, header, tick, now } = opts;
  const platforms = [
    ...new Set(state.order.map((id) => splitFanId(id).platform)),
  ];
  const recipes: string[] = [];
  for (const id of state.order) {
    const { namepath } = splitFanId(id);
    if (!recipes.includes(namepath)) recipes.push(namepath);
  }

  const summary = summarize(state);
  const headGlyph = summary.done
    ? summary.failedOverall
      ? red("✗")
      : green("✔")
    : yellow(spinnerAt(tick));
  const shaText =
    header.commitUrl !== null
      ? link(commitLabel(header), header.commitUrl)
      : commitLabel(header);
  const sha = header.dirty ? yellow(`@ ${shaText}`) : dim(`@ ${shaText}`);
  const lines: string[] = [
    `${bold("odu")} ${headGlyph} ${header.pipeline} ${sha} ${dim(
      formatGoDuration(now - opts.startedAt),
    )}`,
    dim(
      `  ${header.lanes.map((l) => `${l.platform} = ${l.host}`).join(" · ")}`,
    ),
    "",
  ];

  const nameWidth = Math.max(9, ...recipes.map((r) => recipeLabel(r).length));
  const cellWidth = Math.max(14, ...platforms.map((p) => p.length + 2));
  lines.push(
    dim(
      `  ${"".padEnd(nameWidth)}  ${platforms
        .map((p) => p.padEnd(cellWidth))
        .join("")}`,
    ),
  );
  for (const recipe of recipes) {
    const cells = platforms.map((platform) => {
      const node = state.nodes[`${recipe}@${platform}`];
      if (node === undefined) return "".padEnd(cellWidth);
      const glyph = glyphFor(node.status, tick);
      const time =
        node.status === "running"
          ? formatGoDuration(now - (node.startedAt ?? now))
          : node.durationMs !== null
            ? formatGoDuration(node.durationMs)
            : "";
      const plain = `${STATUS_META[node.status].glyph} ${time}`;
      return `${glyph} ${dim(time)}${"".padEnd(Math.max(0, cellWidth - plain.length))}`;
    });
    lines.push(`  ${recipeLabel(recipe).padEnd(nameWidth)}  ${cells.join("")}`);
  }

  lines.push("");
  const counts = [
    summary.ok > 0 ? green(`${summary.ok} ok`) : null,
    summary.running > 0 ? yellow(`${summary.running} running`) : null,
    summary.pending > 0 ? dim(`${summary.pending} pending`) : null,
    summary.failed > 0 ? red(`${summary.failed} failed`) : null,
    summary.errored > 0 ? magenta(`${summary.errored} errored`) : null,
    summary.skipped > 0 ? dim(`${summary.skipped} skipped`) : null,
  ].filter((s): s is string => s !== null);
  lines.push(`  ${counts.join(dim(" · "))}`);

  if (opts.lastLog !== undefined && !summary.done) {
    const label = `› ${opts.lastLog.id}`;
    const budget = Math.max(20, opts.columns - label.length - 5);
    const text = opts.lastLog.text.slice(0, budget);
    lines.push(dim(`  ${label}  ${text}`));
  }
  return lines.join("\n");
}

class LiveDisplay implements Display {
  private header: RunHeader | undefined;
  private state: PipelineState | undefined;
  private lastLog: { id: string; text: string } | undefined;
  private tick = 0;
  private prevHeight = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly startedAt = Date.now();
  private readonly stderrWrite = process.stderr.write.bind(process.stderr);
  private stopped = false;

  start(header: RunHeader): void {
    this.header = header;
    process.stdout.write("\x1b[?25l");
    this.hookStderr();
    // Whatever path the process dies by (a throw past orchestrate, a missed
    // stop()), the terminal must come back: cursor shown, stderr unhooked.
    process.once("exit", () => {
      if (!this.stopped) {
        process.stderr.write = this.stderrWrite;
        process.stdout.write("\x1b[?25h");
      }
    });
    this.timer = setInterval(() => {
      this.tick += 1;
      this.paint();
    }, TICK_MS);
    this.timer.unref?.();
  }

  update(state: PipelineState): void {
    this.state = state;
    if (this.lastLog !== undefined) {
      // Drop the footer once its node stops running — a stale tail line
      // from a finished node reads as a hang, the exact feel this kills.
      const node = state.nodes[this.lastLog.id];
      if (node === undefined || node.status !== "running") {
        this.lastLog = undefined;
      }
    }
  }

  transition(event: ProgressEvent, node: NodeState): void {
    // Reds persist in scrollback; greens live in the matrix.
    if (node.status !== "failed" && node.status !== "errored") return;
    const color = node.status === "failed" ? red : magenta;
    const dur =
      node.durationMs !== null ? ` (${formatGoDuration(node.durationMs)})` : "";
    this.printAbove(
      color(
        `${STATUS_META[node.status].glyph} ${event.node} ${node.status}${dur}`,
      ) + dim(`  → ${event.log}`),
    );
  }

  logLine(id: string, text: string): void {
    const node = this.state?.nodes[id];
    if (node === undefined || node.status !== "running") return;
    const line = stripAnsi(text)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .at(-1);
    if (line !== undefined) this.lastLog = { id, text: line };
  }

  info(msg: string): void {
    this.printAbove(msg);
  }

  stop(state?: PipelineState): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (state !== undefined) this.state = state;
    this.paint();
    process.stderr.write = this.stderrWrite;
    process.stdout.write("\x1b[?25h");
    this.prevHeight = 0;
  }

  /** Library chatter must not shred the repaint region: `[host:…]` lines
   *  (surface-nix-host provisioning — already mirrored into `_ci-setup`'s
   *  log file) are dropped; everything else re-prints above the matrix. */
  private hookStderr(): void {
    const handler: typeof process.stderr.write = (
      chunk: Uint8Array | string,
      encodingOrCb?: unknown,
      maybeCb?: unknown,
    ): boolean => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString("utf-8");
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        if (line.startsWith("[host:")) continue;
        this.printAbove(dim(stripAnsi(line)));
      }
      const cb = [encodingOrCb, maybeCb].find(
        (a): a is () => void => typeof a === "function",
      );
      cb?.();
      return true;
    };
    process.stderr.write = handler;
  }

  /** Print a persistent line above the live region: erase the region, emit
   *  the line into normal scrollback, repaint below it. */
  private printAbove(line: string): void {
    let out = "";
    if (this.prevHeight > 0) out += `\x1b[${this.prevHeight}F\x1b[0J`;
    this.prevHeight = 0;
    out += `${line}\n`;
    process.stdout.write(out);
    this.paint();
  }

  private paint(): void {
    if (this.header === undefined || this.state === undefined) return;
    const frame = renderRunFrame({
      state: this.state,
      header: this.header,
      tick: this.tick,
      startedAt: this.startedAt,
      now: Date.now(),
      lastLog: this.lastLog,
      columns: process.stdout.columns ?? 100,
    });
    let out = "";
    if (this.prevHeight > 0) out += `\x1b[${this.prevHeight}F\x1b[0J`;
    out += `${frame}\n`;
    process.stdout.write(out);
    this.prevHeight = frame.split("\n").length;
  }
}
