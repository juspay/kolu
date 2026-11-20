import { createDirFilenameWatcher } from "kolu-io";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { ACTIVE_SESSIONS_PATH, GROK_DIR } from "./config.ts";
import { grokHomePresent } from "./core.ts";

let installed = false;

const activeSessionsWatcher = createDirFilenameWatcher({
  resolveDir: async () => GROK_DIR,
  filename: path.basename(ACTIVE_SESSIONS_PATH),
  debounceMs: 50,
  logLabel: "grok: active_sessions",
});

function attach(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  activeSessionsWatcher.watch(
    "",
    "grok session detection",
    () => {
      try {
        onChange();
      } catch (err) {
        onError(err);
      }
    },
    log,
  );
}

export function subscribeActiveSessions(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;
  // Latch immediately: install is total from here, so a second `install`
  // call (a later terminal reporting `isPresent`) correctly no-ops even
  // while the bootstrap below is still waiting for `~/.grok` to appear.
  installed = true;

  if (grokHomePresent()) {
    attach(onChange, onError, log);
    return;
  }

  // Home dir absent (first-ever Grok launch on a fresh home). Never mkdir:
  // watch the parent dir (which always exists) for `.grok` appearing, then
  // attach the real watcher. Without this, install would soft-fail here and
  // padi's once-install latch would prevent any retry, permanently killing
  // the external-change signal for the process.
  const parent = path.dirname(GROK_DIR);
  const base = path.basename(GROK_DIR);
  let bootstrap: fs.FSWatcher | null = null;
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;

  const promoteIfPresent = (): void => {
    if (!grokHomePresent() || !bootstrap) return;
    bootstrap.close();
    bootstrap = null;
    if (bootstrapTimer) {
      clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }
    log?.info({ dir: GROK_DIR, parent }, "grok: home-dir watcher retired");
    attach(onChange, onError, log);
  };

  try {
    bootstrap = fs.watch(parent, (_evt, filename) => {
      // `filename` is null on some platforms; re-check presence regardless.
      if (filename !== base && filename !== null) return;
      // Trailing-edge debounce: `parent` is $HOME (a busy dir) and a null
      // `filename` (macOS) matches every event, so an unguarded
      // grokHomePresent() stat would run on nearly every home-dir change.
      if (bootstrapTimer) clearTimeout(bootstrapTimer);
      bootstrapTimer = setTimeout(promoteIfPresent, 50);
    });
  } catch (err) {
    onError(err);
    return;
  }
  log?.info({ dir: GROK_DIR, parent }, "grok: home-dir watcher installed");
  // Close the resolve→install TOCTOU window: `~/.grok` may have been created
  // between the grokHomePresent() check above and the fs.watch install, and a
  // quiet home dir might never fire another event. Re-check once, now.
  promoteIfPresent();
}
