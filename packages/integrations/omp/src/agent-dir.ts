/** omp agent-directory resolution — the per-terminal answer to "where does
 *  THIS omp keep its state".
 *
 *  omp's own chain (omp 18.1.21, `packages/utils/src/dirs.ts` — the
 *  `DirResolver` constructor and `resolveProfileEnv`/`normalizeProfileName`):
 *
 *    configRoot   = <home>/<PI_CONFIG_DIR || ".omp">
 *    profile      = `--profile <name>` (argv), else `OMP_PROFILE`, else
 *                   `PI_PROFILE`; ""/"default" mean the default profile, and an
 *                   explicitly-empty `OMP_PROFILE` therefore selects the
 *                   DEFAULT profile rather than inheriting `PI_PROFILE`
 *    agentDir     = profile  → <configRoot>/profiles/<name>/agent
 *                   else `PI_CODING_AGENT_DIR` (truthy) → path.resolve(cwd, …)
 *                   else <configRoot>/agent
 *
 *  Breadcrumbs — `terminal-sessions/<tty id>`, the one thing kolu reads — are
 *  omp's STATE category. On Linux/macOS omp redirects it into
 *  `$XDG_STATE_HOME/omp` **only when that app root already exists** (`omp
 *  config init-xdg` creates it), and for a named profile only when
 *  `$XDG_STATE_HOME/omp/profiles/<name>` exists — pinned on the profile path,
 *  so a profile's location is decided at first activation and never moves when
 *  the base appears. `PI_CODING_AGENT_DIR` suppresses the XDG probe entirely
 *  (`isDefault` is false once the agent dir is overridden), while a named
 *  profile does NOT (its derived agent dir IS its default).
 *
 *  These overrides live in the omp process's own argv/environment, not in
 *  padi's, so resolution reads the foreground process (`kolu-io`'s
 *  `readProcessSnapshot`) and folds it through the chain.
 *
 *  One deliberate difference from pi: there is **no fallback to a default dir**
 *  when the invocation's directory cannot be determined. The breadcrumb is the
 *  only anchor kolu has, and a guessed directory would point at a tree this
 *  terminal does not write to — so an unresolvable answer is `null` ("keep what
 *  was published"), never a substituted path. `omp` refuses to start on an
 *  invalid profile name, which is the one input that makes the answer
 *  unknowable rather than merely unread. */

import path from "node:path";

/** omp's profile-name grammar (`normalizeProfileName`): lowercase
 *  alnum first, then `.`/`_`/`-`, ≤64 chars. */
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Platform-reserved basenames omp refuses as profile names (they would create
 *  unopenable directories on Windows). omp applies the check on every platform,
 *  so kolu mirrors it: refusing the same names keeps "did omp accept this
 *  profile" a single answer. */
const WINDOWS_RESERVED_BASENAME_RE =
  /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;

/** omp's APP_NAME — the XDG app root is `$XDG_*_HOME/omp` regardless of
 *  `PI_CONFIG_DIR`. */
const XDG_APP_NAME = "omp";

export type AgentDirSource =
  | "profile"
  | "profile-xdg"
  | "env"
  | "override"
  | "xdg"
  | "default";

export interface AgentDirResolution {
  /** The agent directory omp runs with for this invocation. NOTE it is not
   *  always the breadcrumb's parent: omp's XDG state redirect moves the
   *  breadcrumbs (and only them) out of the agent directory, so every consumer
   *  must read `breadcrumbDir` — the anchor — rather than deriving it. */
  agentDir: string;
  /** Where THIS invocation writes its `terminal-sessions/<tty id>` breadcrumb
   *  — the directory kolu reads to find the session. */
  breadcrumbDir: string;
  /** Which link of the chain decided the resolution (logging/diagnostics).
   *  Every arm names ALL of its provenance: `profile-xdg` is a named profile
   *  whose breadcrumbs live in the XDG state tree, not a `profile` with a
   *  detail only the breadcrumb path reveals. */
  source: AgentDirSource;
}

/** The `--profile` value from an argv, or `null` when the flag is absent.
 *  Handles both spellings (`--profile <name>` and `--profile=<name>`); the
 *  first occurrence wins (deterministic beats clever for a doubled flag), and a
 *  trailing valueless `--profile` yields `""` — the flag WAS given, and an
 *  empty profile means the default one. */
export function parseProfileFlag(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--profile") return argv[i + 1] ?? "";
    if (token?.startsWith("--profile=")) {
      return token.slice("--profile=".length);
    }
  }
  return null;
}

