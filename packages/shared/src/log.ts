/** The structured-logging contract, re-exported from its canonical home.
 *
 *  The `Logger` type itself lives in `@kolu/log` — a zero-runtime-dependency,
 *  zero-`kolu-*`-dependency leaf — so that packages which deliberately avoid a
 *  `kolu-shared` dependency can import the same contract without re-declaring
 *  it. This re-export keeps existing `kolu-shared` / `kolu-shared/sqlite`
 *  consumers working unchanged. */
export type { Logger } from "@kolu/log";
