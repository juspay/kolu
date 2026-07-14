/**
 * Boot configuration for pesu — read ONCE from the environment at startup and
 * fail LOUD if a required value is absent. There is no fallback, no default
 * secret, no "degrade to a safe mode" path: a missing `PESU_SIGNING_SECRET`
 * crashes the daemon rather than accepting unsigned traffic (the fail-fast /
 * no-fallbacks law — `.claude/rules/conventions.md`). Secrets arrive ONLY as
 * environment variables — never the repo, a log line, or an agent transcript —
 * so this module reads them and never prints them.
 */

/** The knobs pesu needs to run. `port` / `coordinatorTitle` carry sane defaults
 *  (a dev convenience the plan sanctions); everything else is required. */
export interface PesuConfig {
  /** XS app signing secret — verifies inbound `X-Xyne-Signature` AND signs the
   *  bearer JWT (one secret, both directions). Required. */
  readonly signingSecret: string;
  /** XS app bearer token (JWT, HS256, no expiry) for the outbound app API.
   *  Required. */
  readonly jwtToken: string;
  /** Base URL of the XS instance, e.g. `https://xyne.example.com`. Required. */
  readonly xyneBaseUrl: string;
  /** Local port pesu's webhook receiver binds on `127.0.0.1`. Fronted publicly
   *  by Tailscale Funnel (see the README). Default 8442 (8443-adjacent; :8443 is
   *  the funnel's public port, :7692/:9010 are taken by existing serves). */
  readonly port: number;
  /** The coordinator terminal is resolved BY TITLE (kaval re-keys ids across
   *  restarts; titles survive). Default `RT-fable-main`. */
  readonly coordinatorTitle: string;
  /** The single-operator allowlist — lower-cased emails permitted to drive the
   *  coordinator. A message from anyone else gets a one-line visible decline,
   *  never a relayed turn. Required (widening is a config edit, not a code
   *  change — attribution is already per-sender). */
  readonly operatorEmails: readonly string[];
}

export const DEFAULT_PORT = 8442;
export const DEFAULT_COORDINATOR_TITLE = "RT-fable-main";

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      `pesu: required environment variable ${name} is unset or empty — pesu will not start without it (fail-fast; no fallback). Set it (via Nix / the systemd unit) and restart.`,
    );
  }
  return raw;
}

function requiredList(env: Env, name: string): string[] {
  const items = required(env, name)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (items.length === 0) {
    throw new Error(
      `pesu: ${name} is set but contains no entries — the operator allowlist must name at least one email.`,
    );
  }
  return items;
}

function parsePort(env: Env): number {
  const raw = env.PESU_PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `pesu: PESU_PORT is set to ${JSON.stringify(raw)}, which is not a valid TCP port (1–65535).`,
    );
  }
  return port;
}

/** Read and validate the config from `env` (defaults to `process.env`), throwing
 *  on the first missing required value. Pure over its `env` argument, so tests
 *  drive it with a plain object — no `process.env` mutation. */
export function loadConfig(env: Env = process.env): PesuConfig {
  return {
    signingSecret: required(env, "PESU_SIGNING_SECRET"),
    jwtToken: required(env, "PESU_JWT_TOKEN"),
    xyneBaseUrl: required(env, "XYNE_BASE_URL").replace(/\/+$/, ""),
    port: parsePort(env),
    coordinatorTitle: env.PESU_COORDINATOR_TITLE?.trim()
      ? env.PESU_COORDINATOR_TITLE.trim()
      : DEFAULT_COORDINATOR_TITLE,
    operatorEmails: requiredList(env, "PESU_OPERATOR_ALLOWLIST"),
  };
}

/** Is `email` on the operator allowlist? Case-insensitive; a null/absent email
 *  (the resolver couldn't find one) is never an operator. */
export function isOperatorEmail(
  allowlist: readonly string[],
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}
