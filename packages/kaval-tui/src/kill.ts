/**
 * The `kill` command's body, extracted from `main.ts` so the real dispatch path
 * is exercised by a test over a live socket (the same way `runAttach` lives in
 * `attach.ts`). `main.ts` resolves the short id via `resolveOne` and hands the
 * full id here; this module owns the kill RPC + its stderr confirmation.
 */
import type { Connection } from "./connect.ts";
import { shortId } from "./render.ts";

/** End a terminal the daemon owns. `resolveOne` resolved `id` against the live
 *  inventory (failing loud on no-match/ambiguity), so it named a real PTY at
 *  resolution time — modulo the TOCTOU window where the PTY exits before this kill
 *  lands, which the daemon absorbs as an idempotent no-op (its kill is a no-op for
 *  an unknown id). The confirmation goes through `confirm` — stderr in production,
 *  like `attach`'s trailers, so stdout stays empty: `kill` yields no scriptable
 *  payload, only an exit code (0 on success, the catch-all 1 on an RPC/transport
 *  error). The sink is injected so a test can capture the line without a tty. */
export async function runKill(
  conn: Connection,
  id: string,
  confirm: (line: string) => void,
): Promise<void> {
  await conn.client.surface.terminal.kill({ id });
  confirm(`— killed ${shortId(id)}\n`);
}
