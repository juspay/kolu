let
  shim = ./shim;
  packageName = "@agentclientprotocol/claude-agent-acp";
in
{
  inherit shim;

  /** The shim's own name, then the npm package inside it. The shim's `name`
   *  reaches `buildNpmPackage`'s cache key through its lockfile, so this is a
   *  fact a bump must keep in step with `./shim/package.json`. */
  shimName = "kolu-acp-claude";
  package = packageName;

  /** The entry point and the bin the wrapper exposes. */
  entry = "dist/index.js";
  bin = "claude-agent-acp";

  /** The adapter version, read from the shim's own dependency pin rather than
   *  restated — the lockfile and this number cannot disagree because there is
   *  one of them. */
  version = (builtins.fromJSON (builtins.readFile (shim + "/package.json"))).dependencies.${packageName};

  /** THE FIXED-OUTPUT HASH for the shim's dependency set. The shim's `name`
   *  reaches the npm cache `prefetch-npm-deps` builds (the lockfile's root
   *  entry is part of what it reads), and so do its `overrides` (zod 4.6.7
   *  over the adapter's own 4.6.5 pin, `@modelcontextprotocol/sdk` past its
   *  advisory). Both products build THIS shim, so both get this hash; it is
   *  checked in beside the lockfile it was computed from. */
  npmDepsHash = "sha256-+9kyd25sTLvzZElWarbWBPqplLjJqfSse0RIIV4yU2M=";

  /** BOTH patches, as a directory: the builder sorts what it finds and applies
   *  each with `patch -p1 -F0`. A directory with no `.patch` in it fails the
   *  eval rather than answering the empty list — see `./patches/README.md`. */
  patches = ./patches;
}
