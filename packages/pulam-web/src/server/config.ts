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

/** The env var carrying per-host kaval socket overrides — `host=socket` pairs,
 *  comma-separated. A host running SEVERAL kaval daemons (e.g. a box with both a
 *  kolu-server and a standalone kaval) is AMBIGUOUS to pulam's default discovery
 *  (`resolveRunningKavalSocket` reports "more than one kaval"), so the dial must
 *  name the socket: pulam-web forwards it as `pulam --stdio --kaval <socket>` —
 *  the same pin pulam-tui's `--kaval host=socket` rides (`hostConnect.ts`). A
 *  host with one kaval needs no entry (discovery is unambiguous). */
export const PULAM_WEB_KAVAL_SOCKETS_ENV = "PULAM_WEB_KAVAL_SOCKETS";

// The port constants + the strict `parsePort` live in `ports.ts` — a module that
// imports NOTHING from `@kolu/surface-nix-host`, so `vite.config.ts` can read the
// dev-proxy port defaults without dragging this module's drv-resolver (and its
// extensionless-barrel imports that native ESM can't load) into the Vite config
// load. Re-exported here so server-side code still reads everything from
// `config.ts`. See `ports.ts` for the full rationale.
export { DEFAULT_CLIENT_PORT, DEFAULT_PORT, parsePort } from "./ports.ts";

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
  // Reject a duplicate at THIS boundary, naming the env var — clearer than the
  // generic registry error `buildHostRegistry` would throw on the same list.
  // `PULAM_WEB_HOSTS=box,box` is a typo, not "two of the same box": each host
  // maps to one session, so a duplicate would only start a redundant pump.
  const seen = new Set<string>();
  for (const h of hosts) {
    if (seen.has(h)) {
      throw new Error(
        `${PULAM_WEB_HOSTS_ENV}: duplicate host ${JSON.stringify(h)} — list each host once.`,
      );
    }
    seen.add(h);
  }
  return hosts;
}

/** Parse the per-host kaval socket map from `PULAM_WEB_KAVAL_SOCKETS`. Each
 *  entry is `host=socketPath`; trimmed; empty entries (a trailing/double comma)
 *  dropped; an unset/empty env yields an empty map (the common case — every host
 *  runs one kaval). Fails fast on a malformed entry (no `=`, empty host, empty
 *  socket): a typo here would otherwise silently fall back to ambiguous
 *  discovery and surface as an inscrutable per-host `failed`, the exact
 *  silent-degrade this validation prevents. The host is matched against
 *  `PULAM_WEB_HOSTS` by the caller (a socket for an undialed host is a typo). */
export function readKavalSockets(env = process.env): Map<string, string> {
  const raw = env[PULAM_WEB_KAVAL_SOCKETS_ENV];
  const map = new Map<string, string>();
  if (raw === undefined || raw.trim() === "") return map;
  const pairs = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const host = eq === -1 ? "" : pair.slice(0, eq).trim();
    const socket = eq === -1 ? "" : pair.slice(eq + 1).trim();
    if (host === "" || socket === "") {
      throw new Error(
        `${PULAM_WEB_KAVAL_SOCKETS_ENV}: invalid entry ${JSON.stringify(pair)} — each entry must be 'host=socketPath' (e.g. nix@box=/run/user/1000/kaval/pty-host.sock).`,
      );
    }
    map.set(host, socket);
  }
  return map;
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
