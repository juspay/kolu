import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import { newestTranscript, xyneSessionsPresent } from "./core.ts";

let installed = false;

const POLL_MS = 1000;

function observeNewest(log?: Logger): string {
  try {
    if (!xyneSessionsPresent()) return "absent";
    // Each `cwdDir` contributes its own parsed-(ts,id) winner + size/mtime/ino.
    // A global "one winner" identity strands resolution flips in every
    // non-winner cwd dir for a full poll cycle or longer.
    const perDir: string[] = [];
    for (const cwdDir of fs.readdirSync(SESSIONS_DIR).sort()) {
      const sub = path.join(SESSIONS_DIR, cwdDir);
      let names: string[];
      try {
        if (!fs.statSync(sub).isDirectory()) continue;
        names = fs.readdirSync(sub);
      } catch {
        continue;
      }
      const winner = newestTranscript(names);
      if (!winner) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(path.join(sub, winner.name));
      } catch {
        return "raced";
      }
      perDir.push(
        `${cwdDir}/${winner.name}:${st.size}:${st.mtimeMs}:${st.ino}`,
      );
    }
    if (perDir.length === 0) return "empty";
    return perDir.join("\n");
  } catch (err) {
    log?.error({ err, dir: SESSIONS_DIR }, "xyne: sessions observe failed");
    return "error";
  }
}

export function subscribeSessionDirs(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;
  installed = true;

  const emit = (): void => {
    try {
      onChange();
    } catch (err) {
      onError(err);
    }
  };

  // Self-rescheduling so slow stats never stack; unref'd so it never holds
  // the process alive.
  let observed = observeNewest(log);
  const poll = (): void => {
    const cur = observeNewest(log);
    if (cur !== "error" && cur !== observed) {
      observed = cur;
      emit();
    }
    setTimeout(poll, POLL_MS).unref();
  };
  setTimeout(poll, POLL_MS).unref();

  try {
    fs.watch(SESSIONS_DIR, { recursive: true }, (_evt, filename) => {
      if (filename === null || filename.endsWith(".jsonl")) emit();
    }).on("error", (err: unknown) => {
      log?.error({ err, dir: SESSIONS_DIR }, "xyne: sessions watch failed");
    });
  } catch (err) {
    log?.error({ err, dir: SESSIONS_DIR }, "xyne: sessions dir not watchable");
  }

  log?.info({ dir: SESSIONS_DIR }, "xyne: sessions watcher installed");
}
