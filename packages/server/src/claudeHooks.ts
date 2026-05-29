/**
 * Auto-install of the Claude Code hooks that let kolu detect
 * `AskUserQuestion` / `ExitPlanMode` (issue #905).
 *
 * The Claude Agent SDK buffers the in-flight `tool_use` message for these
 * `requiresUserInteraction` tools and only flushes it to the JSONL transcript
 * *after* the user answers — so JSONL polling can never see the wait window.
 * The fix is a side-channel: a `PreToolUse` hook writes a per-session sidecar
 * (`AWAITING_DIR/<sessionId>.json`) the instant the agent calls the tool, and a
 * `PostToolUse` hook clears it once the user resolves. kolu's session-watcher
 * reads the sidecar and overrides state to `awaiting_user` while it's present.
 *
 * `ensureClaudeHooks()` runs once at server startup. It:
 *   1. Copies the bundled `awaiting-writer.mjs` into `~/.claude/kolu-hooks/`
 *      and writes a tiny `awaiting-writer` wrapper that pins an absolute `node`
 *      interpreter (the volatile Nix store path lives ONLY in the wrapper,
 *      never in settings.json — re-stamped on content drift across upgrades).
 *   2. Sweeps never-cleared stale sidecars.
 *   3. Merges two matcher entries into `~/.claude/settings.json`, preserving
 *      every other key/hook and adding nothing on a re-run (idempotent).
 *
 * If `settings.json` is declaratively managed — a symlink (home-manager into
 * the read-only Nix store, a dotfiles linker, …) or otherwise unwritable — it
 * is NEVER rewritten (a tmp+rename would replace the symlink and break the next
 * `home-manager switch`). Instead the exact hook block is logged so the user
 * can add it to their managed config once; the writer assets still install, so
 * the manual/declarative add is all that's needed.
 *
 * Everything is fail-open: any error is logged at warn and swallowed so a
 * read-only or locked `~/.claude` can never crash the server. It is skipped
 * entirely when a `KOLU_CLAUDE_*_DIR` test override is active (the claude tree
 * is redirected at fixtures — never touch the real home) or when opted out via
 * `KOLU_DISABLE_CLAUDE_HOOKS` or a `~/.claude/kolu-hooks/disabled` marker.
 */

import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AWAITING_DIR,
  AWAITING_SIDECAR_TTL_MS,
  AWAITING_WRITER_ASSET,
} from "kolu-claude-code";
import type { Logger } from "kolu-shared";

/** The tool matcher both hook entries use. */
const MATCHER = "AskUserQuestion|ExitPlanMode";
/** Substring that identifies a kolu-owned hook command, for idempotent merge. */
const HOOK_MARKER = "kolu-hooks/awaiting-writer";
/** Hook command timeout (seconds). The writer is allocation-light and exits 0
 *  on every path; this caps a pathological stdin stall well under Claude's 5s. */
const HOOK_TIMEOUT_SEC = 3;

const claudeDir = () => join(homedir(), ".claude");
const hooksDir = () => join(claudeDir(), "kolu-hooks");
const writerMjsPath = () => join(hooksDir(), "awaiting-writer.mjs");
const wrapperPath = () => join(hooksDir(), "awaiting-writer");
const settingsPath = () => join(claudeDir(), "settings.json");
const disabledMarker = () => join(hooksDir(), "disabled");

// --- Pure merge (unit-tested without fs) ---

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}
interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

/** Merge kolu's PreToolUse/PostToolUse matcher entries into a parsed Claude
 *  settings object. Pure — returns a fresh object and a `changed` flag without
 *  touching disk. A non-object input (missing/unparseable settings) starts
 *  from `{}`. Other keys and unrelated hooks are preserved untouched; a re-run
 *  that finds an existing kolu entry (matched by `HOOK_MARKER` in the command)
 *  adds nothing. */
export function mergeClaudeHooks(
  settings: unknown,
  preCommand: string,
  postCommand: string,
): { settings: ClaudeSettings; changed: boolean } {
  const out: ClaudeSettings =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? structuredClone(settings as ClaudeSettings)
      : {};
  out.hooks ??= {};
  const hooks = out.hooks;
  let changed = false;
  changed = ensureHookEntry(hooks, "PreToolUse", preCommand) || changed;
  changed = ensureHookEntry(hooks, "PostToolUse", postCommand) || changed;
  return { settings: out, changed };
}

/** Append kolu's entry for one event if no equivalent kolu entry exists yet.
 *  Returns true if the array was modified. */
function ensureHookEntry(
  hooks: Record<string, HookEntry[]>,
  event: string,
  command: string,
): boolean {
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  const arr = hooks[event];
  const present = arr.some(
    (e) =>
      e?.matcher === MATCHER &&
      Array.isArray(e.hooks) &&
      e.hooks.some(
        (h) =>
          typeof h?.command === "string" && h.command.includes(HOOK_MARKER),
      ),
  );
  if (present) return false;
  arr.push({
    matcher: MATCHER,
    hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SEC }],
  });
  return true;
}

// --- IO orchestration ---

/** Install/refresh the Claude Code hooks. Idempotent, fail-open, once-per-boot.
 *  Skipped under a `KOLU_CLAUDE_*_DIR` test override or an explicit opt-out. */
