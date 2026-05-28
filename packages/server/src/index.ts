/**
 * Entrypoint dispatcher — branches into the local PTY-host agent when
 * `--stdio` is in argv, otherwise loads the kolu-server bootstrap.
 *
 * The agent process runs the same binary as kolu-server but exposes
 * `agentSurface` over a unix socket (one socket per `$KOLU_STATE_DIR`).
 * kolu-server's supervisor spawns this binary with `--stdio` + `detached:
 * true` so the daemon survives kolu-server restart. The dispatcher uses
 * dynamic imports so agent mode doesn't pay for the HTTP/Hono stack and
 * vice-versa.
 */

export {};

if (process.argv.includes("--stdio")) {
  await import("./agent/main.ts");
} else {
  await import("./server.ts");
}
