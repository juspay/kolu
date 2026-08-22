/**
 * `@kolu/surface-cli` — project any `@kolu/surface` as command-line verbs.
 *
 * The argv sibling of `@kolu/surface-mcp`: the same surface, the same
 * default-deny `expose` map, the same hand-authored `SurfaceVerb` table, and the
 * same flat verb names — spelled for a shell instead of for an agent. What this
 * package owns is only the generic part: the argv grammar, the output and exit
 * discipline, and the projection itself. The domain stays behind the surface,
 * the transport stays with the app, and the run edge stays with the binary.
 *
 * ```ts
 * const verbs = surfaceCommands({
 *   surface, expose: AGENT, verbs: TOOLS,
 *   endpoint: { flags, resolve },
 *   info: { name: "olai" },
 * })
 * Command.make("surface").pipe(Command.withSubcommands(verbs))
 * ```
 */

export { EXIT, runEdge, SurfaceCliFailure } from "./exit";
export { flagsOf, type InputProjection, SurfaceCliBuildError } from "./flags";
export {
  type EndpointSeam,
  type ProjectedCommand,
  type ResolvedEndpoint,
  surfaceCommands,
  type SurfaceCliConnection,
  type SurfaceCliOptions,
  type VerbAnnotation,
} from "./commands";
