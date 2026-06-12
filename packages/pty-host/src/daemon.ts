/**
 * The `kolu-pty-host` executable — the one side-effecting file in the package.
 *
 * Everything else in `@kolu/pty-host` is import-safe (the library `index.ts` and
 * the daemon's own `daemonMain.ts` run nothing on import); this thin entry is
 * the sole place that actually starts the daemon, so the nix wrapper points tsx
 * here. Keeping the side effect isolated is what lets `index.ts` stay a pure
 * re-export and the integration test import `runPtyHostDaemon` without spawning a
 * real daemon.
 */

import { main } from "./daemonMain.ts";

main().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: "error", err: String(err), msg: "pty-host daemon crashed during startup" })}\n`,
  );
  process.exit(1);
});
