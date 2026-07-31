/** The daemon spine reuses the workspace's leaf-safe structural logger type;
 * hosts still pass compatible loggers through unchanged. */
import type { Logger } from "@kolu/log";
export type { Logger } from "@kolu/log";

/** A {@link Logger} that writes one JSON object per line to **stderr** (level +
 *  message folded into the object), leaving stdout clean for a daemon's own
 *  machine-readable output. The default a daemon bin hands to its spine — shared
 *  here so every `@kolu/surface-daemon` bin (padi, kaval, …) spells it once. */
export function stderrLogger(): Logger {
  const emit =
    (level: string) =>
    (obj: Record<string, unknown>, msg: string): void => {
      process.stderr.write(`${JSON.stringify({ ...obj, level, msg })}\n`);
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}
