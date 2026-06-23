/**
 * pulam-web server configuration — the boot-time, statically-resolved axis.
 *
 * Two concerns the rest of the server reads as already-validated values, both
 * failing FAST and LOUD here (no fallback, no degraded default) rather than
 * surfacing later as a confusing per-host "network" fault:
 *
 *   1. `readInitialHosts()` — the static host set, comma-separated in
 *      `PULAM_WEB_HOSTS`. R4.8a has no admin surface and no on-disk store
 *      (`buildHostRegistry` runs with no `persist` hook), so this env is the
 *      ONLY source of truth for which pulam boxes the parent dials.
 *
 *   2. `makeResolveDrvPath()` — the per-host `.drv` resolver `getHostSession`
 *      calls at the top of every (re)spawn. The `{ system → drvPath }` map is
 *      read + validated ONCE from `PULAM_AGENT_DRVS_JSON` (the same env the
 *      pulam-tui dialer reads, baked by pulam's Nix wrapper), so a missing /
 *      malformed map is a terminal config error caught at boot — NOT inside the
 *      deferred resolver, where `HostSession` would misclassify it as a
 *      retryable network fault and spin on it forever. Only the genuinely
 *      per-host arch probe (`resolveSystem` over ssh) stays deferred.
 *
 * This mirrors `dialAgentOnce`'s eager-config / deferred-arch-probe split
 * (`@kolu/surface-nix-host`), re-expressed for the LONG-LIVED `getHostSession`
 * path (whose `resolveDrvPath` is a thunk the caller supplies, not parsed
 * internally as the one-shot dialer does).
 */

import { ResolveDrvError, resolveSystem } from "@kolu/surface-nix-host";

/** The env var carrying the static, comma-separated host set the parent dials.
 *  No persistence in R4.8a — this env is the whole host registry's seed. */
export const PULAM_WEB_HOSTS_ENV = "PULAM_WEB_HOSTS";

/** The env var carrying pulam's `{ nix-system → agent .drv path }` JSON map —
 *  the SAME name the pulam-tui dialer reads (`hostConnect.ts`), baked by
 *  pulam's Nix wrapper. Held in one constant so the literal passed to error
 *  messages and the `process.env` read can't silently drift. */
export const PULAM_AGENT_DRVS_ENV = "PULAM_AGENT_DRVS_JSON";

/** The HTTP+WebSocket port. `4800` is pulam-web's default (the `48` echoes the
 *  R4.8 epic). Override with `PULAM_WEB_PORT`. */
export const DEFAULT_PORT = 4800;

/** The dev client (Vite) default port. `5800` pairs with `DEFAULT_PORT`'s `48`.
 *  Override with `PULAM_WEB_CLIENT_PORT`. */
export const DEFAULT_CLIENT_PORT = 5800;

/**
 * Parse a port env var, using `fallback` ONLY when the var is unset/empty.
 *
 * Fail-fast, no silent fallback: a present-but-malformed value (`abc`, `12.5`,
 * `99999`, or an explicit `0` — which would bind an arbitrary OS-assigned port,
 * never what a config author means) THROWS, naming the var, rather than quietly
 * collapsing to the default the way `Number(env) || fallback` does (the F6 bug:
 * `Number("abc") || 4800` and `Number("0") || 4800` both silently yield 4800).
 * A valid integer in `1..65535` is returned as-is.
 */
export function parsePort(
  varName: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  // Reject anything that isn't a plain non-negative integer literal up front —
  // `Number` would accept "12.5", "0x10", "1e3", " 80 " and leading/trailing
  // junk via coercion, none of which is a port a config author typed on purpose.
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${varName}: invalid port ${JSON.stringify(raw)} — must be an integer in 1..65535.`,
    );
  }
  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    throw new Error(
      `${varName}: port ${port} out of range — must be an integer in 1..65535 (0 is rejected: it would bind an arbitrary OS-assigned port).`,
    );
  }
  return port;
}

/** Read + split the static host set from `PULAM_WEB_HOSTS`. Each entry is
 *  trimmed; empty entries (a trailing comma, a double comma) are dropped. An
 *  unset/empty env yields an empty list — the caller decides whether that's
 *  fatal (it is: a parent with no hosts has nothing to serve). A host that ssh
 *  would parse as an option (leading `-`) or that carries whitespace is
 *  rejected here, at the same boundary the value enters the process. */
export function readInitialHosts(env = process.env): string[] {
  const raw = env[PULAM_WEB_HOSTS_ENV];
  if (raw === undefined || raw.trim() === "") return [];
  const hosts = raw
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  const bad = hosts.find((h) => h.startsWith("-") || /\s/.test(h));
  if (bad !== undefined) {
    throw new Error(
      `${PULAM_WEB_HOSTS_ENV}: invalid host ${JSON.stringify(bad)} — a host must contain no whitespace and not start with '-' (a leading '-' is parsed by ssh as an option).`,
    );
  }
  return hosts;
}

/** Parse + validate pulam's `{ system → drvPath }` map from an already-read env
 *  value. Fails fast on absent/malformed config — this is a "you ran the raw
 *  entrypoint instead of the Nix wrapper" error, not a runtime blip. */
function parseDrvBySystem(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw === "") {
    throw new Error(
      `${PULAM_AGENT_DRVS_ENV} is not set — pulam-web needs the per-system agent derivations baked into the build. Run it from its Nix wrapper (e.g. PULAM_AGENT_DRVS_JSON=$(nix eval --raw .#pulamAgentDrvsJson)).`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${PULAM_AGENT_DRVS_ENV} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error(
      `${PULAM_AGENT_DRVS_ENV} must be a JSON object of { system: drvPath } strings.`,
    );
  }
  return parsed as Record<string, string>;
}

/** Build the per-host `.drv` resolver `getHostSession` calls each (re)spawn.
 *  The static map is parsed + validated EAGERLY (here, at boot); the returned
 *  thunk only runs the genuinely-per-host, genuinely-volatile step — probe the
 *  host's nix-system over ssh (`resolveSystem`), then look it up. An unreachable
 *  host makes the thunk reject, which `HostSession` folds into its reconnect
 *  machinery as a network fault; an arch with no baked drv is a loud,
 *  non-retryable error naming the systems that ARE baked. */
export function makeResolveDrvPath(
  env = process.env,
): (host: string) => Promise<string> {
  const drvBySystem = parseDrvBySystem(env[PULAM_AGENT_DRVS_ENV]);
  return async (host: string): Promise<string> => {
    const system = await resolveSystem(host);
    const drv = drvBySystem[system];
    if (drv === undefined) {
      const known = Object.keys(drvBySystem).join(", ") || "none";
      // We PROBED the host fine and then found no baked derivation for its
      // system — a config/build error retrying can never fix, NOT an unreachable
      // host. Throw a `ResolveDrvError` carrying `"remote"` so `HostSession`
      // classifies it bounded → terminal (`failed`) rather than its default
      // `"network"` (retry forever), which would make a mis-baked system look
      // like a sleeping box. A `resolveSystem` rejection above stays a plain
      // rejection → `HostSession`'s `"network"` default (the host was
      // unreachable), which is exactly right.
      throw new ResolveDrvError(
        `${host}: no pulam derivation baked for system=${system} (have: ${known}).`,
        "remote",
      );
    }
    return drv;
  };
}
