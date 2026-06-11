import { fileURLToPath } from "node:url";

/** Absolute path to the daemon process entry — fed to the runtime for the
 *  dev/test re-exec spawn path (prod uses KOLU_DAEMON_BIN). */
export const ptyHostDaemonEntry = fileURLToPath(
  new URL("./daemonMain.ts", import.meta.url),
);
