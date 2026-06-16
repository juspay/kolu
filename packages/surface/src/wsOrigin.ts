/**
 * WebSocket `Origin` gate — the CSWSH (Cross-Site WebSocket Hijacking)
 * defense for a surface server's `/rpc/ws` upgrade.
 *
 * A surface RPC socket carries no credentials of its own: the browser's
 * same-origin policy and SameSite cookies offer NO protection, because there
 * are no cookies to protect. Any web page the operator happens to visit can
 * open `ws://<host>/rpc/ws` and — absent this check — drive the served
 * surface end to end (read every cell/stream, call every procedure). Binding
 * loopback does not help: the attacker page runs in the operator's OWN
 * browser, which reaches `localhost` like any other origin, and a WebSocket
 * upgrade is exempt from CORS preflight. The browser DOES attach an `Origin`
 * header to that upgrade; the only missing control is for the server to
 * verify it.
 *
 * This lives in `@kolu/surface` (not surface-app) because it guards the RPC
 * TRANSPORT itself — a concern of every consumer that exposes `/rpc/ws`,
 * whether or not it also serves an app shell (surface-app). It is the
 * transport-security sibling of surface-app's `gateStaleSocket`: a single
 * upgrade-time gate the library owns so no consumer re-derives it (and the
 * subtle allow-on-absent-Origin rule that keeps non-browser clients working).
 *
 * Policy — every "allow" arm is deliberate:
 *   - No `Origin` header → allow. Non-browser clients (a CLI, `curl`, tests,
 *     a native app, server-to-server) send none and are not a CSWSH vector;
 *     CSWSH is specifically a browser-driven attack. Flipping this to reject
 *     would break every non-browser consumer.
 *   - `Origin`'s host:port equals the request's `Host` header → allow. This
 *     is the surface UI talking to its own origin; a cross-site attacker page
 *     carries a different host and is rejected.
 *   - `Origin` is in the caller-supplied allowlist → allow. The escape hatch
 *     for reverse-proxy / `tailscale serve` setups where the browser origin
 *     (`https://box.tailnet.ts.net`) differs from the `Host` the proxy
 *     forwards. The allowlist VALUE is the consumer's deployment policy (e.g.
 *     a `*_ALLOWED_ORIGINS` env var); it is passed in, never read here.
 *   - Otherwise → reject.
 */

/** A pure same-origin / allowlist decision over the two request headers. */
export interface WsOriginCheck {
  /** The request's `Origin` header (`undefined` if absent). */
  origin: string | undefined;
  /** The request's `Host` header (`undefined` if absent). */
  host: string | undefined;
  /** Exact-match origin allowlist — the reverse-proxy / tailscale-serve
   *  escape hatch. Build it from an env var with `parseAllowedOrigins`. */
  allowedOrigins: readonly string[];
}

/** Is this WebSocket upgrade allowed past the CSWSH gate? Pure over its
 *  inputs — exported for direct use and unit testing; `gateWsOrigin` wraps it
 *  with the header read and the socket teardown. See the module header for
 *  the policy and why each "allow" arm exists. */
export function isAllowedWsOrigin({
  origin,
  host,
  allowedOrigins,
}: WsOriginCheck): boolean {
  // Non-browser client: no Origin, not a CSWSH vector.
  if (origin === undefined || origin.length === 0) return true;
  // Operator-configured allowlist (reverse proxy / tailscale-serve FQDN).
  if (allowedOrigins.includes(origin)) return true;
  // Same host:port: the Origin's host:port must match the Host the request
  // arrived on. `URL.host` carries the port when non-default and omits it
  // when default, mirroring the browser's `Host` header. This is a host:port
  // match, NOT a full same-origin (scheme, host, port) match: the `Host`
  // header carries no scheme to compare against, so a cross-scheme same
  // host:port Origin (e.g. `https://` page reaching an `http://` Host) is
  // intentionally allowed — not a CSWSH threat in practice.
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Malformed or opaque (`"null"`) Origin — treat as cross-origin.
    return false;
  }
  return host !== undefined && host.length > 0 && originHost === host;
}

/** Parse a comma-separated origin allowlist (e.g. the value of a
 *  `*_ALLOWED_ORIGINS` env var) into a trimmed, non-empty list.
 *  `undefined`/blank → `[]`. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The structural subset of a raw, pre-upgrade socket the gate tears down. At
 *  the HTTP `upgrade` event the socket is a not-yet-upgraded `net.Socket`,
 *  closed with `destroy()` — NOT the ws `close(code, reason)` that
 *  `gateStaleSocket` uses (that one runs AFTER the handshake on a live
 *  `WebSocket`). Kept structural so surface needn't depend on `node:net`. */
export interface UpgradeSocket {
  destroy(): void;
}

/** The request whose `Origin`/`Host` headers the gate reads. Node types both
 *  as `string | string[] | undefined`; they are single-valued in practice and
 *  collapsed to the first value. */
export interface OriginGateRequest {
  headers: {
    origin?: string | string[];
    host?: string | string[];
  };
}

/** Caller-owned policy for `gateWsOrigin`. */
export interface WsOriginPolicy {
  /** Extra browser origins (beyond same-origin) allowed to upgrade — the
   *  reverse-proxy / tailscale-serve escape hatch. `parseAllowedOrigins` of
   *  the consumer's `*_ALLOWED_ORIGINS` env var. */
  allowedOrigins: readonly string[];
  /** Fired with the rejected `Origin` when an upgrade is refused — wire it to
   *  the consumer's logger so a blocked cross-site attempt is observable. */
  onReject?: (origin: string | undefined) => void;
}

/** Apply the CSWSH `Origin` gate at a `/rpc/ws` upgrade, BEFORE the socket is
 *  handed to `wss.handleUpgrade`. Reads the `Origin`/`Host` headers, decides
 *  via `isAllowedWsOrigin`, and on a cross-site browser Origin `destroy()`s
 *  the raw socket and returns `true` so the caller returns WITHOUT upgrading.
 *  Returns `false` to proceed. The boolean contract mirrors `gateStaleSocket`
 *  (`true` = handled/rejected, caller returns). Encapsulating the header
 *  collapse and the teardown here is the point: no consumer re-derives the
 *  gate. */
export function gateWsOrigin(
  req: OriginGateRequest,
  socket: UpgradeSocket,
  policy: WsOriginPolicy,
): boolean {
  const origin = firstHeader(req.headers.origin);
  const host = firstHeader(req.headers.host);
  if (
    isAllowedWsOrigin({ origin, host, allowedOrigins: policy.allowedOrigins })
  ) {
    return false;
  }
  // destroy() FIRST (the critical operation), then fire the observational
  // `onReject` — a throwing reporter must never leave a cross-site socket able
  // to upgrade. (Mirrors `gateStaleSocket`'s close-before-onReject invariant.)
  socket.destroy();
  policy.onReject?.(origin);
  return true;
}

/** Collapse a possibly multi-valued node header to its first value. */
function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
