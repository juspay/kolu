import path from "node:path";

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const WINDOWS_RESERVED_BASENAME_RE =
  /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i;

const XDG_APP_NAME = "omp";

export const BREADCRUMB_SUBDIR = "terminal-sessions";

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

  const configRoot = path.join(home, env?.PI_CONFIG_DIR || ".omp");

  if (profile !== undefined) {
    const xdgProfileRoot = xdgAppRoot(env, existsSync, ["profiles", profile]);
    const agentDir = path.join(configRoot, "profiles", profile, "agent");
    return {
      agentDir,
      breadcrumbDir: path.join(xdgProfileRoot ?? agentDir, BREADCRUMB_SUBDIR),
      source: xdgProfileRoot ? "profile-xdg" : "profile",
    };
  }

  const envDir = env?.PI_CODING_AGENT_DIR;
  if (envDir) {
    const agentDir = path.resolve(cwd, envDir);
    return {
      agentDir,
      breadcrumbDir: path.join(agentDir, BREADCRUMB_SUBDIR),
      source: "env",
    };
  }

  if (agentDirOverride !== undefined) {
    return {
      agentDir: agentDirOverride,
      breadcrumbDir: path.join(agentDirOverride, BREADCRUMB_SUBDIR),
      source: "override",
    };
  }

  const xdgRoot = xdgAppRoot(env, existsSync);
  const agentDir = path.join(configRoot, "agent");
  return {
    agentDir,
    breadcrumbDir: path.join(xdgRoot ?? agentDir, BREADCRUMB_SUBDIR),
    source: xdgRoot ? "xdg" : "default",
  };
}

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
