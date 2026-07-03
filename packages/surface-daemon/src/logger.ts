/**
 * The structured-logging contract the daemon spine writes to — declared
 * **structurally**, in-package, so `@kolu/surface-daemon` carries no `kolu-*`
 * workspace dependency (the same graduation rule kaval follows). kolu's richer
 * `Logger` (`@kolu/log`) and kaval's own structural `Logger` are both
 * assignable to this, so a host passes its logger through unchanged; a
 * standalone consumer supplies its own.
 */
export type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

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
