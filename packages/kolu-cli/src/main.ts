/**
 * kolu — the product binary's entry point (the kolu-cli plan,
 * docs/atlas/src/content/atlas/kolu-cli.mdx). The composition root: dispatch
 * first, then load ONLY the arm the user asked for. Each face's boot is a
 * dynamic import, so `kolu mcp` never touches the web server's module graph
 * and a reserved face (`kolu tui`) fails fast without loading anything. The
 * imports stay dynamic under Effect — `Effect.promise(() => import(…))` is the
 * same fence, just composed instead of awaited.
 *
 * THE run edge. `NodeRuntime.runMain` rather than `Effect.runPromise` because
 * kolu-cli's exit-code map is LOCAL and tiny: every failure this program can
 * raise carries its own `Runtime.errorExitCode`, so the default teardown reads
 * the code straight off the squashed cause and there is nothing left for a
 * hand-written map to get wrong. (padi's daemon edge inverts this for the
 * opposite reason — its map lives in the spine's `daemonProcessMain`, which
 * kaval rides too.) `errorReported: false` on those errors is what keeps the
 * user-facing line the ONE named message written below, not Effect's pretty
 * cause dump.
 */

import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { koluFace } from "./cli.ts";

const program = Effect.flatMap(koluFace(), (face) =>
  face.face === "mcp"
    ? Effect.flatMap(
        Effect.promise(() => import("./mcp.ts")),
        ({ runKoluMcp }) => runKoluMcp({ host: face.host }),
      )
    : Effect.flatMap(
        Effect.promise(() => import("kolu-server")),
        ({ bootKoluWeb }) => Effect.promise(() => bootKoluWeb(face.flags)),
      ),
);

NodeRuntime.runMain(
  Effect.tapError(program, (err) =>
    Effect.sync(() => {
      process.stderr.write(`${err.message}\n`);
    }),
  ),
);
