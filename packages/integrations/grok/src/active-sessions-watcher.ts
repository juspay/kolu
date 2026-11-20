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

const APPEARANCE_DEBOUNCE_MS = 50;

function watchForDirAppearing(
  dir: string,
  onAppear: () => void,
  log?: Logger,
): void {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  let watcher: fs.FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promoteIfPresent = (): void => {
    if (!fs.existsSync(dir) || !watcher) return;
    watcher.close();
    watcher = null;
    clearTimeout(timer);
    timer = undefined;
    log?.info({ dir, parent }, "grok: home-dir watcher retired");
    onAppear();
  };

  watcher = fs.watch(parent, (_evt, filename) => {
    // `fs.watch` reports `filename === null` on some platforms.
    if (filename !== base && filename !== null) return;
    clearTimeout(timer);
    timer = setTimeout(promoteIfPresent, APPEARANCE_DEBOUNCE_MS);
  });
  log?.info({ dir, parent }, "grok: home-dir watcher installed");
  promoteIfPresent();
}

export function subscribeActiveSessions(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;
  installed = true;

  if (grokHomePresent()) {
    attach(onChange, onError, log);
    return;
  }

  try {
    watchForDirAppearing(GROK_DIR, () => attach(onChange, onError, log), log);
  } catch (err) {
    onError(err);
  }
}
