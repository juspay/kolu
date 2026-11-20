import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type {
  AgentIdentity,
  RestoreTarget,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import {
  type ActiveTerminalProcess,
  registerTerminal,
} from "../terminal-registry.ts";
import { installSnapshot } from "./metadata.ts";

const SESSION_ID = "ses_118316090ffewMmbj6bsfKwj4R";

const RESUME_AGENT: AgentIdentity = {
  kind: "opencode",
  sessionId: SESSION_ID,
  resumeRef: SESSION_ID,
};

export const EXACT_TARGET: RestoreTarget = {
  kind: "exact",
  agent: RESUME_AGENT,
  argv: ["--model", "sonnet"],
};

function activeSnapshot(): TerminalSnapshot {
  return {
    cwd: "/work/repo",
    git: { kind: "none" },
    pr: {
      kind: "ok",
      value: {
        number: 42,
        title: "Fix the auth race",
        url: "https://github.com/o/r/pull/42",
        state: "open",
        checks: "pass",
        checkRuns: [],
        reviewDecision: null,
        mergeStateStatus: "UNKNOWN",
        headSha: null,
        isDraft: false,
      },
    },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };
}

export function activeEntry(
  id: TerminalId,
  opts: { restoreTarget?: RestoreTarget } = { restoreTarget: EXACT_TARGET },
): ActiveTerminalProcess {
  return {
    info: { id, pid: 4242 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      themeName: "rose",
      intent: "fix the auth race",
      lastActivityAt: 123,
      promptedAt: null,
      restoreTarget: opts.restoreTarget,
    },
    snapshot: activeSnapshot(),
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

export function seedActiveTerminal(
  id: TerminalId,
  opts?: { restoreTarget?: RestoreTarget },
): ActiveTerminalProcess {
  const entry = opts === undefined ? activeEntry(id) : activeEntry(id, opts);
  registerTerminal(id, entry);
  installSnapshot(id);
  return entry;
}
