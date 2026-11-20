import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CellStore } from "@kolu/surface/server";
import { type PersistedTranscript, UnreadablePersisted } from "kolu-conductor";

export function transcriptFilePath(stateRoot: string): string {
  return join(stateRoot, "conductor", "transcript.json");
}

interface TranscriptFileBody {
  readonly version: string;
  readonly rows: ReadonlyArray<unknown>;
}

export function writeTranscriptFile(
  path: string,
  version: string,
  rows: ReadonlyArray<unknown>,
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body: TranscriptFileBody = { version, rows };
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(body), { mode: 0o600 });
  renameSync(temp, path);
}

export function readTranscriptFile(
  path: string,
  version: string,
  stateRoot: string,
): { readonly rows: ReadonlyArray<unknown> } {
  const refuse = (why: string, detail: string): never => {
    throw new UnreadablePersisted({
      key: "transcript",
      path,
      stateRoot,
      why,
      detail,
    });
  };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { rows: [] };
    return refuse("the file could not be read", String(err));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return refuse("the file is not valid JSON", String(err));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return refuse(
      "the file does not hold what a transcript is written as",
      "the file's top level is not an object",
    );
  }
  const body = parsed as { version?: unknown; rows?: unknown };
  if (body.version !== version) {
    return refuse(
      `it was written by a build that stamped it ${JSON.stringify(body.version)}, and this one reads ${JSON.stringify(version)}`,
      `transcript file version ${JSON.stringify(body.version)} ≠ ${JSON.stringify(version)}`,
    );
  }
  if (!Array.isArray(body.rows)) {
    return refuse(
      "the file does not hold what a transcript is written as",
      "the file has no `rows` array",
    );
  }
  return { rows: body.rows };
}

export function transcriptFileStore(
  stateRoot: string,
  version: string,
): CellStore<PersistedTranscript> {
  const path = transcriptFilePath(stateRoot);
  return {
    get: () =>
      readTranscriptFile(path, version, stateRoot) as PersistedTranscript,
    set: (value) => {
      writeTranscriptFile(path, version, value.rows);
    },
  };
}
