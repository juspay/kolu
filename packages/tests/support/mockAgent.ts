/**
 * Harness-side facade for `kolu-mock-agent` — the ONE place agent-state
 * scenarios drive the in-terminal mock (packages/mock-agent). Every step that
 * used to plant fixture FILES from the test process now types a line into the
 * active terminal, which reaches the mock-agent's stdin over the PTY — the
 * product's own wire. Because the mock-agent runs wherever the terminal lives
 * (this box locally, the leased bind target under `KOLU_E2E_PADI_HOST`) and
 * writes its own artifacts at that box's real `$HOME` defaults, this facade has
 * ZERO remote branches: local and remote are the same code.
 *
 * The mock-agent's bin dir is provisioned by the e2e recipe (a `nix build
 * .#mock-agent`, `nix copy`'d to the bind target) and surfaced as
 * `KOLU_MOCK_AGENT_BIN`. Invoked by ABSOLUTE store path so the head basename is
 * `claude`/`codex`/`opencode` (what the preexec command-name detector keys on)
 * and PATH-shadowing by a host's real agent install can't win — the store path
 * is identical on every box, so the SAME command line resolves on either side.
 */

import { waitForBufferContains } from "./buffer.ts";
import type { KoluWorld } from "./world.ts";

export type AgentKind = "claude" | "codex" | "opencode";

/** Options accepted by a `state <name>` command, rendered into `k=v` tokens. */
export interface MockStateOpts {
  inputTokens?: number;
  cachedInputTokens?: number;
  contextTokens?: number;
  todos?: { total: number; completed: number };
  tasks?: { total: number; completed: number };
  staleJsonl?: boolean;
}

function mockAgentBin(kind: AgentKind): string {
  const dir = process.env.KOLU_MOCK_AGENT_BIN;
  if (!dir)
    throw new Error(
      "KOLU_MOCK_AGENT_BIN must be set (the e2e recipe builds .#mock-agent and exports its bin dir)",
    );
  return `${dir}/${kind}`;
}

/** The mock-agent live in THIS worker's active terminal, if any — tracked so
 *  follow-up steps can augment the current state (tasks/stale-jsonl) and the
 *  After hook can tear it down geography-free. One scenario runs at a time per
 *  worker, so a single module-level slot is safe. */
let active: { kind: AgentKind; state: string; opts: MockStateOpts } | null = null;

/** Launch the mock-agent for `kind` in the active terminal and wait until it is
 *  the settled foreground process (its READY marker on screen). `shim` presents
 *  as an npm-shimmed CLI (command-name detection only). */
export async function launchMockAgent(
  world: KoluWorld,
  kind: AgentKind,
  { shim = false }: { shim?: boolean } = {},
): Promise<void> {
  const cmd = `${mockAgentBin(kind)}${shim ? " --shim" : ""}`;
  await world.page.keyboard.type(cmd);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, `MOCK-AGENT-READY ${kind}`);
  active = { kind, state: "", opts: {} };
}

function renderOpts(opts: MockStateOpts): string {
  const parts: string[] = [];
  if (opts.inputTokens !== undefined) parts.push(`input=${opts.inputTokens}`);
  if (opts.cachedInputTokens !== undefined)
    parts.push(`cached=${opts.cachedInputTokens}`);
  if (opts.contextTokens !== undefined) parts.push(`context=${opts.contextTokens}`);
  if (opts.todos) parts.push(`todos=${opts.todos.total}/${opts.todos.completed}`);
  if (opts.tasks) parts.push(`tasks=${opts.tasks.total}/${opts.tasks.completed}`);
  if (opts.staleJsonl) parts.push("stale-jsonl");
  return parts.join(" ");
}

/** Send a `state <name> [opts]` command and wait for the mock-agent's ack, so
 *  the artifact write has happened before the caller polls the UI (deterministic,
 *  no sleep). */
export async function setMockState(
  world: KoluWorld,
  state: string,
  opts: MockStateOpts = {},
): Promise<void> {
  const rendered = renderOpts(opts);
  await world.page.keyboard.type(`state ${state}${rendered ? ` ${rendered}` : ""}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, `MOCK-AGENT-STATE ${state}`);
  if (!active)
    throw new Error("no active mock-agent — call launchMockAgent first");
  active.state = state;
  active.opts = opts;
}

/** Re-issue the CURRENT state with extra opts merged in — the in-terminal twin
 *  of the old "append to the existing fixture" follow-up steps (tasks,
 *  stale-jsonl). Keeps the same lifecycle state, adds the artifact the step asks
 *  for. */
export async function augmentMockState(
  world: KoluWorld,
  patch: MockStateOpts,
): Promise<void> {
  if (!active) throw new Error("no active mock-agent — call the mock step first");
  await setMockState(world, active.state, { ...active.opts, ...patch });
}

/** A distinctive line of each paint template — the harness waits for it to
 *  render so the screen scrape has something to read before the caller polls. */
const PAINT_MARKERS: Record<string, string> = {
  "ask-user-question": "Which database do you prefer?",
  "ask-user-question-notes": "Which package decomposition is cleanest?",
  permission: "Do you want to create notes.txt?",
};

/** Have the mock-agent PRINT a canned Claude on-screen prompt (AskUserQuestion /
 *  permission gate) to the PTY so kolu's server-side screen scrape sees it — the
 *  in-terminal twin of the old `paintLinesToTerminal` steps. */
export async function paintPrompt(
  world: KoluWorld,
  template: keyof typeof PAINT_MARKERS,
): Promise<void> {
  await world.page.keyboard.type(`paint ${template}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, PAINT_MARKERS[template] as string);
}

/** Tell the mock-agent to remove its artifacts and exit — the session
 *  disappears and the indicator clears. Returns the terminal to the shell. */
export async function quitMockAgent(world: KoluWorld): Promise<void> {
  await world.page.keyboard.type("quit");
  await world.page.keyboard.press("Enter");
  active = null;
}

/** After-hook teardown: if a mock-agent is still resident, quit it so its
 *  artifacts are removed on WHATEVER box the terminal lives (geography-free) —
 *  the next scenario's `terminal/killAll` then tears down the bare shell. */
export async function quitActiveMockAgent(world: KoluWorld): Promise<void> {
  if (active) await quitMockAgent(world);
}
