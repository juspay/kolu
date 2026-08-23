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

export {
  EXIT,
  isSurfaceCliFailure,
  reportingRunEdge,
  runEdge,
  type RunEdgeReport,
  SurfaceCliFailure,
} from "./exit";
export {
  type Assembled,
  flagsOf,
  INPUT_FLAG,
  type InputProjection,
  SurfaceCliBuildError,
} from "./flags";
export type {
  HelpFlag,
  HelpGroup,
  HelpRow,
  SurfaceCliHelp,
} from "./help";
// The one reading of "the reader hung up" every stdout-data binary asks of a
// sink failure — exported for a host whose OWN writes (outside this projection,
// e.g. kolu-cli's native verbs) answer it too. See io.ts for why it reads the
// nested `cause.code` as well as the flat one.
export { isConsumerHangup } from "./io";
export {
  type EndpointSeam,
  JSON_FLAG,
  type ProjectedCommand,
  READER_NAMES,
  type ResolvedEndpoint,
  surfaceCommands,
  type SurfaceCliConnection,
  type SurfaceCliOptions,
  surfaceHelp,
  type VerbAnnotation,
} from "./commands";
