/**
 * Running agent-distro's updater once — the process side of its `--progress`
 * contract (the line format is `@kolu/agent-distro/progress`). Its volatility is the
 * updater's invocation: argv, stdout/stderr, exit, and the temp config it reads.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  parseUpdaterLine,
  UPDATER_PROGRESS_ARGS,
  type UpdaterProgress,
  type UpdaterResult,
} from "@kolu/agent-distro/progress";

/** Write a host-concrete updater config into its own temp dir. A write that
 *  fails removes the dir before rethrowing, so a failed prepare leaves nothing
 *  behind. `remove()` deletes it; it throws on a removal that fails. */
export function writeUpdaterConfig(text: string): {
  readonly configPath: string;
  readonly remove: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "kolu-agent-distro-"));
  const remove = () => rmSync(dir, { recursive: true, force: true });
  const configPath = join(dir, "update.json");
  try {
    writeFileSync(configPath, text, { mode: 0o600 });
  } catch (err) {
    remove();
    throw err;
  }
  return { configPath, remove };
}

export type UpdaterOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

/** The updater's last stderr line, minus the `agent-distro: ` prefix it puts on
 *  every message — what a run that died WITHOUT its result line last said. */
function lastWord(lines: readonly string[]): string | undefined {
  return lines
    .findLast((l) => l.trim() !== "")
    ?.trim()
    .replace(/^agent-distro:\s*/, "");
}

/** Run agent-distro's updater once (`--progress`) and settle with its outcome.
 *  Progress lines feed `onProgress`; the outcome is the updater's own `result`
 *  line — `skipped` / `failed` carry its reason verbatim ("cache … not usable;
 *  add it to nix.settings …"). A run that ends without a result line (a crash,
 *  a kill) is a failure naming its exit and its last stderr line. Never
 *  rejects: a spawn error is an outcome too. */
export function runUpdater(opts: {
  readonly command: readonly string[];
  readonly configPath: string;
  readonly onProgress: (progress: UpdaterProgress) => void;
}): Promise<UpdaterOutcome> {
  const [bin, ...args] = opts.command;
  if (bin === undefined)
    return Promise.resolve({ ok: false, message: "empty updater command" });
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      [...args, opts.configPath, ...UPDATER_PROGRESS_ARGS],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let result: UpdaterResult | undefined;
    // The first protocol violation, quoted — it outranks whatever the run
    // reports after it, so a format change upstream is a visible error, never
    // a "Downloading agents…" that silently stops counting.
    let violation: string | undefined;
    const stderr: string[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      const read = parseUpdaterLine(line);
      if (read === null) return;
      if ("malformed" in read) {
        violation ??= `the updater wrote an unexpected --progress line: ${read.malformed}`;
      } else if ("progress" in read) {
        opts.onProgress(read.progress);
      } else if (result !== undefined) {
        violation ??= `the updater wrote a second result line: ${line.trim()}`;
      } else {
        result = read.result;
      }
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      stderr.push(line);
      // Bounded: a long `nix build` log is noise past its last few lines.
      if (stderr.length > 50) stderr.shift();
    });
    child.on("error", (err) =>
      resolve({ ok: false, message: `cannot run the updater: ${err.message}` }),
    );
    child.on("close", (code, signal) => {
      if (violation !== undefined) {
        resolve({ ok: false, message: violation });
        return;
      }
      if (result === undefined) {
        const said = lastWord(stderr);
        const how =
          signal !== null ? `was killed (${signal})` : `exited ${code}`;
        resolve({
          ok: false,
          message: `the updater ${how} without a result${said === undefined ? "" : `: ${said}`}`,
        });
        return;
      }
      switch (result.result) {
        case "updated":
        case "unchanged":
          resolve({ ok: true, message: `${result.result}: ${result.bundle}` });
          return;
        case "skipped":
        case "failed":
          resolve({ ok: false, message: result.reason });
          return;
        default:
          result satisfies never;
      }
    });
  });
}