/** omp's `normalizeProfileName`: `undefined` for the implicit default profile,
 *  `null` for a name omp itself would refuse to start with. */
export function normalizeProfileName(
  raw: string | undefined,
): string | undefined | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "default") return undefined;
  if (
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.endsWith(".") ||
    !PROFILE_NAME_RE.test(trimmed) ||
    WINDOWS_RESERVED_BASENAME_RE.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

/** Fold an invocation's argv + env through omp's agent-directory precedence.
 *  Pure given its inputs — the argv/env capture and the XDG `existsSync` probe
 *  are injected. Returns `null` when omp names a profile it would itself refuse
 *  (there is then no directory to point at, and kolu never substitutes one). */
export function resolveAgentDir(opts: {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
  home: string;
  /** kolu's own knob (`KOLU_OMP_DIR`, from `config.ts`): the agent dir kolu
   *  takes as the DEFAULT profile's, replacing omp's derived
   *  `<configRoot>/agent`. `undefined` in production, where omp's own chain
   *  decides. */
  agentDirOverride?: string;
  /** The terminal's cwd — the base for a relative `PI_CODING_AGENT_DIR`, which
   *  omp resolves with `path.resolve` against its own launch cwd. (Note omp does
   *  NOT expand a leading `~` here, so neither does kolu: both agree on the
   *  literal path omp would use.) */
  cwd: string;
  /** Filesystem probe for the XDG app root — injected so the fold stays pure. */
  existsSync: (candidate: string) => boolean;
}): AgentDirResolution | null {
  const { argv, env, home, agentDirOverride, cwd, existsSync } = opts;

  const flag = argv ? parseProfileFlag(argv) : null;
  const rawProfile =
    flag !== null
      ? flag
      : env?.OMP_PROFILE !== undefined
        ? env.OMP_PROFILE
        : env?.PI_PROFILE;
  const profile = normalizeProfileName(rawProfile);
  if (profile === null) return null;

  // omp's `getConfigDirName()`: a truthy PI_CONFIG_DIR, else ".omp".
  const configRoot = path.join(home, env?.PI_CONFIG_DIR || ".omp");

  if (profile !== undefined) {
    // A named profile's XDG home is its own directory, not the base app root —
    // and it is consulted whenever it exists, because the profile's derived
    // agent dir IS the profile's default (`isDefault` in omp's resolver).
    const xdgProfileRoot = xdgAppRoot(env, existsSync, ["profiles", profile]);
    const agentDir = path.join(configRoot, "profiles", profile, "agent");
    return {
      agentDir,
      breadcrumbDir: path.join(xdgProfileRoot ?? agentDir, "terminal-sessions"),
      source: xdgProfileRoot ? "profile-xdg" : "profile",
    };
  }

  // `PI_CODING_AGENT_DIR` moves omp's whole agent directory (sessions and
  // breadcrumbs included). It is read only here — never for a named profile,
  // which omp resolves from the profile root alone.
  const envDir = env?.PI_CODING_AGENT_DIR;
  if (envDir) {
    const agentDir = path.resolve(cwd, envDir);
    return {
      agentDir,
      breadcrumbDir: path.join(agentDir, "terminal-sessions"),
      source: "env",
    };
  }

  if (agentDirOverride !== undefined) {
    return {
      agentDir: agentDirOverride,
      breadcrumbDir: path.join(agentDirOverride, "terminal-sessions"),
      source: "override",
    };
  }

  const xdgRoot = xdgAppRoot(env, existsSync);
  const agentDir = path.join(configRoot, "agent");
  return {
    agentDir,
    breadcrumbDir: path.join(xdgRoot ?? agentDir, "terminal-sessions"),
    source: xdgRoot ? "xdg" : "default",
  };
}

/** An existing `$XDG_STATE_HOME/omp[/<sub…>]`, or `undefined` — omp trusts the
 *  directory's existence (its `resolveIf`), never the env var alone. */
function xdgAppRoot(
  env: Record<string, string | undefined> | undefined,
  existsSync: (candidate: string) => boolean,
  sub?: readonly string[],
): string | undefined {
  const stateHome = env?.XDG_STATE_HOME;
  if (!stateHome) return undefined;
  const candidate = path.join(stateHome, XDG_APP_NAME, ...(sub ?? []));
  return existsSync(candidate) ? candidate : undefined;
}
