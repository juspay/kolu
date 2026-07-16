/**
 * kolu — the product binary's entry point (kolu-cli PR1,
 * docs/atlas/src/content/atlas/kolu-cli.mdx). The composition root: dispatch
 * first, then load ONLY the arm the user asked for. The web boot is a dynamic
 * import so a reserved face (`kolu tui` / `kolu mcp`) fails fast without ever
 * touching the server's module graph.
 */

import { koluWebFlagsOrExit } from "./cli.ts";

const flags = koluWebFlagsOrExit();
const { bootKoluWeb } = await import("kolu-server");
await bootKoluWeb(flags);
