/**
 * The tiny, explicit command grammar the mock-agent reads on stdin (through the
 * PTY) and the shared shape each kind's artifact writer implements.
 *
 * The grammar is line-oriented — the test facade types one line + Enter into the
 * terminal, which reaches the foreground mock-agent's stdin. Deliberately small:
 * one verb per line, whitespace-split, no quoting.
 *
 *   state <name> [k=v ...]   set the lifecycle state (+ optional key=value opts)
 *   quit                     remove artifacts (session disappears) and exit
 *
 * `<name>` carries the artifact variant directly (`running_background` /
 * `orphaned_workflow` / `journalless_workflow` / `fork` / … pick the journal &
 * subagent shape by construction). The trailing `k=v` tokens carry the numeric
 * inputs the old per-step fixtures varied:
 *   input=<n>   cached=<n>     codex/claude token accounting
 *   context=<n>                opencode/grok context tokens
 *   todos=<total>/<completed>  opencode todo list
 *   tasks=<total>/<completed>  claude Workflow task progress
 *   stale-jsonl                claude MRU-regression previous-session file (flag)
 *   no-active                  grok: write session tree without active_sessions
 *                              pid map (the production "map lands late" race)
 *   seq=<n>                    harness-side unique ack id (echoed, not written)
 */

/** Every lifecycle + artifact variant the mock-agent can present. The base
 *  four (`thinking`/`tool_use`/`waiting`/`awaiting_user`) are shared by all
 *  kinds; the rest are claude-only artifact variants that used to be distinct
 *  `MockState`s. */
export type AgentState =
  | "thinking"
  | "tool_use"
  | "waiting"
  | "awaiting_user"
  | "running_background"
  | "orphaned_workflow"
  | "journalless_workflow"
  | "background_bash"
  | "fork"
  | "interrupted"
  | "interrupted_tool_use"
  | "compact";

/** Closed set of valid `state <name>` tokens — used by `parseCommand` so a
 *  typo surfaces as an unknown command rather than a silent partial write. */
export const AGENT_STATES = [
  "thinking",
  "tool_use",
  "waiting",
  "awaiting_user",
  "running_background",
  "orphaned_workflow",
  "journalless_workflow",
  "background_bash",
  "fork",
  "interrupted",
  "interrupted_tool_use",
  "compact",
] as const satisfies readonly AgentState[];

const AGENT_STATE_SET: ReadonlySet<string> = new Set(AGENT_STATES);

export function isAgentState(s: string): s is AgentState {
  return AGENT_STATE_SET.has(s);
}

export interface StateOpts {
  /** codex/claude: prompt input tokens (context-token accounting). */
  inputTokens?: number;
  /** codex: cached input tokens (must not double-count). */
  cachedInputTokens?: number;
  /** opencode/grok: running context-token total. */
  contextTokens?: number;
  /** opencode: todo list to render. */
  todos?: { total: number; completed: number };
  /** claude: Workflow task-progress counts (appended to the transcript). */
  tasks?: { total: number; completed: number };
  /** claude: also write the newer-stale previous-session JSONL (MRU guard). */
  staleJsonl?: boolean;
  /** codex/opencode/grok: session title. */
  title?: string;
  /** grok: write the session tree but leave `active_sessions.json` empty —
   *  the production race where the TUI is foreground before the pid map lands. */
  noActive?: boolean;
  /** Harness-only: unique id so the ack line can't match a prior
   *  `MOCK-AGENT-STATE` still on screen (e.g. two consecutive `waiting`
   *  transitions with different opts — the buffer would short-circuit). */
  seq?: number;
}

/** One agent kind's artifact surface. `setState` is idempotent (re-runnable for
 *  transitions); `nudge` re-fires the file/DB watcher to defeat a dropped
 *  inotify event; `remove` makes the session disappear (indicator clears). */
export interface MockKind {
  setState(state: AgentState, opts: StateOpts): void;
  nudge(): void;
  remove(): void;
}

/** A parsed stdin line: a `state` transition (with opts), a `quit`, or an
 *  unrecognized verb (surfaced loudly rather than silently dropped). */
export type Command =
  | { verb: "state"; state: AgentState; opts: StateOpts }
  | { verb: "paint"; template: string }
  | { verb: "quit" }
  | { verb: "unknown"; raw: string };

/** Parse one whitespace-split stdin line into a {@link Command}. Pure, so the
 *  grammar is unit-testable without spawning the process. */
export function parseCommand(raw: string): Command | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const verb = tokens[0];
  if (!verb) return null;
  if (verb === "quit") return { verb: "quit" };
  if (verb === "paint") {
    const template = tokens[1];
    return template ? { verb: "paint", template } : { verb: "unknown", raw };
  }
  if (verb === "state") {
    const name = tokens[1];
    if (!name || !isAgentState(name)) {
      return { verb: "unknown", raw: name ? `state ${name}` : "state" };
    }
    const opts: StateOpts = {};
    for (const tok of tokens.slice(2)) {
      if (tok === "stale-jsonl") {
        opts.staleJsonl = true;
        continue;
      }
      if (tok === "no-active") {
        opts.noActive = true;
        continue;
      }
      const eq = tok.indexOf("=");
      if (eq === -1) continue;
      const key = tok.slice(0, eq);
      const val = tok.slice(eq + 1);
      switch (key) {
        case "input":
          opts.inputTokens = Number(val);
          break;
        case "cached":
          opts.cachedInputTokens = Number(val);
          break;
        case "context":
          opts.contextTokens = Number(val);
          break;
        case "todos": {
          const [total, completed] = val.split("/").map(Number);
          opts.todos = { total: total ?? 0, completed: completed ?? 0 };
          break;
        }
        case "tasks": {
          const [total, completed] = val.split("/").map(Number);
          opts.tasks = { total: total ?? 0, completed: completed ?? 0 };
          break;
        }
        case "title":
          opts.title = val;
          break;
        case "seq":
          opts.seq = Number(val);
          break;
      }
    }
    return { verb: "state", state: name, opts };
  }
  return { verb: "unknown", raw: verb };
}
