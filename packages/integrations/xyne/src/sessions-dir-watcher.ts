import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import { newestTranscript, xyneSessionsPresent } from "./core.ts";

let installed = false;

const POLL_MS = 1000;

type TreeObservation =
  | { readonly kind: "absent" | "empty" | "raced" | "error" }
  | { readonly kind: "tree"; readonly digest: string };

const ABSENT: TreeObservation = { kind: "absent" };
const EMPTY: TreeObservation = { kind: "empty" };
const RACED: TreeObservation = { kind: "raced" };
const OBSERVE_ERROR: TreeObservation = { kind: "error" };

function sameObservation(a: TreeObservation, b: TreeObservation): boolean {
  if (a.kind === "tree" || b.kind === "tree")
    return a.kind === "tree" && b.kind === "tree" && a.digest === b.digest;
  return a.kind === b.kind;
}

function observeNewest(log?: Logger): TreeObservation {
  try {
    if (!xyneSessionsPresent()) return ABSENT;
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
        return RACED;
      }
      perDir.push(
        `${cwdDir}/${winner.name}:${st.size}:${st.mtimeMs}:${st.ino}`,
      );
    }
    if (perDir.length === 0) return EMPTY;
    return { kind: "tree", digest: perDir.join("\n") };
  } catch (err) {
    log?.error({ err, dir: SESSIONS_DIR }, "xyne: sessions observe failed");
    return OBSERVE_ERROR;
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

  let observed = observeNewest(log);
  const poll = (): void => {
    const cur = observeNewest(log);
    if (cur.kind !== "error" && !sameObservation(cur, observed)) {
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