export function ensureClaudeHooks(log: Logger): void {
  try {
    if (
      process.env.KOLU_CLAUDE_AWAITING_DIR ||
      process.env.KOLU_CLAUDE_PROJECTS_DIR ||
      process.env.KOLU_CLAUDE_SESSIONS_DIR
    ) {
      log.debug({}, "claude hooks: skipped (test dir override active)");
      return;
    }
    if (process.env.KOLU_DISABLE_CLAUDE_HOOKS) {
      log.debug({}, "claude hooks: skipped (KOLU_DISABLE_CLAUDE_HOOKS set)");
      return;
    }
    mkdirSync(hooksDir(), { recursive: true, mode: 0o700 });
    if (fileExists(disabledMarker())) {
      log.debug({}, "claude hooks: skipped (disabled marker present)");
      return;
    }
    installWriterAssets(log);
    sweepStaleSidecars(log);
    mergeSettingsFile(log);
  } catch (err) {
    log.warn(
      { err },
      "claude hooks: install failed (continuing without #905 detection)",
    );
  }
}

/** Copy the bundled writer .mjs and (re)write the interpreter wrapper. */
function installWriterAssets(log: Logger): void {
  const desiredMjs = readFileSync(AWAITING_WRITER_ASSET, "utf8");
  writeIfChanged(writerMjsPath(), desiredMjs, 0o644, log);

  // `process.execPath` is the absolute `node` binary the server runs under — a
  // known-good interpreter even though the user's shell PATH (where Claude
  // spawns the hook) may not have node on it. Isolating the volatile store
  // path here keeps settings.json stable across upgrades.
  const wrapper = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(writerMjsPath())} "$@"\n`;
  writeIfChanged(wrapperPath(), wrapper, 0o755, log);
}

/** Merge kolu's matcher entries into ~/.claude/settings.json, atomically —
 *  unless the file is declaratively managed (a symlink, e.g. a home-manager
 *  link into the read-only Nix store) or otherwise unwritable, in which case we
 *  never touch it and instead log the exact entries to add by hand. The writer
 *  assets are already installed by this point, so a manual/declarative add is
 *  all that's needed. */
function mergeSettingsFile(log: Logger): void {
  const path = settingsPath();
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(
        { err, path },
        "claude settings.json unparseable; treating as empty",
      );
    }
  }
  const cmd = (action: string) => `${shellQuote(wrapperPath())} ${action}`;
  const { settings, changed } = mergeClaudeHooks(
    parsed,
    cmd("set"),
    cmd("clear"),
  );
  if (!changed) {
    log.debug({ path }, "claude hooks: already installed");
    return;
  }

  // A symlinked settings.json is managed by something declarative
  // (home-manager, a dotfiles linker, …). An atomic tmp+rename would replace
  // the *symlink* with our own regular file, silently breaking the next
  // `home-manager switch` (and a store target is read-only anyway). Don't
  // clobber it — tell the user what to add instead.
  if (isSymlink(path)) {
    log.warn(
      { path, hooks: manualHookSnippet(cmd) },
      "claude settings.json is a symlink (declaratively managed) — add the kolu hooks to your managed config; auto-install skipped to avoid clobbering it",
    );
    return;
  }

  try {
    atomicWrite(path, `${JSON.stringify(settings, null, 2)}\n`, 0o644);
    log.info(
      { path },
      "claude hooks: installed AskUserQuestion/ExitPlanMode detection",
    );
  } catch (err) {
    // Read-only file/dir that wasn't a symlink — same fallback: don't fail,
    // surface the actionable snippet.
    log.warn(
      { err, path, hooks: manualHookSnippet(cmd) },
      "claude settings.json not writable — add the kolu hooks manually; auto-install skipped",
    );
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false; // absent → not a symlink; the write path handles creation
  }
}

/** The `hooks` block a user should merge into their declaratively-managed
 *  settings.json. Logged (not written) when we can't safely write the file. */
function manualHookSnippet(cmd: (action: string) => string): unknown {
  const entry = (action: string) => ({
    matcher: MATCHER,
    hooks: [
      { type: "command", command: cmd(action), timeout: HOOK_TIMEOUT_SEC },
    ],
  });
  return {
    hooks: { PreToolUse: [entry("set")], PostToolUse: [entry("clear")] },
  };
}

/** Remove never-cleared sidecars (a session SIGKILLed mid-prompt). The
 *  read-time TTL in `readAwaitingSidecar` already ignores them; this bounds
 *  disk growth. Best-effort: the dir may not exist yet. */
function sweepStaleSidecars(log: Logger): void {
  let names: string[];
  try {
    names = readdirSync(AWAITING_DIR);
  } catch {
    return; // no sidecar dir yet — nothing to sweep
  }
  const now = Date.now();
  let swept = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const fp = join(AWAITING_DIR, name);
    try {
      if (now - statSync(fp).mtimeMs > AWAITING_SIDECAR_TTL_MS) {
        unlinkSync(fp);
        swept++;
      }
    } catch {
      // raced removal / unreadable — skip
    }
  }
  if (swept > 0)
    log.debug({ swept }, "claude hooks: swept stale awaiting sidecars");
}

// --- fs helpers ---

function fileExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Write `content` only when it differs from what's on disk, then chmod. Avoids
 *  rewriting (and churning mtimes) the wrapper/.mjs on every boot when nothing
 *  changed; rewrites on store-path drift across upgrades. */
function writeIfChanged(
  path: string,
  content: string,
  mode: number,
  log: Logger,
): void {
  let current: string | null = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    // absent — will write
  }
  if (current === content) return;
  atomicWrite(path, content, mode);
  log.debug({ path }, "claude hooks: wrote hook asset");
}

/** Write via a temp file + rename so a concurrent reader never sees a partial
 *  file. The temp name carries the pid to avoid colliding with a peer boot. */
function atomicWrite(path: string, content: string, mode: number): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}

/** POSIX single-quote escaping for embedding a path in the wrapper / command. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
