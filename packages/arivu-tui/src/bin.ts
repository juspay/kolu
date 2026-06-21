/**
 * arivu-tui — a terminal-side viewer for a running `arivu` daemon.
 *
 * ── arivu P3 PR2a, SMOKE STEP ──────────────────────────────────────────
 * This commit proves only the render pipeline: `arivu-tui` opens the OpenTUI
 * dashboard (a greeting + a one-second clock) so the Bun → OpenTUI(native Zig
 * via Bun.dlopen) → Solid path is provably alive end to end. The real awareness
 * list (read once from the `awareness` collection) and `--json` (dump the flat
 * awareness array) land in the next commit, reusing the untouched `connect.ts` /
 * `hostConnect.ts` / `read.ts` / `render.ts` helpers. `--host`/`--socket` dialing
 * is wired back in then.
 *
 * The OpenTUI renderer needs a TTY and is Bun-only (its native core loads via
 * Bun.dlopen), so it is imported dynamically ONLY when stdout is a TTY.
 */

import { ARIVU_CONTRACT_VERSION } from "@kolu/arivu-contract";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    process.stdout.write(`${ARIVU_CONTRACT_VERSION}\n`);
    process.exit(0);
  }
  if (args.includes("--help")) {
    process.stdout.write(
      "arivu-tui — a live dashboard of what every terminal is in (OpenTUI). " +
        "P3 PR2a smoke build: run with no args in a terminal to render it.\n",
    );
    process.exit(0);
  }
  if (!process.stdout.isTTY) {
    // The OpenTUI renderer owns the terminal; a pipe has no TTY to own. The
    // scriptable `--json` one-shot lands in the next commit.
    process.stdout.write(
      "arivu-tui: interactive terminal required (--json output lands next).\n",
    );
    process.exit(0);
  }
  // TTY: the live OpenTUI dashboard. Dynamic import keeps the Bun-only native
  // renderer off any non-TTY path.
  const { runHelloTui } = await import("./tui.tsx");
  await runHelloTui();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`arivu-tui: ${(err as Error).message}\n`);
  process.exit(1);
});
