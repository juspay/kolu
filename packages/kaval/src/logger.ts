/**
 * The structured-logging contract the pty-host writes to — declared
 * **structurally**, in-package, so this package carries no `kolu-*` workspace
 * dependency (the graduation rule: package boundary == process boundary ==
 * staleKey hash, zero kolu imports). kolu's own richer `Logger` (`@kolu/log`)
 * is assignable to this, so the in-process host receives it unchanged; a
 * standalone daemon supplies its own.
 */
export type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};
