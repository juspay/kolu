/**
 * What an agent-indicator assertion knew when it gave up.
 *
 * "Expected state X, got null" names the symptom and none of the cause. The
 * detector behind an indicator reads host facts the test never sees: the
 * terminal's process tree (`/proc/<pid>/comm`), its tty (`readlink
 * /proc/<pid>/fd/0`, which omp keys its breadcrumb on), the rendered screen
 * tail the screen-scrape poll matches, and what padi logged about it. On a
 * host that differs from a developer box (a bare Linux container, root, a
 * different /dev) those facts are exactly what differs, and by the time
 * anyone reads the CI log the host is gone. So the indicator steps collect
 * them at the moment of timeout and put them IN the assertion error.
 *
 * Every probe is best-effort and reports its own failure in place: the
 * diagnostic must never replace the real assertion with a crash of its own.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ttyIdForPid } from "kolu-omp";
import { ACTIVE_TERMINAL } from "./buffer.ts";
import { kavalSocketPath, padiStateDir } from "./hooks.ts";
import type { KoluWorld } from "./world.ts";

/** How many trailing lines of the rendered screen to show — the same window
 *  the claude-code and omp screen scrapes match against (TAIL_REGION_LINES). */
const SCREEN_TAIL_LINES = 40;
/** The padi log lines worth reading for agent detection. */
const DETECTOR_LOG_LINE = /screen-scrape|omp:|tty id|claude-code:/;
const PADI_LOG_TAIL = 30;

const describe = (err: unknown) =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

/** Run a probe; on failure, return the failure as the probe's value. */
function probe<T>(fn: () => T): T | string {
  try {
    return fn();
  } catch (err) {
    return `<unavailable: ${describe(err)}>`;
  }
}

interface ProcFacts {
  pid: number;
  ppid: string;
  comm: string;
  fd0: string;
  fd0Rdev: string;
  koluTtyId: string;
}

/** Every process carrying this terminal's `KAVAL_TERMINAL_ID` — the shell and
 *  whatever runs in it (a mock agent included), with the facts the detectors
 *  read. Linux only: it walks /proc. */
function processesOf(terminalId: string): ProcFacts[] | string {
  if (process.platform !== "linux") return "<skipped: /proc is Linux-only>";
  const marker = `KAVAL_TERMINAL_ID=${terminalId}`;
  const found: ProcFacts[] = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let environ: string;
    try {
      environ = fs.readFileSync(`/proc/${entry}/environ`, "latin1");
    } catch {
      continue; // gone, or not ours to read
    }
    if (!environ.split("\0").includes(marker)) continue;
    const pid = Number(entry);
    const stat = probe(() => fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    found.push({
      pid,
      // Field 4 of /proc/<pid>/stat, after the parenthesised comm.
      ppid: probe(() =>
        typeof stat === "string" && stat.includes(")")
          ? (stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1] ?? "?")
          : "?",
      ) as string,
      comm: probe(() =>
        fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim(),
      ) as string,
      fd0: probe(() => fs.readlinkSync(`/proc/${pid}/fd/0`)) as string,
      fd0Rdev: probe(() => {
        const rdev = fs.statSync(`/proc/${pid}/fd/0`).rdev;
        return `${Math.floor(rdev / 256)}:${rdev % 256}`;
      }) as string,
      koluTtyId: probe(() => String(ttyIdForPid(pid))) as string,
    });
  }
  return found;
}

/** The rendered screen tail as the daemon holds it — the same
 *  `getScreenText` the screen-scrape poll reads, via kaval-tui. */
function screenTail(terminalId: string): string {
  return probe(() => {
    const require = createRequire(import.meta.url);
    const main = path.join(
      path.dirname(require.resolve("kaval-tui/package.json")),
      "src",
      "main.ts",
    );
    return execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        main,
        "snapshot",
        terminalId,
        "--tail",
        String(SCREEN_TAIL_LINES),
        "--socket",
        kavalSocketPath(),
      ],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
    );
  }) as string;
}

/** The detector's own lines from this worker's padi log (and its rotation). */
function padiDetectorLines(): string[] | string {
  return probe(() => {
    const files = fs
      .readdirSync(padiStateDir)
      .filter((f) => /^padi(\.stderr)?\.log(\.\d+)?$/.test(f))
      .map((f) => path.join(padiStateDir, f));
    const lines = files.flatMap((f) =>
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => DETECTOR_LOG_LINE.test(l)),
    );
    return lines.slice(-PADI_LOG_TAIL).map((l) => l.slice(0, 300));
  });
}

function breadcrumbs(dir: string): string[] | string {
  return probe(() =>
    fs.readdirSync(dir).map((name) => {
      const body = probe(() =>
        fs
          .readFileSync(path.join(dir, name), "utf8")
          .trim()
          .split("\n")
          .join(" | "),
      );
      return `${name}: ${body}`;
    }),
  );
}

/** Collect the detector's inputs and format them for an assertion error. */
export async function agentDiagnostics(
  world: KoluWorld,
  opts: { breadcrumbDir?: string } = {},
): Promise<string> {
  const terminalId = await world.page
    .evaluate(
      (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
      ACTIVE_TERMINAL,
    )
    .catch((err: unknown) => `<unavailable: ${describe(err)}>`);
  const indicator = await world.page
    .evaluate(() => {
      const el = document.querySelector(
        '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
      );
      return el
        ? `state=${el.getAttribute("data-agent-state")} kind=${el.getAttribute("data-agent-kind")}`
        : "<no indicator element>";
    })
    .catch((err: unknown) => `<unavailable: ${describe(err)}>`);

  const id = typeof terminalId === "string" ? terminalId : undefined;
  const sections: [string, unknown][] = [
    ["terminal id", terminalId ?? "<no focused terminal>"],
    ["indicator (client)", indicator],
    [
      "processes (KAVAL_TERMINAL_ID)",
      id ? processesOf(id) : "<no terminal id>",
    ],
  ];
  if (opts.breadcrumbDir) {
    sections.push([
      `omp breadcrumbs (${opts.breadcrumbDir})`,
      breadcrumbs(opts.breadcrumbDir),
    ]);
  }
  sections.push(
    [
      `screen tail (kaval getScreenText, last ${SCREEN_TAIL_LINES})`,
      id ? screenTail(id) : "<no terminal id>",
    ],
    ["padi detector log lines", padiDetectorLines()],
  );

  const body = sections
    .map(([title, value]) => {
      const text = Array.isArray(value)
        ? value
            .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
            .join("\n")
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
      return `--- ${title}\n${text}`;
    })
    .join("\n");
  return `\n=== agent-indicator diagnostics ===\n${body}\n=== end diagnostics ===`;
}
