/**
 * Entrypoint dispatcher (#951 R4c) — one binary, two modes.
 *
 * `kolu --stdio` is the local PTY-host **daemon** (`./agent/main.ts`); any
 * other invocation is the HTTP/WS **kolu-server** (`./server.ts`). The daemon
 * serves `ptyHostSurface` over a unix socket (one per `$KOLU_STATE_DIR`);
 * kolu-server's supervisor spawns this same binary with `--stdio` (in its own
 * cgroup via `systemd-run` on a systemd service, else detached) so the daemon
 * survives a kolu-server restart and its PTYs reattach.
 *
 * Dynamic imports keep the split clean: daemon mode never loads the Hono/HTTP
 * stack, and server mode never loads the socket-serving path. The `--stdio`
 * check reads `process.argv` directly (cleye flag parsing lives in
 * `./server.ts`, which never sees `--stdio` — it routes here).
 */

export {};

if (process.argv.includes("--stdio")) {
  const { runAgent } = await import("./agent/main.ts");
  await runAgent();
} else {
  await import("./server.ts");
}
