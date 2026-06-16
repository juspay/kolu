/**
 * `unwrapGit` — unwrap a `GitResult` into the success value or throw an
 * `ORPCError` for the client.
 *
 * The implementation now lives in `@kolu/terminal-dag` (alongside `makeFsGit`),
 * so kolu-server's raw git handlers, `LocalTerminalEndpoint`, and kolu-watcher
 * (P3) all map a `GitError` to the same wire status from ONE place. Re-exported
 * here so `router.ts` / `terminalEndpoint/local.ts` keep their `../unwrapGit.ts`
 * import path (and stay out of the `surface.ts` cycle — #1005).
 */

export { unwrapGit } from "@kolu/terminal-dag";
