import type { PadiStateBackup, SavedSession } from "@kolu/padi-client/surface";
import { log } from "../log.ts";
import { importSession } from "./sessionRestore.ts";
import { padiStateBackupRing } from "./stateStore.ts";

function summarize(raw: unknown): PadiStateBackup["summary"] {
  const session = (raw as { session?: unknown }).session;
  if (
    session !== null &&
    typeof session === "object" &&
    Array.isArray((session as { terminals?: unknown }).terminals)
  ) {
    return {
      kind: "session",
      terminals: (session as { terminals: unknown[] }).terminals.length,
    };
  }
  return { kind: "empty" };
}

export function listPadiStateBackups(stateRoot: string): {
  backups: PadiStateBackup[];
} {
  return {
    backups: padiStateBackupRing(stateRoot).listWith<
      PadiStateBackup["summary"]
    >(summarize, { kind: "unreadable" }),
  };
}

export async function restorePadiStateBackup(
  stateRoot: string,
  input: {
    file: string;
    resumeAgents?: boolean;
    optOutIds?: readonly string[];
  },
): Promise<void> {
  await padiStateBackupRing(stateRoot).restore(input.file, async (raw) => {
    const session = (raw as { session?: unknown }).session;
    if (
      session === null ||
      session === undefined ||
      typeof session !== "object"
    ) {
      throw new Error(`state backup ${input.file} holds no session to restore`);
    }
    log.info({ file: input.file }, "restoring session from state backup");
    await importSession({
      session: session as SavedSession,
      resumeAgents: input.resumeAgents,
      ...(input.optOutIds === undefined ? {} : { optOutIds: input.optOutIds }),
    });
  });
}
