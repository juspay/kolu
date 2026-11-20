import { Effect } from "effect";
import type { Connection } from "./connect.ts";
import { shortId } from "./render.ts";

export function runKill(
  conn: Connection,
  id: string,
  confirm: (line: string) => void,
): Effect.Effect<void, unknown> {
  return Effect.map(conn.client.surface.terminal.kill({ id }), () => {
    confirm(`— killed ${shortId(id)}\n`);
  });
}
