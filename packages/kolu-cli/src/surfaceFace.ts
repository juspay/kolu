/**
 * The `kolu surface` face — the same `padiSurface` the agent face serves,
 * spelled for a shell: `@kolu/surface-cli` projects the ONE expose map and the
 * ONE verb table the MCP face offers (`KOLU_MCP_EXPOSE` · `KOLU_MCP_TOOLS`)
 * onto argv, mounted under its own parent.
 *
 * ```sh
 * kolu surface list                        # what this padi offers
 * kolu surface get terminals               # the live roster, one JSON value
 * kolu surface get terminals --follow      # snapshot, then ndjson deltas
 * kolu surface screen_text 3f9c --tail 40  # a rendered screen, as text
 * kolu surface lifecycle_kill 3f9c
 * kolu surface lifecycle_create --json '{"placement":{"kind":"toplevel"},"run":"claude"}'
 * ```
 *
 * ## Parity is the whole point
 *
 * The expose map and the bespoke-tool table are `kolu-mcp`'s, named in one
 * place and handed to BOTH faces verbatim: `kolu surface fs_readFile …` and
 * the `fs_readFile` MCP tool are one name for one function, so an agent
 * (driving `kolu mcp`) and a shell (driving this face) cannot drift.
 * Widening what a shell may do to a padi is a one-row diff in
 * `kolu-mcp/src/expose.ts`, with the SAME review the MCP map gets — never a
 * new list here.
 *
 * ## WHICH padi is the ROOT's question — the endpoint flags stay put
 *
 * `--socket` / `--state-root` / `--host` are the binary's shared flags,
 * position-blind (`kolu --host pu1 surface get terminals` and
 * `kolu surface get terminals --host pu1` are one parse). This face declares
 * NO endpoint flags of its own: `endpoint.resolve` reads the PARENT command's
 * context (the seam's documented idiom for a host with shared flags), and a
 * contradictory spelling is that arm of the face's matrix — `kolu surface: no
 * endpoint to dial — --host and --socket are mutually exclusive …`, exit 3.
 *
 * ## Exit codes are PER-FACE, by ruling
 *
 * The verbs here answer `@kolu/surface-cli`'s matrix (`exit.ts`'s own header
 * records the collision this face now settles): `1` the verb's DECLARED
 * refusal, as JSON on stderr · `2` a usage error the face raised before the
 * request left the process · `3` nothing serving the endpoint · `130`
 * interrupted. The NATIVE verbs keep kolu-cli's (`1` usage/link · `2` wait
 * timed out · `3` terminal exited). One binary, two faces, one binary-wide
 * parse layer: a failure's code is DATA it carries, so a driver branches on
 * the face it drove — the alternative the recording anticipated, one integer
 * meaning two things inside one FACE, is the shape this ruling refuses to
 * ship. The two arms left binary-wide are honest ones: the `-h`/`--version`
 * help-success arm, and the parse layer's own refusal (`main.ts`'s, exit 1 on
 * both faces).
 *
 * ## What mounting costs the TREE, and what it refuses to cost
 *
 * Effect CLI's tree is static — these subcommands must EXIST before the parse
 * — so this module is cli.ts's one static import that names a face. What it
 * loads is schema-level: `padiSurface` (cli.ts already pays for it),
 * `kolu-mcp/src/expose.ts` (types only), and `kolu-mcp/src/tools.ts` — the
 * SDK-FREE shard whose header records why the MCP server classes must not
 * ride onto every `kolu --help`. What it must NOT load is a socket: the dial
 * stays behind the same dynamic-import fence the other faces sit behind
 * ({@link dialOf}), exactly as {@link endpointOf}'s header requires of
 * `cli.ts`'s graph.
 */

import { padiSurface } from "@kolu/padi/surface";
import { type ResolvedEndpoint, surfaceCommands } from "@kolu/surface-cli";
import { KOLU_MCP_EXPOSE } from "kolu-mcp/expose";
import { KOLU_MCP_TOOLS } from "kolu-mcp/tools";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import type { koluRoot } from "./cli.ts";
import type { KoluCliConnection } from "./connect.ts";
import {
  type Endpoint,
  type EndpointFlagValues,
  endpointOf,
} from "./endpoint.ts";

/** How the endpoint was SPELLED, for the failure that names it — the sentence
 *  `kolu surface: no surface at <where> — …` hangs off this string, and the
 *  user's action on it starts from what they typed. The `auto` arm names the
 *  discovery, not a path: the resolved socket is only known to the dial, whose
 *  own failure sentence (padi's) is what carries it. */
const whereOf = (endpoint: Endpoint): string => {
  switch (endpoint.kind) {
    case "socket":
      return endpoint.path;
    case "stateRoot":
      return `--state-root ${endpoint.dir}`;
    case "host":
      return endpoint.ssh;
    case "auto":
      return "the discovered local padi";
  }
};

