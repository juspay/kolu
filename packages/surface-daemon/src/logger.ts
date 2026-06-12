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
