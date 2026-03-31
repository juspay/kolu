/**
 * Plan file metadata provider — watches plan directories for .md files.
 *
 * Triggered by CWD changes. Resolves plan directories from:
 *   1. Project-local: <repoRoot>/.claude/plans/ (or plansDirectory from settings.json)
 *   2. User-global: ~/.claude/plans/
 *
 * Updates the terminal's metadata.plans field with the list of detected plan files.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { PlanFile } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

const GLOBAL_PLANS_DIR = path.join(os.homedir(), ".claude", "plans");
const DEBOUNCE_MS = 500;

/** Read plansDirectory from a project's .claude/settings.json, if present. */
function readPlansDirectory(projectRoot: string): string | null {
  try {
    const settingsPath = path.join(projectRoot, ".claude", "settings.json");
    const raw = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw);
    if (typeof settings.plansDirectory === "string") {
      const dir = settings.plansDirectory;
      // Resolve relative to project root
      return path.isAbsolute(dir) ? dir : path.resolve(projectRoot, dir);
    }
  } catch {
    // No settings or unreadable — fall through
  }
  return null;
}

/** Collect unique plan directories for a project CWD. */
function resolvePlanDirs(cwd: string): string[] {
  const dirs = new Set<string>();

  // Always include global plans
  dirs.add(GLOBAL_PLANS_DIR);

  // Walk up from cwd looking for .claude/ (project root heuristic)
  // Also check if the git provider has set repoRoot — prefer that
  let projectRoot: string | null = null;

  // Try finding .claude directory from cwd upward
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".claude"))) {
      projectRoot = dir;
      break;
    }
    dir = path.dirname(dir);
  }

  if (projectRoot) {
    const customDir = readPlansDirectory(projectRoot);
    if (customDir) {
      dirs.add(customDir);
    } else {
      dirs.add(path.join(projectRoot, ".claude", "plans"));
    }
  }

  return [...dirs];
}

/** Scan a single directory for .md plan files. */
function scanDir(dir: string, projectPath: string | null): PlanFile[] {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    return files.map((f) => {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      return {
        path: fullPath,
        name: f.replace(/\.md$/, ""),
        projectPath,
        modifiedAt: stat.mtimeMs,
      };
    });
  } catch {
    return [];
  }
}

/** Scan all plan directories and return a sorted list of plan files. */
function scanAllPlans(planDirs: string[], cwd: string): PlanFile[] {
  const plans: PlanFile[] = [];
  for (const dir of planDirs) {
    const isGlobal = dir === GLOBAL_PLANS_DIR;
    plans.push(...scanDir(dir, isGlobal ? null : cwd));
  }
  // Sort by most recently modified first
  plans.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return plans;
}

/** Compare two plan file lists for equality. */
function plansEqual(a: PlanFile[] | null, b: PlanFile[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.path !== y.path || x.modifiedAt !== y.modifiedAt) return false;
  }
  return true;
}

/**
 * Start the plans metadata provider for a terminal.
 * Watches plan directories and updates metadata.plans.
 */
export function startPlansProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "plans", terminal: terminalId });
  const ac = new AbortController();

  let watchers: fs.FSWatcher[] = [];
  let currentDirs: string[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function refresh() {
    const plans = scanAllPlans(currentDirs, entry.info.meta.cwd);
    const result = plans.length > 0 ? plans : null;
    if (plansEqual(result, entry.info.meta.plans)) return;
    plog.info({ count: plans.length }, "plans updated");
    updateMetadata(entry, terminalId, (m) => { m.plans = result; });
  }

  function debouncedRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, DEBOUNCE_MS);
  }

  function setupWatchers(dirs: string[]) {
    // Tear down old watchers
    for (const w of watchers) w.close();
    watchers = [];
    currentDirs = dirs;

    for (const dir of dirs) {
      try {
        // Only watch directories that already exist — don't create them
        if (!fs.existsSync(dir)) continue;
        const w = fs.watch(dir, () => debouncedRefresh());
        watchers.push(w);
      } catch {
        plog.debug({ dir }, "cannot watch plan directory");
      }
    }

    // Initial scan
    refresh();
  }

  // Set up watchers based on current CWD
  const dirs = resolvePlanDirs(entry.info.meta.cwd);
  setupWatchers(dirs);

  // Re-resolve plan directories when CWD changes
  subscribeForTerminal("cwd", terminalId, ac.signal, (newCwd) => {
    const newDirs = resolvePlanDirs(newCwd);
    const dirsChanged =
      newDirs.length !== currentDirs.length ||
      newDirs.some((d, i) => d !== currentDirs[i]);
    if (dirsChanged) {
      plog.info({ dirs: newDirs }, "plan directories changed");
      setupWatchers(newDirs);
    }
  });

  plog.info({ dirs }, "started");

  return () => {
    ac.abort();
    for (const w of watchers) w.close();
    if (debounceTimer) clearTimeout(debounceTimer);
    plog.info("stopped");
  };
}