/** One dial, whichever transport — the SAME re-resolve the MCP face runs
 *  (`connectKoluCliLocal` re-reads the registry per call, `dialPadiViaHost`
 *  re-provisions per call): a CLI process is one dial and out, and what it
 *  dials is whatever answers now.
 *
 *  Dynamic-imported inside the effect, per `endpoint.ts`'s header's fence: the
 *  connect modules statically reach padi's dial graph, and every `kolu`
 *  invocation — `kolu --help` included — holds this face's tree, so the one
 *  structural property keeping a socket off the parse path is that the import
 *  happens HERE, at the end of `open`. */
const dialOf = (
  endpoint: Endpoint,
): Effect.Effect<KoluCliConnection, unknown> =>
  endpoint.kind === "host"
    ? Effect.flatMap(
        Effect.promise(() => import("./hostConnect.ts")),
        ({ connectKoluCliViaHost }) => connectKoluCliViaHost(endpoint.ssh),
      )
    : Effect.flatMap(
        Effect.promise(() => import("./connect.ts")),
        ({ connectKoluCliLocal }) => connectKoluCliLocal(endpoint),
      );

/** The face's answer to "name exactly one padi": the root's shared flags make
 *  the flag-to-endpoint rule the BINARY's (`endpointOf` is the one spelling of
 *  it), and this face's only work on it is carrying the sentence under ITS OWN
 *  prefix: the refusal arrives as this binary's `CliFailure`, whose sentence
 *  lives in `.stderr` written for its own channel ("kolu: …\n") — here it is
 *  the REASON inside the face's arm ("kolu surface: no endpoint to dial — …"),
 *  so the channel encoding is unspelled, and this is the ONE place that
 *  unspelling lives (the sentence arrives only here, and only this face
 *  re-arms it). */
const surfaceEndpointOf = (
  flags: EndpointFlagValues,
): Effect.Effect<ResolvedEndpoint, Error> =>
  Effect.map(
    Effect.mapError(
      endpointOf(flags),
      (err) => new Error(err.stderr.replace(/^kolu: /, "").replace(/\n$/, "")),
    ),
    (endpoint) => ({
      where: whereOf(endpoint),
      open: () => Effect.runPromise(dialOf(endpoint)),
    }),
  );

/** CLI-only ergonomics for the parity table, by verb name — the one thing a
 *  shell has and an MCP argument does not: POSITIONS. `id` (and each repo
 *  read's `repoPath`) is the field every driver types first, so it binds to
 *  the first position: `kolu surface screen_text 3f9c --tail 40`, not
 *  `--id 3f9c`. Everything else is flags, exactly as an MCP argument names it.
 *  A name here that is not a field of its input is refused at BUILD (the
 *  projection's own check), so a drifting annotation cannot ship silently. */
export const KOLU_SURFACE_POSITIONALS = {
  screen_text: { positional: ["id"] },
  screen_image: { positional: ["id"] },
  screen_history: { positional: ["id"] },
  wait_outputSettled: { positional: ["id"] },
  wait_agentState: { positional: ["id"] },
  lifecycle_sendInput: { positional: ["id"] },
  lifecycle_kill: { positional: ["id"] },
  watch_next: { positional: ["name"] },
  watch_close: { positional: ["name"] },
  fs_listAll: { positional: ["repoPath"] },
  fs_readFile: { positional: ["repoPath", "filePath"] },
  git_getStatus: { positional: ["repoPath"] },
  git_getDiff: { positional: ["repoPath", "filePath"] },
} as const;

/** The parent face. Its verb table *is* the MCP face's: `padiSurface` is
 *  handed over as a VALUE — the projection reads spec + schemas off it without
 *  a socket in sight — together with the one expose map the agent face
 *  answers.
 *
 *  The parameter is the ROOT command because the endpoint flags are father's:
 *  `resolve`'s effect reads the parent context for them. `typeof koluRoot` is
 *  an `import type` — a circular import of VALUES (cli.ts imports this module)
 *  — so the typing costs the graph nothing. */
export const koluSurfaceFace = (root: typeof koluRoot) =>
  Command.make("surface").pipe(
    Command.withDescription(
      "Drive this padi's surface as plain argv verbs — the shell sibling of `kolu mcp` (the same exposed map, the same verb table). `kolu surface list` names what a padi offers; every verb's exit code is the surface face's (1 the refusal, 2 usage, 3 the endpoint, 130 interrupted) — NOT the native verbs' matrix.",
    ),
    Command.withSubcommands(
      surfaceCommands({
        surface: padiSurface,
        expose: KOLU_MCP_EXPOSE,
        verbs: KOLU_MCP_TOOLS,
        endpoint: {
          resolve: () => Effect.flatMap(root, surfaceEndpointOf),
        },
        annotate: KOLU_SURFACE_POSITIONALS,
        info: { name: "kolu surface" },
      }),
    ),
  );
