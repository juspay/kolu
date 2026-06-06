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

/**
 * The shared opening for a single-terminal demo: wait for the app, create one
 * themed terminal, and nudge its tile clear of the (visible) dock so the dock
 * doesn't overlap the content. Returns the terminal id. Recordings then just
 * run their commands.
 */
export async function setupSingleTerminal(world: KoluWorld): Promise<string> {
  await world.waitForReady();
  // Guarantee a clean empty canvas to open on: clear any pre-existing terminal
  // (the app-mode session can carry one), then wait for the canvas to empty.
  await world.page
    .evaluate(() =>
      fetch("/rpc/terminal/killAll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    )
    .catch(() => undefined);
  for (let i = 0; i < 20; i++) {
    if ((await world.terminalIds()).length === 0) break;
    await pause(world, 300);
  }
  await pause(world, 3500); // beat on the empty canvas (wide, for a clean trim)
  const id = await newTerminal(world);
  await pause(world, 600);
  await nudgeClearOfDock(world);
  await pause(world, 400);
  return id;
}

/** Drag the active tile right just far enough that the dock no longer covers
 *  it (dock-width-aware, with a small margin). No-op if already clear. */
async function nudgeClearOfDock(world: KoluWorld): Promise<void> {
  const dock = await world.page
    .locator('[data-testid="dock"]')
    .boundingBox()
    .catch(() => null);
  const bar = world.page
    .locator('[data-testid="canvas-tile-titlebar"]')
    .first();
  const tile = await bar.boundingBox().catch(() => null);
  if (!dock || !tile) return;
  const delta = dock.x + dock.width + 24 - tile.x; // clear the dock + 24px
  if (delta <= 0) return;
  const sx = tile.x + tile.width / 2;
  const sy = tile.y + tile.height / 2;
  await world.page.mouse.move(sx, sy);
  await world.page.mouse.down();
  await world.page.mouse.move(sx + delta, sy, { steps: 12 });
  await world.page.mouse.up();
  await world.waitForFrame();
}

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

/** claude on the cheap model. `--dangerously-skip-permissions` drops per-tool
 *  prompts but NOT the folder-trust gate (accept it via `acceptTrustGate`).
 *  Shows the account banner (name/email/plan) — use {@link CODEX_AUTONOMOUS}
 *  for clips that must not surface personal identity. */
export const CLAUDE_SONNET =
  "claude --dangerously-skip-permissions --model sonnet";

/** codex, INTERACTIVE + autonomous: `--ask-for-approval never` (no per-command
 *  prompts) + `--sandbox read-only` (safe; enough to read + explain — and it
 *  avoids the `--dangerously-bypass…` danger-confirmation). Stays interactive so
 *  the dock reaches `awaiting` after it answers. Identity-neutral startup
 *  (provider/model/session-uuid — no name/email/plan), so it's the default. */
export const CODEX_AUTONOMOUS =
  "codex --ask-for-approval never --sandbox read-only";

export interface LaunchAgentOptions {
  /** Agent CLI + flags. Defaults to {@link CLAUDE_SONNET}. */
  command?: string;
  /** The prompt, typed after the agent is up (skipped if absent). */
  prompt?: string;
  /** Press Enter once to accept a first-run trust prompt (claude's folder-trust
   *  gate, codex's directory-trust). Default true. */
  acceptTrustGate?: boolean;
  /** ms to wait for the trust prompt / startup intro before pressing Enter. */
  trustMs?: number;
  /** ms to wait for the agent to be ready for input before typing the prompt. */
  bootMs?: number;
  /** ms to hold on the finished answer (dock glowing at awaiting). */
  dwellMs?: number;
}

/**
 * Launch an agent in the active terminal and (optionally) ask it something —
 * the reusable climax of a product demo. Keep the dock in shot: its row tracks
 * the agent live, and we wait for it to flip **working → awaiting** (i.e. the
 * agent actually answered) rather than dwelling a fixed time. Shared across
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
  if (opts.acceptTrustGate ?? true) {
    await pause(world, opts.trustMs ?? 2500); // folder-trust gate appears
    await world.page.keyboard.press("Enter"); // accept "Yes, I trust this folder"
  }
  await pause(world, opts.bootMs ?? 2500); // agent loads, ready for input
  if (!opts.prompt) return;

  await world.terminalRun(opts.prompt);
  // Wait for the dock bucket to go working → awaiting (the answer is on screen
  // and the row has stopped pulsing). NB: the high-level state is `data-bucket`
  // ("working"/"awaiting"/"idle"); `data-agent-state` is the raw state
  // ("thinking"/"tool_use"/"waiting"), which is NOT what we want here.
  const dockBucket = (bucket: string, timeout: number) =>
    world.page
      .waitForSelector(`[data-bucket="${bucket}"]`, {
        state: "attached",
        timeout,
      })
      .catch(() => undefined);
  await dockBucket("working", 20_000);
  await dockBucket("awaiting", 90_000);
  // Make the status change unmissable: glow the awaiting dock row, then hold
  // on it (≥1s) so the viewer registers that the agent has finished.
  await world.page
    .addStyleTag({
      content:
        '[data-bucket="awaiting"]{box-shadow:0 0 0 2px #e0a45c,0 0 18px 4px rgba(224,164,92,.55)!important;border-radius:10px!important;transition:box-shadow .25s ease}',
    })
    .catch(() => undefined);
  await pause(world, opts.dwellMs ?? 2800); // hold on the answer + glowing dock
}
