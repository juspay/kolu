/**
 * kolu — the product binary's entry point (the kolu-cli plan,
 * docs/atlas/src/content/atlas/kolu-cli.mdx). The composition root: dispatch
 * first, then load ONLY the arm the user asked for. Each face's boot is a
 * dynamic import, so `kolu mcp` never touches the web server's module graph
 * and a reserved face (`kolu tui`) fails fast without loading anything.
 */

import { koluFaceOrExit } from "./cli.ts";

const face = koluFaceOrExit();
if (face.face === "mcp") {
  const { runKoluMcp } = await import("./mcp.ts");
  await runKoluMcp({ host: face.host });
} else {
  const { bootKoluWeb } = await import("kolu-server");
  await bootKoluWeb(face.flags);
}
