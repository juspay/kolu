// Shared kolu-domain helpers for authoring recordings. (Kolu domain — knows
// about claude/terminals; depends on the World, never on the engine.)
import type { KoluWorld } from "../../support/world";

/** Sleep `ms` — paces a recording at human speed. */
export const pause = (world: KoluWorld, ms: number): Promise<void> =>
  world.page.waitForTimeout(ms);

// The theme the current recording pins (set by the dispatcher from
// `Recording.theme`); `newTerminal` applies it to each terminal it creates.
let activeTheme: string | undefined;
export const setActiveTheme = (name?: string): void => {
  activeTheme = name;
};

/** Create a terminal and pin the recording's theme on it (via the `setTheme`
 *  RPC — invisible, no palette flash). Use instead of `world.createTerminal()`
 *  in recordings so clips share a consistent look. */
export async function newTerminal(world: KoluWorld): Promise<string> {
  const id = await world.createTerminal();
  if (activeTheme) {
    await world.page
      .evaluate(
        async ({ id, themeName }) => {
          await fetch("/rpc/terminal/setTheme", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ json: { id, themeName } }),
          });
        },
        { id, themeName: activeTheme },
      )
      .catch(() => undefined);
    await pause(world, 400);
  }
  return id;
}

/** claude, trust-prompt skipped, on the cheap model — the default demo agent.
 *  `--dangerously-skip-permissions` drops the "trust this folder" gate so the
 *  agent boots straight to its input; `--model sonnet` keeps token cost down. */
export const CLAUDE_SONNET =
  "claude --dangerously-skip-permissions --model sonnet";

export interface LaunchAgentOptions {
  /** Agent CLI + flags. Defaults to {@link CLAUDE_SONNET}. */
  command?: string;
  /** A prompt to submit once the agent is up (skipped if absent). */
  prompt?: string;
  /** ms to wait for the first-run folder-trust gate to appear. */
  trustMs?: number;
  /** ms to wait for the agent to load the project before typing the prompt. */
  bootMs?: number;
  /** ms to dwell after submitting — the window where the dock row pulses. */
  dwellMs?: number;
}

/**
 * Launch an agent in the active terminal and (optionally) ask it something —
 * the reusable climax of a product demo. Keep the dock in shot and its row
 * tracks the agent live (working → awaiting) through the dwell. Shared across
 * recordings (this one and future ones).
 *
 * Claude's first run in a folder shows a "trust this folder" gate; Enter
 * accepts the default ("Yes, I trust"). `--dangerously-skip-permissions` only
 * covers the per-tool prompts *during* the query, not this gate — so we accept
 * it explicitly before typing the prompt (otherwise the prompt lands in the
 * gate and mangles).
 */
export async function launchAgentAndAsk(
  world: KoluWorld,
  opts: LaunchAgentOptions = {},
): Promise<void> {
  await world.terminalRun(opts.command ?? CLAUDE_SONNET);
  await pause(world, opts.trustMs ?? 3500); // folder-trust gate appears
  await world.page.keyboard.press("Enter"); // accept "Yes, I trust this folder"
  await pause(world, opts.bootMs ?? 4500); // agent loads the project
  if (opts.prompt) {
    await world.terminalRun(opts.prompt);
    await pause(world, opts.dwellMs ?? 12000); // dock pulses while it works
  }
}
